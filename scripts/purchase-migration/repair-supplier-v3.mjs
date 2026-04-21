#!/usr/bin/env node
// 仕入先 relation 修復 v3 — per-slip filter 方式（300件キャップ回避）
// 弥生伝票番号+仕入日 でDBをフィルタ→必ず<5件→PATCH

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SLIP_DB = '1587357d69e047699615b962c7dab6db';
const SUPPLIER_DB = 'f994513a5f5646d7bf1a65abe4067264';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, 'repair-v3.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function nf(method, p, body, retries = 6) {
  return new Promise((resolve) => {
    const tryFetch = (n, attempt = 1) => {
      const d = body ? JSON.stringify(body) : '';
      const opt = { hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json' } };
      if (d) opt.headers['Content-Length'] = Buffer.byteLength(d);
      const req = https.request(opt, r => {
        let c = ''; r.on('data', x => c += x);
        r.on('end', () => {
          let pp;
          try { pp = JSON.parse(c); }
          catch(e) { if (n>0) { setTimeout(()=>tryFetch(n-1, attempt+1), 5000); return; } return resolve({object:'error',code:'parse',message:e.message}); }
          if (pp?.object === 'error' && ['rate_limited','internal_server_error','service_unavailable','conflict_error','bad_gateway'].includes(pp.code) && n>0) {
            setTimeout(()=>tryFetch(n-1, attempt+1), Math.min(60000, 5000*Math.pow(2, attempt-1)));
            return;
          }
          resolve(pp);
        });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1, attempt+1), 5000); else resolve({object:'error',code:'network',message:e.message}); });
      req.setTimeout(45000, () => req.destroy());
      if (d) req.write(d); req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

log('━━━ repair-supplier-v3 開始 ━━━');

// 1. 仕入先マスタ取得（26件なので通常query OK）
log('📥 仕入先マスタ取得中...');
const suppliers = [];
{
  let cursor=null;
  do {
    const b={page_size:100}; if(cursor) b.start_cursor=cursor;
    const r = await nf('POST', '/databases/'+SUPPLIER_DB+'/query', b);
    suppliers.push(...(r.results||[]));
    cursor = r.has_more ? r.next_cursor : null;
  } while(cursor);
}
log(`   仕入先マスタ: ${suppliers.length}件`);

const nameToId = new Map();
const codeToId = new Map();
for (const s of suppliers) {
  const name = s.properties['仕入先名']?.title?.[0]?.plain_text || '';
  const code = s.properties['仕入先コード']?.rich_text?.[0]?.plain_text || '';
  if (name) nameToId.set(name, s.id);
  if (code) codeToId.set(code, s.id);
}
log(`   名前マップ: ${nameToId.size} / コードマップ: ${codeToId.size}`);

// 2. ソースデータ読み込み
const sourceSlips = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'purchase-slips.json'), 'utf-8'));
log(`📋 ソース伝票: ${sourceSlips.length}件`);

// 3. 各slipを個別filterで検索 → 必要ならPATCH
log('🔧 修復ループ開始...');
let found=0, patched=0, alreadyOk=0, notFound=0, fail=0;
const failures = [];
const startTime = Date.now();

for (let i = 0; i < sourceSlips.length; i++) {
  const src = sourceSlips[i];
  // 正しい supplier ID を算出
  const supplierId = codeToId.get(src.supplierCode) || nameToId.get(src.supplierName) || null;
  if (!supplierId) {
    notFound++;
    failures.push({ slipNo: src.slipNo, date: src.date, reason: 'supplier-not-in-master', code: src.supplierCode, name: src.supplierName });
    continue;
  }

  // フィルタで該当伝票ページを検索
  const body = {
    page_size: 5,
    filter: {
      and: [
        { property: '弥生伝票番号', rich_text: { equals: src.slipNo } },
        { property: '仕入日', date: { equals: src.date } },
      ]
    }
  };
  const r = await nf('POST', '/databases/' + SLIP_DB + '/query', body);
  const results = r?.results || [];
  if (!results.length) {
    notFound++;
    failures.push({ slipNo: src.slipNo, date: src.date, reason: 'page-not-found' });
    continue;
  }
  found++;

  // 全マッチをPATCH（通常は1件、まれに複数）
  for (const p of results) {
    const current = p.properties['仕入先']?.relation || [];
    if (current.length > 0 && current[0].id === supplierId) { alreadyOk++; continue; }
    const patchRes = await nf('PATCH', '/pages/' + p.id, {
      properties: { '仕入先': { relation: [{ id: supplierId }] } }
    });
    if (!patchRes || patchRes.object === 'error') {
      fail++;
      failures.push({ slipNo: src.slipNo, date: src.date, reason: 'patch-failed', error: patchRes?.message });
    } else {
      patched++;
    }
    await sleep(100);
  }

  if ((i+1) % 50 === 0) {
    const el = Math.round((Date.now()-startTime)/1000);
    const rate = (i+1) / (el || 1);
    const eta = Math.round((sourceSlips.length - i - 1) / (rate || 0.1));
    log(`  📊 ${i+1}/${sourceSlips.length} 🔍${found} ✅${patched} ⏭${alreadyOk} ❓${notFound} ❌${fail} / 経過${Math.floor(el/60)}分 残${Math.floor(eta/60)}分`);
    fs.writeFileSync(path.join(SCRIPT_DIR, 'repair-v3-failures.json'), JSON.stringify(failures, null, 2));
  }
}

const el = Math.round((Date.now()-startTime)/1000);
log('━━━ 完了 ━━━');
log(`🔍 検出: ${found}件 / ✅ PATCH: ${patched}件 / ⏭ 既にOK: ${alreadyOk}件`);
log(`❓ 未検出: ${notFound}件 / ❌ 失敗: ${fail}件`);
log(`⏱ 経過: ${Math.floor(el/60)}分${el%60}秒`);
if (failures.length) fs.writeFileSync(path.join(SCRIPT_DIR, 'repair-v3-failures.json'), JSON.stringify(failures, null, 2));
