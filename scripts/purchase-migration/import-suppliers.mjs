#!/usr/bin/env node
// 仕入先マスタにユニーク仕入先を登録
// purchase-suppliers.json → Notion 仕入先マスタDB

import https from 'https';
import fs from 'fs';
import path from 'path';

const SUPPLIER_DB = 'f994513a5f5646d7bf1a65abe4067264';

function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
      }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const pp = JSON.parse(c);
            if (pp.object === 'error' && ['rate_limited','internal_server_error','service_unavailable'].includes(pp.code) && n > 0) {
              setTimeout(() => tryFetch(n - 1), Math.min(30000, 2000 * Math.pow(2, 5 - n)));
              return;
            }
            res(pp);
          } catch(e) { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); }
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

const SCRIPT_DIR = path.dirname(decodeURI(new URL(import.meta.url).pathname.replace(/^\//, '')));
const suppliers = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'purchase-suppliers.json'), 'utf-8'));
console.log('📥 仕入先:', suppliers.length);

// 既存の仕入先を取得（コードで重複チェック）
console.log('🔍 既存仕入先を確認中...');
const existing = new Map();
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SUPPLIER_DB + '/query', body);
  for (const p of r.results || []) {
    const c = p.properties['仕入先コード']?.rich_text?.[0]?.plain_text || '';
    const nm = p.properties['仕入先名']?.title?.[0]?.plain_text || '';
    if (c) existing.set(c, p.id);
    else if (nm) existing.set('name:' + nm, p.id);
  }
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('   既存:', existing.size, '件');

// マッピング出力用
const mapping = {}; // supplierCode → pageId

let created = 0, skipped = 0, failed = 0;
for (const s of suppliers) {
  const key = s.code || ('name:' + s.name);
  if (existing.has(key)) {
    mapping[s.code] = existing.get(key);
    skipped++;
    continue;
  }
  const isAdequate = s.adequateCount > 0;
  // メーカー判定
  let maker = 'その他';
  if (/ﾄｰﾖｰ|TOYO/i.test(s.name)) maker = 'TOYO';
  else if (/ﾌﾞﾘﾁﾞｽﾄﾝ|ブリヂストン|BRIDGESTONE/i.test(s.name)) maker = 'BRIDGESTONE';
  else if (/ﾀﾞﾝﾛｯﾌﾟ|ダンロップ|DUNLOP/i.test(s.name)) maker = 'DUNLOP';
  else if (/ﾐｼｭﾗﾝ|ミシュラン|MICHELIN/i.test(s.name)) maker = 'MICHELIN';
  else if (/ピレリ|PIRELLI/i.test(s.name)) maker = 'PIRELLI';
  const props = {
    '仕入先名': { title: [{ text: { content: s.name.slice(0, 200) } }] },
    '仕入先コード': { rich_text: [{ text: { content: s.code || '' } }] },
    '適格請求書事業者': { checkbox: isAdequate },
    '有効': { checkbox: true },
    'メモ': { rich_text: [{ text: { content: `メーカー: ${maker}\n弥生コード: ${s.code}\n取引件数: ${s.count}件\n取引総額: ¥${Math.round(s.totalAmount).toLocaleString()}\n移行: 2026/4/20` } }] },
  };
  try {
    const r = await nf('POST', '/pages', { parent: { database_id: SUPPLIER_DB }, properties: props });
    mapping[s.code] = r.id;
    created++;
    if (created % 5 === 0) console.log('  作成:', created);
  } catch(e) { console.error('  失敗', s.name, e.message); failed++; }
  await sleep(300);
}

fs.writeFileSync(path.join(SCRIPT_DIR, 'supplier-id-mapping.json'), JSON.stringify(mapping, null, 2));
console.log('\n✅ 新規作成:', created, '/ ⏭️ スキップ:', skipped, '/ ❌ 失敗:', failed);
console.log('💾 supplier-id-mapping.json 保存 (仕入伝票インポート用)');
