#!/usr/bin/env node
// 12ファイルの仕入明細Excelを全部パースして JSON に変換
// 使い方: node parse-purchase-excel.mjs

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const BASE = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/仕入明細';
const SCRIPT_DIR = path.dirname(decodeURI(new URL(import.meta.url).pathname.replace(/^\//, '')));

function excelDate(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

function parseFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  // 見出し行: row4 のはず
  const headerIdx = rows.findIndex(r => r && r[1] === '仕入日');
  if (headerIdx === -1) throw new Error('Header not found');
  const data = rows.slice(headerIdx + 1).filter(r => r && r[2]); // 伝票番号があるもの

  // 伝票番号でグルーピング
  const slipMap = new Map();  // slipNo → { date, supplierCode, supplierName, taxKb, zekozo, tanto, details[] }
  for (const r of data) {
    const slipNo = String(r[2]).trim();
    const code = (r[13] || '').toString().trim();
    const isTax = code === '《消費税》' || (r[14] || '').toString().includes('消費税');
    if (!slipMap.has(slipNo)) {
      slipMap.set(slipNo, {
        slipNo,
        date: excelDate(r[1]),
        supplierCode: (r[5] || '').toString().trim(),
        supplierName: (r[6] || '').toString().trim(),
        taxKb: (r[7] || '').toString().trim(),         // 外税/伝票計
        taxCredit: (r[8] || '').toString().trim(),     // 適格 100％ 等（初出を保存）
        staff: (r[10] || '').toString().trim(),
        details: [],
        taxAmount: 0,
      });
    }
    const slip = slipMap.get(slipNo);
    if (!slip.taxCredit && (r[8] || '')) slip.taxCredit = (r[8] || '').toString().trim();
    if (!slip.staff && (r[10] || '')) slip.staff = (r[10] || '').toString().trim();
    if (isTax) {
      slip.taxAmount += Number(r[22]) || 0;
    } else {
      slip.details.push({
        breakdown: (r[11] || '').toString().trim(),  // 内訳
        arrived: !!r[12],                             // 入荷
        productCode: code,
        productName: (r[14] || '').toString().trim(),
        unit: (r[15] || '').toString().trim(),
        warehouse: (r[19] || '').toString().trim(),
        qty: Number(r[20]) || 0,
        price: Number(r[21]) || 0,
        amount: Number(r[22]) || 0,
        taxType: (r[26] || '').toString().trim(),   // 課税10.0% 等
        memo: (r[27] || '').toString().trim(),
        poNo: (r[28] || '').toString().trim() || '',
      });
    }
  }

  return [...slipMap.values()];
}

// 実行
const files = fs.readdirSync(BASE).filter(f => f.endsWith('.xlsx')).sort();
const allSlips = [];
const supplierMap = new Map();  // code → {code, name, count, totalAmount}
for (const f of files) {
  const slips = parseFile(path.join(BASE, f));
  console.log(`📁 ${f}: ${slips.length} 伝票 / ${slips.reduce((s, x) => s + x.details.length, 0)} 明細`);
  for (const slip of slips) {
    allSlips.push(slip);
    const k = slip.supplierCode || 'NOCODE';
    if (!supplierMap.has(k)) supplierMap.set(k, { code: slip.supplierCode, name: slip.supplierName, count: 0, totalAmount: 0, adequateCount: 0 });
    const s = supplierMap.get(k);
    s.count++;
    s.totalAmount += slip.details.reduce((a, d) => a + d.amount, 0) + slip.taxAmount;
    if (slip.taxCredit && slip.taxCredit.includes('100')) s.adequateCount++;
  }
}

const totalAmount = allSlips.reduce((s, x) => s + x.details.reduce((a, d) => a + d.amount, 0) + x.taxAmount, 0);
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`📊 合計: ${allSlips.length} 伝票 / ${allSlips.reduce((s, x) => s + x.details.length, 0)} 明細`);
console.log(`💴 税込合計: ¥${totalAmount.toLocaleString()}`);
console.log(`\n🏭 仕入先ランキング:`);
const suppliersSorted = [...supplierMap.values()].sort((a, b) => b.totalAmount - a.totalAmount);
for (const s of suppliersSorted.slice(0, 15)) {
  const adequatePct = s.count ? Math.round(s.adequateCount / s.count * 100) : 0;
  console.log(`  ${(s.code || '?').padEnd(6)} ${s.name.slice(0, 40).padEnd(40)} ${s.count.toString().padStart(4)}件 ¥${s.totalAmount.toLocaleString().padStart(12)} 適格${adequatePct}%`);
}

// JSON 出力
fs.writeFileSync(path.join(SCRIPT_DIR, 'purchase-slips.json'), JSON.stringify(allSlips, null, 1), 'utf-8');
fs.writeFileSync(path.join(SCRIPT_DIR, 'purchase-suppliers.json'), JSON.stringify(suppliersSorted, null, 2), 'utf-8');
console.log(`\n💾 purchase-slips.json  (${allSlips.length} 伝票)`);
console.log(`💾 purchase-suppliers.json  (${suppliersSorted.length} 仕入先)`);
