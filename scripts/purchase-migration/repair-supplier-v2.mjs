#!/usr/bin/env node
// 仕入先 relation が空の仕入伝票を修復（/search API 回避策版）

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { notionRequest, fetchAllPagesInDb } from './_search-helper.mjs';

const SLIP_DB_IDS = [
  '1587357d-69e0-4769-9615-b962c7dab6db',
  'e44b7179-7b09-4fc7-9c09-a2783f678283',
];
const SUPPLIER_DB_IDS = [
  'f994513a-5f56-46d7-bf1a-65abe4067264',
  'b4458c5b-3e5c-4642-803c-2ca909467d3d',
];
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, 'repair-v2.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

log('━━━ repair-supplier-v2 開始 ━━━');

// 1. 仕入先マスタ取得
log('📥 仕入先マスタ取得中（/search経由）...');
const suppliers = await fetchAllPagesInDb(SUPPLIER_DB_IDS, {
  onProgress: (c, s) => process.stdout.write(`\r   ヒット ${c} / スキャン ${s}`)
});
log(`\n   仕入先マスタ: ${suppliers.length}件`);

const nameToId = new Map();
const codeToId = new Map();
for (const s of suppliers) {
  const name = s.properties['仕入先名']?.title?.[0]?.plain_text || '';
  const code = s.properties['仕入先コード']?.rich_text?.[0]?.plain_text || '';
  if (name) nameToId.set(name, s.id);
  if (code) codeToId.set(code, s.id);
}
log(`   名前マップ: ${nameToId.size} / コードマップ: ${codeToId.size}`);

// 2. ソース側のマップ
const sourceSlips = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'purchase-slips.json'), 'utf-8'));
const slipMap = new Map();
for (const s of sourceSlips) {
  slipMap.set(s.slipNo + '|' + s.date, { code: s.supplierCode, name: s.supplierName });
}

// 3. 仕入伝票全件取得
log('📥 仕入伝票全件取得中（/search経由）...');
const slips = await fetchAllPagesInDb(SLIP_DB_IDS, {
  onProgress: (c, s) => process.stdout.write(`\r   ヒット ${c} / スキャン ${s}`)
});
log(`\n   仕入伝票: ${slips.length}件`);

// 仕入先未設定のみ
const emptySlips = slips.filter(p => !p.properties['仕入先']?.relation?.length);
log(`   そのうち仕入先未設定: ${emptySlips.length}件`);

// 4. 修復
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
  let supplierId = codeToId.get(src.code) || nameToId.get(src.name) || null;
  if (!supplierId) { skip++; notFound.push({ slipNo, date, code: src.code, name: src.name, pageId: p.id }); continue; }

  const r = await notionRequest('PATCH', '/pages/' + p.id, {
    properties: { '仕入先': { relation: [{ id: supplierId }] } }
  });
  if (!r || r.object === 'error') {
    fail++;
    log(`  ❌ ${slipNo} ${date} → ${r?.code}:${r?.message?.slice(0,80)}`);
  } else {
    ok++;
  }
  await sleep(180);
  if ((i+1) % 50 === 0) {
    const el = Math.round((Date.now()-startTime)/1000);
    const rate = ok / (el || 1);
    const eta = Math.round((emptySlips.length - i - 1) / (rate || 0.1));
    log(`  📊 ${i+1}/${emptySlips.length} ✅${ok} ⏭${skip} ❌${fail} / 経過${Math.floor(el/60)}分 残${Math.floor(eta/60)}分`);
  }
}

const el = Math.round((Date.now()-startTime)/1000);
log('━━━ 完了 ━━━');
log(`✅ 修復: ${ok}  ⏭ 該当なし: ${skip}  ❌ 失敗: ${fail}`);
log(`⏱ 経過: ${Math.floor(el/60)}分${el%60}秒`);
if (notFound.length) {
  fs.writeFileSync(path.join(SCRIPT_DIR, 'supplier-not-found-v2.json'), JSON.stringify(notFound, null, 2));
  log(`→ supplier-not-found-v2.json に詳細 (${notFound.length}件)`);
}
