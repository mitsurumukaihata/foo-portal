#!/usr/bin/env node
// 仕入先 relation が空の仕入伝票を修復
// 1. 仕入先マスタDBから「仕入先名→ID」マップ構築
// 2. 弥生伝票番号 → purchase-slips.json から supplierCode / supplierName を引く
// 3. supplier-id-mapping.json[supplierCode] または名前マップで ID を取得
// 4. 空の伝票にPATCHで仕入先をセット

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SLIP_DS = 'e44b7179-7b09-4fc7-9c09-a2783f678283';
const SUPPLIER_DB = 'f994513a5f5646d7bf1a65abe4067264';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, 'repair.log');

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
          catch(e) { if (n>0) { setTimeout(()=>tryFetch(n-1, attempt+1), 5000); return; } return resolve({object:'error', code:'parse', message:e.message}); }
          if (pp?.object === 'error' && ['rate_limited','internal_server_error','service_unavailable','conflict_error','bad_gateway'].includes(pp.code) && n>0) {
            setTimeout(()=>tryFetch(n-1, attempt+1), Math.min(60000, 5000*Math.pow(2, attempt-1)));
            return;
          }
          resolve(pp);
        });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1, attempt+1), 5000); else resolve({object:'error', code:'network', message:e.message}); });
      req.setTimeout(45000, () => req.destroy());
      if (d) req.write(d); req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 仕入先マスタから名前→ID マップ構築
log('📥 仕入先マスタ読込中...');
const suppliers = [];
{
  // data_sources は SUPPLIER_DB の collection を解決する必要 → WorkerがDB→DS自動変換するのでこれでOK
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

// purchase-slips.json から 弥生伝票番号+日付 → 仕入先情報
const sourceSlips = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'purchase-slips.json'), 'utf-8'));
const slipMap = new Map();
for (const s of sourceSlips) {
  slipMap.set(s.slipNo + '|' + s.date, { code: s.supplierCode, name: s.supplierName });
}
log(`   ソーススリップマップ: ${slipMap.size}件`);

// 仕入先未設定の伝票を全件取得（ページネーション）
log('📥 仕入先未設定伝票を取得中...');
const emptySlips = [];
{
  let cursor=null;
  do {
    const b = {
      page_size: 100,
      filter: { property: '仕入先', relation: { is_empty: true } }
    };
    if (cursor) b.start_cursor = cursor;
    const r = await nf('POST', '/data_sources/'+SLIP_DS+'/query', b);
    emptySlips.push(...(r.results||[]));
    cursor = r.has_more ? r.next_cursor : null;
    process.stdout.write(`\r   ${emptySlips.length}件...`);
  } while(cursor);
}
log(`\n   対象: ${emptySlips.length}件`);

// 修復
log('🔧 修復開始...');
let ok=0, skip=0, fail=0;
const notFound = [];
const startTime = Date.now();
for (let i = 0; i < emptySlips.length; i++) {
  const p = emptySlips[i];
  const slipNo = p.properties['弥生伝票番号']?.rich_text?.[0]?.plain_text || '';
  const date = p.properties['仕入日']?.date?.start || '';
  const src = slipMap.get(slipNo + '|' + date);
  if (!src) { skip++; notFound.push({ slipNo, date, pageId: p.id }); continue; }
  // まず コード、ダメなら名前
  let supplierId = codeToId.get(src.code) || nameToId.get(src.name) || null;
  if (!supplierId) { skip++; notFound.push({ slipNo, date, code: src.code, name: src.name, pageId: p.id }); continue; }

  const r = await nf('PATCH', '/pages/' + p.id, {
    properties: { '仕入先': { relation: [{ id: supplierId }] } }
  });
  if (!r || r.object === 'error') {
    fail++;
    log(`  ❌ ${slipNo} ${date} → ${r?.code}:${r?.message?.slice(0,80)}`);
  } else {
    ok++;
  }
  await sleep(200);
  if ((i+1) % 50 === 0) {
    const el = Math.round((Date.now()-startTime)/1000);
    log(`  📊 ${i+1}/${emptySlips.length} ✅${ok} ⏭${skip} ❌${fail} / ${Math.floor(el/60)}分`);
  }
}

const el = Math.round((Date.now()-startTime)/1000);
log('━━━ 完了 ━━━');
log(`✅ 修復: ${ok}件  ⏭ 該当なし: ${skip}件  ❌ 失敗: ${fail}件`);
log(`⏱ 経過: ${Math.floor(el/60)}分${el%60}秒`);
if (notFound.length) {
  fs.writeFileSync(path.join(SCRIPT_DIR, 'supplier-not-found.json'), JSON.stringify(notFound, null, 2));
  log(`→ supplier-not-found.json にスキップ詳細 (${notFound.length}件)`);
}
