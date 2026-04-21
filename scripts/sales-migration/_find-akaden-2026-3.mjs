// 2026/3 売上明細から赤伝（マイナス伝票 or マイナス金額）を全部抽出
import XLSX from 'xlsx';
import fs from 'fs';

const FILE = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　2026.3.xlsx';
const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

console.log('=== 2026/3 赤伝・マイナス金額 抽出 ===');
console.log();

// マイナス金額の行を全部
const negLines = [];
for (let i = 5; i < data.length - 1; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const amount = Number(r[25]) || 0;
  const qty = Number(r[21]) || 0;
  if (amount < 0 || qty < 0) {
    negLines.push({
      row: i,
      num: String(r[2]).trim(),
      torihiki: String(r[3] || ''),
      cust: String(r[6] || ''),
      code: String(r[14] || ''),
      name: String(r[15] || ''),
      qty,
      tanka: Number(r[23]) || 0,
      amount,
      bikou: String(r[30] || ''),
    });
  }
}
console.log('マイナス行:', negLines.length);
for (const l of negLines) {
  console.log(`  伝票${l.num} ${l.cust.slice(0,20).padEnd(20)} [${l.code}] ${l.name.slice(0,25).padEnd(25)} qty=${String(l.qty).padStart(5)} 単価=${String(l.tanka).padStart(6)} 金額=${String(l.amount).padStart(8)} 備考=${l.bikou.slice(0,30)}`);
}
console.log();

// 取引区分別（赤伝指定がある場合）
const torihikiKubun = new Map();
for (let i = 5; i < data.length - 1; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const t = String(r[3] || '').trim();
  if (!t) continue;
  torihikiKubun.set(t, (torihikiKubun.get(t) || 0) + 1);
}
console.log('取引区分分布:');
for (const [k, v] of torihikiKubun) console.log(`  ${k}: ${v}行`);
console.log();

// 伝票00003978 を詳細表示
console.log('=== 伝票00003978 全行 ===');
for (let i = 5; i < data.length - 1; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  if (String(r[2]).trim() !== '00003978') continue;
  console.log(`  col3(取引区分)=${r[3]||''} | [${r[14]}] ${r[15]} qty=${r[21]||0} 単価=${r[23]||0} 金額=${r[25]||0} 備考=${r[30]||''}`);
}
console.log();

// 13,300円の金額を持つ伝票（全体）
console.log('=== 13,300円を含む伝票 ===');
const related = new Set();
for (let i = 5; i < data.length - 1; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const a = Math.abs(Number(r[25]) || 0);
  if (a === 13300) related.add(String(r[2]).trim());
}
for (const n of related) {
  for (let i = 5; i < data.length - 1; i++) {
    const r = data[i];
    if (!r || !r[2] || String(r[2]).trim() !== n) continue;
    console.log(`  伝票${n} [${r[14]}] ${r[15]} qty=${r[21]||0} 単価=${r[23]||0} 金額=${r[25]||0} 備考=${r[30]||''}`);
  }
}
