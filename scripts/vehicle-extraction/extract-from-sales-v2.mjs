#!/usr/bin/env node
// 売上明細 + 売上伝票 から車番を抽出し、車両マスタに不足分を追加準備
// per-slip filter 方式（300件キャップ回避）
//
// 出力:
//   all-cars-extracted.json      — 抽出した全車番（slip + detail ベース）
//   missing-vehicles.json        — 車両マスタに未登録のもの
//   extraction-stats.json        — 統計

import https from 'https';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

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

// 車番正規表現（hankana->zen済み前提）
const CAR_NUMBER_RE = /([\u4e00-\u9fff\u3040-\u309f]{1,4}\s*\d{2,4}\s*[\u3040-\u309f]\s*\d{1,4}-\d{1,4})/g;

// ─── ソース Excel から車番を抽出 ─────────
const BASE_DIR = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細';
const ALL_FILES = [
  '売上明細　2023.4-2023.6.xlsx', '売上明細　2023.7-2023.9.xlsx', '売上明細　2023.10-2023.12.xlsx',
  '売上明細　2024.1-2024.3.xlsx', '売上明細　2024.4-2025.3.xlsx',
  '売上明細　2025.4.xlsx', '売上明細　2025.5.xlsx', '売上明細　2025.6.xlsx',
  '売上明細　2025.7.xlsx', '売上明細　2025.8.xlsx', '売上明細　2025.9.xlsx',
  '売上明細　2025.10.xlsx', '売上明細　2025.11.xlsx', '売上明細　2025.12.xlsx',
  '売上明細　2026.1.xlsx', '売上明細　2026.2.xlsx', '売上明細　2026.3.xlsx',
];

console.log('━━━ 売上Excel から車番抽出 ━━━');
const carMap = new Map(); // carNo → { count, customers:Set, sampleSlips:[], firstDate, lastDate }

for (const file of ALL_FILES) {
  const filePath = path.join(BASE_DIR, file);
  if (!fs.existsSync(filePath)) { console.log(`⚠️ ${file} なし`); continue; }
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  let fileCount = 0;
  for (let i = 5; i < rows.length - 1; i++) {
    const row = rows[i];
    const denpyoNo = String(row[2] || '').trim();
    if (!denpyoNo) continue;
    const dateSerial = row[1];
    let dateStr = '';
    if (typeof dateSerial === 'number') {
      const d = new Date((dateSerial - 25569) * 86400 * 1000);
      dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
    const custName = String(row[6] || '').trim();
    const bikou = String(row[30] || '').trim();
    const matches = [...bikou.matchAll(CAR_NUMBER_RE)];
    for (const m of matches) {
      const car = m[1].replace(/\s/g, '');
      if (!carMap.has(car)) carMap.set(car, { count: 0, customers: new Set(), sampleSlips: [], firstDate: null, lastDate: null });
      const e = carMap.get(car);
      e.count++;
      e.customers.add(custName);
      if (e.sampleSlips.length < 5) e.sampleSlips.push({ slip: denpyoNo, date: dateStr });
      if (!e.firstDate || dateStr < e.firstDate) e.firstDate = dateStr;
      if (!e.lastDate || dateStr > e.lastDate) e.lastDate = dateStr;
      fileCount++;
    }
  }
  console.log(`  ${file}: ${fileCount}件抽出`);
}

console.log(`\n📊 ユニーク車番: ${carMap.size}台`);

// ─── 車両マスタと突合 ─────────
console.log('\n📥 車両マスタ取得中...');
const existingCars = new Set();
{
  let cursor = null;
  do {
    const b = { page_size: 100 };
    if (cursor) b.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + VEHICLE_DB + '/query', b);
    for (const p of (r.results || [])) {
      const cn = p.properties['車番']?.title?.[0]?.plain_text || '';
      if (cn) existingCars.add(cn.replace(/\s/g, ''));
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while(cursor);
}
console.log(`   既存車両マスタ: ${existingCars.size}台`);

const missing = [];
const existing = [];
for (const [car, info] of carMap) {
  const rec = {
    carNo: car,
    count: info.count,
    customers: [...info.customers],
    firstDate: info.firstDate,
    lastDate: info.lastDate,
    sampleSlips: info.sampleSlips,
  };
  if (existingCars.has(car)) existing.push(rec);
  else missing.push(rec);
}

// 出力
fs.writeFileSync(path.join(SCRIPT_DIR, 'all-cars-extracted.json'), JSON.stringify([...carMap.entries()].map(([k,v]) => ({ carNo:k, count:v.count, customers:[...v.customers], firstDate:v.firstDate, lastDate:v.lastDate })), null, 2));
fs.writeFileSync(path.join(SCRIPT_DIR, 'missing-vehicles.json'), JSON.stringify(missing, null, 2));
fs.writeFileSync(path.join(SCRIPT_DIR, 'extraction-stats.json'), JSON.stringify({
  totalUniqueCars: carMap.size,
  existingInMaster: existing.length,
  missingFromMaster: missing.length,
  totalDetailHits: [...carMap.values()].reduce((s,v)=>s+v.count, 0),
}, null, 2));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 ユニーク車番: ${carMap.size}台`);
console.log(`✅ 車両マスタにあり: ${existing.length}台`);
console.log(`🆕 未登録: ${missing.length}台`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log('→ missing-vehicles.json を確認 → import-to-master.mjs で登録');
