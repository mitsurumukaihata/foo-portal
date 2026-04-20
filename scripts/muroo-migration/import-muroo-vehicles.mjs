#!/usr/bin/env node
// muroo-vehicles.json を Notion 車両マスタDB にインポート
// 事前: parse-muroo-tire-tables.mjs で muroo-vehicles.json 生成済み
// 事前: ムロオ4拠点の 顧客情報DB 上でのページIDを --locations-json で指定
//   例: --locations-json '{"ムロオ広島北センター":"xxxx-xxxx-...", "ムロオイオン":"...", ...}'

import https from 'https';
import fs from 'fs';
import path from 'path';

const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';

function getArg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev',
        path: p,
        method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
      }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const pp = JSON.parse(c);
            if (pp.object === 'error') {
              if (['rate_limited', 'internal_server_error', 'service_unavailable'].includes(pp.code) && n > 0) {
                const wait = Math.min(30000, 2000 * Math.pow(2, 5 - n));
                setTimeout(() => tryFetch(n - 1), wait);
                return;
              }
              rej(new Error('Notion ' + pp.code + ': ' + (pp.message || '')));
              return;
            }
            res(pp);
          } catch (e) { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(new Error(c.slice(0, 300))); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 軸構成から 仕様 select 値を導出
function guessSpec(axleCount, frQty, rrQty) {
  const total = (frQty || 0) + (rrQty || 0);
  if (axleCount === 2) {
    if (total === 6) return '2-D (6輪)';
    if (total === 4) return '2-S (4輪)';
    return '2-D (6輪)';
  }
  if (axleCount === 3) {
    if (total === 10) return '2-D-D (10輪)';
    if (total === 12) return '2-2-D-D (12輪)';
    return '2-D-D (10輪)';
  }
  return 'その他';
}

// サイズから 車種 select 値を推定
function guessCarType(frSize, rrSize) {
  const s = (rrSize || frSize || '').toLowerCase();
  if (/r22\.5|r19\.5/.test(s)) return '大型';
  if (/r17\.5|r16/.test(s)) return '中型';
  if (/r14|r15/.test(s)) return '小型';
  return '中型';
}

// ========== 実行 ==========
const SCRIPT_DIR = path.dirname(decodeURI(new URL(import.meta.url).pathname.replace(/^\//, '')));
const IN = getArg('in', path.join(SCRIPT_DIR, 'muroo-vehicles.json'));
const LOCATIONS_JSON = getArg('locations-json', null);
const DRY_RUN = process.argv.includes('--dry-run');

if (!fs.existsSync(IN)) {
  console.error('❌ 入力JSONが見つかりません:', IN);
  console.error('   先に parse-muroo-tire-tables.mjs を実行してください');
  process.exit(1);
}
const vehicles = JSON.parse(fs.readFileSync(IN, 'utf-8'));
console.log('📥 読み込み:', vehicles.length, '車両');

let locations = {};
if (LOCATIONS_JSON) {
  try { locations = JSON.parse(LOCATIONS_JSON); }
  catch (e) { console.error('❌ locations-json の JSON 解析失敗'); process.exit(1); }
}
console.log('📍 拠点リレーション:', Object.keys(locations).length, '件');

// 既存チェック: 管理番号ベース
console.log('🔍 既存車両マスタを確認中...');
const existingByMgmt = new Map();
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + VEHICLE_DB + '/query', body);
  for (const p of r.results || []) {
    const mn = p.properties['管理番号']?.rich_text?.[0]?.plain_text || '';
    if (mn) existingByMgmt.set(mn, p);
  }
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('   既存車両（管理番号あり）:', existingByMgmt.size, '件');

let created = 0, updated = 0, skipped = 0, failed = 0;
for (const v of vehicles) {
  const ownerPageId = locations[v.location];
  const frSizeClean = (v.frSize || '').replace(/\s*\(過去:[^)]+\)/, '').trim();
  const rrSizeClean = (v.rrSize || '').replace(/\s*\(過去:[^)]+\)/, '').trim();
  const totalQty = (v.frQty || 0) + (v.rrQty || 0);

  const props = {
    '車番': { title: [{ text: { content: '管理#' + v.mgmtNo } }] },
    '管理番号': { rich_text: [{ text: { content: v.mgmtNo } }] },
    '前輪サイズ': { rich_text: [{ text: { content: frSizeClean } }] },
    '後輪サイズ': { rich_text: [{ text: { content: rrSizeClean } }] },
    '本数': { number: totalQty },
    '仕様': { select: { name: guessSpec(v.axleCount, v.frQty, v.rrQty) } },
    '車種': { select: { name: guessCarType(frSizeClean, rrSizeClean) } },
    'タイヤカテゴリ': { select: { name: 'LTL TB ノーマル' } },
    'メモ': { rich_text: [{ text: { content:
      `拠点: ${v.location}\n` +
      `ソース: ${path.basename(v.sourceSheet || '')}\n` +
      (v.subMgmt.length ? `サブ管理番号: ${v.subMgmt.join(', ')}\n` : '') +
      `インポート: ${new Date().toISOString().slice(0,10)}`
    } }] },
  };
  if (ownerPageId) {
    props['顧客'] = { relation: [{ id: ownerPageId }] };
  }

  const existing = existingByMgmt.get(v.mgmtNo);
  if (existing) {
    if (DRY_RUN) { console.log('[DRY] UPDATE', v.mgmtNo, '→', v.location); skipped++; continue; }
    try {
      await nf('PATCH', '/pages/' + existing.id, { properties: props });
      updated++;
      if (updated % 10 === 0) console.log('  更新:', updated, '/ ', vehicles.length);
    } catch (e) { console.error('  更新失敗', v.mgmtNo, e.message); failed++; }
  } else {
    if (DRY_RUN) { console.log('[DRY] CREATE', v.mgmtNo, v.location, frSizeClean, '/', rrSizeClean); created++; continue; }
    try {
      await nf('POST', '/pages', {
        parent: { database_id: VEHICLE_DB },
        properties: props,
      });
      created++;
      if (created % 10 === 0) console.log('  作成:', created, '/ ', vehicles.length);
    } catch (e) { console.error('  作成失敗', v.mgmtNo, e.message); failed++; }
  }
  await sleep(350); // rate-limit 保護
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ 新規作成:', created);
console.log('✏️  更新:', updated);
console.log('⏭️  スキップ:', skipped);
console.log('❌ 失敗:', failed);
if (DRY_RUN) console.log('※ DRY-RUN モード: 実際の書き込みは行っていません');
