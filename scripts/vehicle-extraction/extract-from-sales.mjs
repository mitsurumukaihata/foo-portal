#!/usr/bin/env node
// 売上明細DBから車番を抽出 → 車両マスタと突合 → 不足車両を洗い出す
// 出力:
//   extracted-cars.json       — 全抽出結果（車番ごとに顧客候補・明細数等）
//   missing-vehicles.json     — 車両マスタに無い車両（新規登録対象）
//   stats.json                — 統計サマリ

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';
const CUSTOMER_DB = 'f632f512f12d49b2b11f2b3e45c70aec';
const ENDUSER_DB = '1ca8d122be214e3892879932147143c9';

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

async function fetchAll(db) {
  const all = []; let cursor = null; let page = 0;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + db + '/query', body);
    all.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
    page++;
    if (page % 5 === 0) process.stdout.write(`\r   ${all.length}件取得中...`);
  } while (cursor);
  return all;
}

// 広島ナンバープレート形式の検出
// 例: 広島100あ1234, 福山300い5678, 鈴鹿100う 1234 等
const PLATE_RE = /([\u4e00-\u9fa5]{1,4})\s*(\d{1,3})\s*([\u3041-\u3093\u30a1-\u30f6A-Z])\s*[\- ]?\s*(\d{1,4}[\-\s]?\d{0,4})/g;
// 管理番号的パターン（4桁数字 or 英字+数字）
const MGMT_RE = /\b([A-Z]{1,3}[\-\s]?\d{2,5}|\d{4})\b/g;

function normalizeCarNo(s) {
  if (!s) return '';
  return s
    .replace(/[ \t]+/g, '')
    .replace(/[ー－]/g, '-')
    .replace(/\s/g, '');
}

function extractPlates(text) {
  if (!text) return [];
  const out = [];
  // 簡易: 区切り記号で分割
  const parts = text.split(/[,、，\/／\n]/g).map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    // ナンバープレート形式らしきものだけ
    if (/^[\u4e00-\u9fa5]{1,4}\s*\d{1,3}\s*[\u3041-\u3093\u30a1-\u30f6A-Z]\s*\d/.test(p)) {
      out.push(normalizeCarNo(p));
    }
  }
  return out;
}

console.log('━━━ 車番抽出スクリプト ━━━');
console.log('📥 車両マスタ読込中...');
const existingVehicles = await fetchAll(VEHICLE_DB);
console.log(`\n   既存車両: ${existingVehicles.length}件`);
const existingCarSet = new Set();
for (const v of existingVehicles) {
  const cn = v.properties['車番']?.title?.[0]?.plain_text;
  if (cn) existingCarSet.add(normalizeCarNo(cn));
}

console.log('📥 得意先マスタ + 顧客情報DB 読込中...');
const [custs, endusers] = await Promise.all([fetchAll(CUSTOMER_DB), fetchAll(ENDUSER_DB)]);
const custMap = new Map();
for (const c of custs) {
  const name = c.properties['得意先名']?.title?.[0]?.plain_text || '';
  if (name) custMap.set(c.id, { name, type: 'customer' });
}
for (const u of endusers) {
  const name = u.properties['顧客名']?.title?.[0]?.plain_text || u.properties['Name']?.title?.[0]?.plain_text || '';
  if (name) custMap.set(u.id, { name, type: 'enduser' });
}
console.log(`   得意先: ${custs.length} / エンドユーザー: ${endusers.length}`);

console.log('📥 売上伝票 読込中（請求先/顧客マップ用）...');
const slips = await fetchAll(SALES_DB);
console.log(`\n   売上伝票: ${slips.length}件`);
const slipCustomerMap = new Map();
for (const s of slips) {
  const billId = s.properties['請求先']?.relation?.[0]?.id;
  const endId = s.properties['顧客名']?.relation?.[0]?.id;
  slipCustomerMap.set(s.id, { billId, endId });
}

console.log('📥 売上明細 読込中...');
const details = await fetchAll(DETAIL_DB);
console.log(`\n   売上明細: ${details.length}件`);

// 車番抽出
const carMap = new Map(); // key=normalizedCarNo, val={raw,count,custIds:Set,sampleSlips:[]}
const mgmtMap = new Map();
let detailsWithCarField = 0;
let multiCarDetails = 0;
for (const d of details) {
  const carField = d.properties['車番']?.rich_text?.map(t => t.plain_text).join('') || '';
  const memo = d.properties['備考']?.rich_text?.map(t => t.plain_text).join('') || '';
  const slipId = d.properties['売上伝票']?.relation?.[0]?.id;
  const custInfo = slipCustomerMap.get(slipId) || {};

  const cars = [];
  if (carField) {
    detailsWithCarField++;
    cars.push(...extractPlates(carField));
    if (/[,、，\/／]/.test(carField)) multiCarDetails++;
  }
  cars.push(...extractPlates(memo));

  for (const c of cars) {
    if (!carMap.has(c)) carMap.set(c, { raw: c, count: 0, custIds: new Set(), sampleSlips: [] });
    const e = carMap.get(c);
    e.count++;
    if (custInfo.endId) e.custIds.add(custInfo.endId);
    else if (custInfo.billId) e.custIds.add(custInfo.billId);
    if (e.sampleSlips.length < 3) e.sampleSlips.push(slipId);
  }
}

const allCars = [...carMap.values()];
const missing = allCars.filter(c => !existingCarSet.has(c.raw));

// 候補顧客を人間可読に
const serialize = (c) => ({
  carNo: c.raw,
  detailCount: c.count,
  customers: [...c.custIds].map(id => ({ id, name: custMap.get(id)?.name || id.slice(0,8), type: custMap.get(id)?.type || '?' })),
  sampleSlipIds: c.sampleSlips,
});

fs.writeFileSync(path.join(SCRIPT_DIR, 'extracted-cars.json'), JSON.stringify(allCars.map(serialize), null, 2));
fs.writeFileSync(path.join(SCRIPT_DIR, 'missing-vehicles.json'), JSON.stringify(missing.map(serialize), null, 2));
fs.writeFileSync(path.join(SCRIPT_DIR, 'stats.json'), JSON.stringify({
  totalDetails: details.length,
  detailsWithCarField,
  multiCarDetails,
  uniqueCarsExtracted: allCars.length,
  existingVehicles: existingVehicles.length,
  missingToAdd: missing.length,
}, null, 2));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 売上明細総数: ${details.length}`);
console.log(`   車番フィールド有: ${detailsWithCarField} / カンマ含: ${multiCarDetails}`);
console.log(`🚚 抽出ユニーク車番: ${allCars.length}`);
console.log(`✅ 既存マッチ: ${allCars.length - missing.length}`);
console.log(`🆕 マスタ未登録: ${missing.length}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('→ missing-vehicles.json を確認 → add-missing.mjs で登録');
