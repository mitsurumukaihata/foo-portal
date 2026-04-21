#!/usr/bin/env node
// missing-vehicles.json を 車両マスタDB に一括登録
// 顧客候補が1つのみの場合は顧客紐付けあり、複数/無しは未紐付けで登録

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

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

const missing = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'missing-vehicles.json'), 'utf-8'));
console.log(`📥 登録対象: ${missing.length}件`);

let created = 0, failed = 0;
const startTime = Date.now();
for (let i = 0; i < missing.length; i++) {
  const v = missing[i];
  const props = {
    '車番': { title: [{ text: { content: v.carNo } }] },
    'メモ': { rich_text: [{ text: { content: `売上明細から自動抽出 (${v.detailCount}明細)` } }] },
  };
  // 顧客候補が1つのみなら紐付け
  if (v.customers.length === 1) {
    props['顧客'] = { relation: [{ id: v.customers[0].id }] };
  }
  try {
    const r = await nf('POST', '/pages', {
      parent: { database_id: VEHICLE_DB },
      properties: props,
    });
    if (r.id) created++;
    else { failed++; console.log(`  ❌ ${v.carNo}: ${JSON.stringify(r).slice(0,200)}`); }
  } catch(e) {
    failed++; console.log(`  ❌ ${v.carNo}: ${e.message}`);
  }
  if ((i + 1) % 20 === 0) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  進捗 ${i+1}/${missing.length} ✅${created} ❌${failed} / ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
  }
  await sleep(150); // レート制限対策
}

const elapsed = Math.round((Date.now() - startTime) / 1000);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ 作成: ${created}  ❌ 失敗: ${failed}`);
console.log(`⏱  ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
