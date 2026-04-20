#!/usr/bin/env node
// all-vehicles.json を Notion 車両マスタDB にインポート
// - 顧客紐付きの車両のみ対象
// - 既存は UPSERT (管理番号 or 車番 で一致)

import https from 'https';
import fs from 'fs';
import path from 'path';

const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';

function nf(method, p, body, retries = 6) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
      }, r => {
        let c = ''; r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const pp = JSON.parse(c);
            if (pp.object === 'error' && ['rate_limited','internal_server_error','service_unavailable'].includes(pp.code) && n > 0) {
              setTimeout(() => tryFetch(n - 1), Math.min(30000, 2000 * Math.pow(2, 6 - n))); return;
            }
            res(pp);
          } catch(e) { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d); req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function guessSpec(axleCount, frQty, rrQty) {
  const total = (frQty || 0) + (rrQty || 0);
  if (axleCount <= 2) return total >= 6 ? '2-D (6輪)' : '2-S (4輪)';
  if (axleCount === 3) return total >= 12 ? '2-2-D-D (12輪)' : '2-D-D (10輪)';
  return 'その他';
}
function guessCarType(frSize, rrSize) {
  const s = (rrSize || frSize || '').toLowerCase();
  if (/r22\.5|r19\.5/.test(s)) return '大型';
  if (/r17\.5|r16/.test(s)) return '中型';
  if (/r14|r15/.test(s)) return '小型';
  return '中型';
}

const SCRIPT_DIR = path.dirname(decodeURI(new URL(import.meta.url).pathname.replace(/^\//, '')));
const vehicles = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'all-vehicles.json'), 'utf-8'));
const matched = vehicles.filter(v => v.customerId);
console.log(`📥 総車両${vehicles.length} / 顧客紐付き${matched.length}`);

console.log('🔍 既存車両マスタを確認中...');
const existingByMgmt = new Map();
const existingByCar = new Map();
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + VEHICLE_DB + '/query', body);
  for (const p of r.results || []) {
    const mn = p.properties['管理番号']?.rich_text?.[0]?.plain_text || '';
    const cn = p.properties['車番']?.title?.[0]?.plain_text || '';
    if (mn) existingByMgmt.set(mn, p);
    if (cn) existingByCar.set(cn, p);
  }
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log(`   既存: 管理番号${existingByMgmt.size}件 / 車番${existingByCar.size}件`);

let created = 0, updated = 0, failed = 0;
const startTime = Date.now();
for (let i = 0; i < matched.length; i++) {
  const v = matched[i];
  const totalQty = (v.frQty || 0) + (v.rrQty || 0);
  const title = v.carNo || ('管理#' + v.mgmtNo);

  // 既存チェック
  let existing = null;
  if (v.mgmtNo && existingByMgmt.has(v.mgmtNo)) existing = existingByMgmt.get(v.mgmtNo);
  else if (v.carNo && existingByCar.has(v.carNo)) existing = existingByCar.get(v.carNo);

  const props = {
    '車番': { title: [{ text: { content: title } }] },
    '管理番号': { rich_text: [{ text: { content: v.mgmtNo || '' } }] },
    '前輪サイズ': { rich_text: [{ text: { content: v.frSize || '' } }] },
    '後輪サイズ': { rich_text: [{ text: { content: v.rrSize || '' } }] },
    '本数': { number: totalQty },
    '仕様': { select: { name: guessSpec(v.axleCount, v.frQty, v.rrQty) } },
    '車種': { select: { name: guessCarType(v.frSize, v.rrSize) } },
    'タイヤカテゴリ': { select: { name: 'LTL TB ノーマル' } },
    '顧客': { relation: [{ id: v.customerId }] },
    'メモ': { rich_text: [{ text: { content:
      `顧客: ${v.customerName}\n` +
      `種別: ${v.customerType}\n` +
      `ファイル: ${v.sourceFile}\n` +
      `シート: ${v.sourceSheet}\n` +
      (v.memo ? `元備考: ${v.memo}\n` : '') +
      `インポート: 2026/4/20`
    } }] },
  };

  try {
    if (existing) {
      await nf('PATCH', '/pages/' + existing.id, { properties: props });
      updated++;
    } else {
      await nf('POST', '/pages', { parent: { database_id: VEHICLE_DB }, properties: props });
      created++;
    }
  } catch(e) { console.error(`  失敗 ${title}`, e.message); failed++; }
  await sleep(300);
  if ((created + updated + failed) % 25 === 0) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  進捗 ${i+1}/${matched.length} ✅${created}作成 ✏️${updated}更新 ❌${failed}失敗 / ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
  }
}

const elapsed = Math.round((Date.now() - startTime) / 1000);
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ 新規: ${created}  ✏️ 更新: ${updated}  ❌ 失敗: ${failed}`);
console.log(`⏱  ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
