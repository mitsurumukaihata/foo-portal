// CLO FOOパック契約の月額分析
import XLSX from 'xlsx';
import fs from 'fs';

const FILE = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/../Downloads/支払明細　CLO (2).xlsx';
const alt = 'C:/Users/Mitsuru Mukaihata/Downloads/支払明細　CLO (2).xlsx';
const actualFile = fs.existsSync(FILE) ? FILE : alt;
const wb = XLSX.readFile(actualFile);

console.log('契約NO | 契約日 | 総額 | 残価 | 月額 | 60回×月額 | 差 | 税抜月額 | 税込月額');
console.log('─'.repeat(110));

const contracts = [];
for (const sname of wb.SheetNames) {
  if (!sname.startsWith('CLO 19')) continue;
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sname], { header: 1 });
  const getCell = (r, c) => {
    const row = data[r] || [];
    return row[c];
  };
  const contractNo = sname.trim();
  const contractDate = getCell(7, 3);
  const total = Number(getCell(12, 4)) || Number(getCell(12, 3)) || 0;
  const residual = Number(getCell(12, 8)) || 0;
  // 月額: row 22 col 4=支払金額 col 6=消費税（右側 col 14 / 16）
  const firstPayment = Number(getCell(22, 4)) || 0;
  const firstTax = Number(getCell(22, 6)) || 0;
  const firstExcl = firstPayment - firstTax;
  const allPayments = [];
  for (let i = 22; i < 100; i++) {
    const p1 = Number(getCell(i, 4)) || 0;
    const t1 = Number(getCell(i, 6)) || 0;
    if (p1 > 0) allPayments.push({ amount: p1, tax: t1 });
    const p2 = Number(getCell(i, 14)) || 0;
    const t2 = Number(getCell(i, 16)) || 0;
    if (p2 > 0) allPayments.push({ amount: p2, tax: t2 });
  }
  const sumAll = allPayments.reduce((a, x) => a + x.amount, 0);
  const count = allPayments.length;
  const expected60 = firstPayment * 60;
  contracts.push({ contractNo, contractDate, total, residual, firstPayment, firstTax, firstExcl, sumAll, count, expected60 });
  console.log(`${contractNo.padEnd(10)} | ${String(contractDate).padEnd(10)} | ${String(total).padStart(8)} | ${String(residual).padStart(6)} | ${String(firstPayment).padStart(6)} | ${String(expected60).padStart(9)} | ${String(total - expected60).padStart(5)} | ${String(firstExcl).padStart(7)} | ${String(firstPayment).padStart(7)} | ${count}回`);
}

console.log();
console.log('契約数:', contracts.length);

// 回数ごとにユニーク月額があるか確認（最後の回が調整月額か）
console.log();
console.log('=== サンプル契約(CLO 19-50) の全60回お支払明細 ===');
const s = wb.Sheets['CLO 19-50'];
const d = XLSX.utils.sheet_to_json(s, { header: 1 });
const payments = [];
for (let i = 22; i < 100; i++) {
  const r = d[i] || [];
  const p1 = Number(r[4]) || 0;
  const t1 = Number(r[6]) || 0;
  const p2 = Number(r[14]) || 0;
  const t2 = Number(r[16]) || 0;
  if (p1 > 0) payments.push({ no: Number(r[1]) || 0, amount: p1, tax: t1 });
  if (p2 > 0) payments.push({ no: Number(r[11]) || 0, amount: p2, tax: t2 });
}
payments.sort((a, b) => a.no - b.no);
let sum = 0, sumTax = 0;
const uniqueAmounts = new Map();
for (const p of payments) {
  sum += p.amount;
  sumTax += p.tax;
  const key = `${p.amount}/${p.tax}`;
  uniqueAmounts.set(key, (uniqueAmounts.get(key) || 0) + 1);
}
console.log('ユニーク月額パターン:');
for (const [k, v] of uniqueAmounts) console.log(`  ${k} → ${v}回`);
console.log(`合計: ${sum} / 消費税: ${sumTax} / 税抜: ${sum - sumTax}`);

// 60回毎月額 vs 契約総額の差
console.log();
console.log('契約総額との差:');
const total = 780340;
console.log(`  契約総額: ${total}`);
console.log(`  60回合計: ${sum}`);
console.log(`  差      : ${total - sum}`);
