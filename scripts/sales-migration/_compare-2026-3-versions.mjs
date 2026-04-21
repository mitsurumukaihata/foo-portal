// 2026/3 修正前 vs 修正後 の売上明細を比較
import XLSX from 'xlsx';
import fs from 'fs';

const FILE_OLD = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　2026.3.xlsx';
const FILE_NEW = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細表　2026.3正.xlsx';

function parseFile(path) {
  const wb = XLSX.readFile(path);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const slips = new Map();
  let total = 0;
  for (let i = 5; i < data.length - 1; i++) {
    const r = data[i];
    if (!r || !r[2]) continue;
    const num = String(r[2]).trim();
    const code = String(r[14] || '').trim();
    const name = String(r[15] || '').trim();
    const qty = Number(r[21]) || 0;
    const tanka = Number(r[23]) || 0;
    const amount = Number(r[25]) || 0;
    const taxType = String(r[7] || '');
    const bikou = String(r[30] || '').trim();
    if (!slips.has(num)) slips.set(num, { isInternal: /内税/.test(taxType), lines: [], taxLine: 0 });
    const s = slips.get(num);
    if (name === '《消費税》') s.taxLine += amount;
    else s.lines.push({ code, name, qty, tanka, amount, bikou });
    total += amount;
  }
  return { slips, total };
}

console.log('=== 2026/3 売上明細 OLD vs NEW ===');
console.log();

const oldData = parseFile(FILE_OLD);
const newData = parseFile(FILE_NEW);

console.log('OLD:', oldData.slips.size, '伝票 / 金額合計', oldData.total.toLocaleString());
console.log('NEW:', newData.slips.size, '伝票 / 金額合計', newData.total.toLocaleString());
console.log('差  :', (newData.total - oldData.total).toLocaleString());
console.log();

// 税抜合計（伝票単位 round 方式）
function compTaxExcl(data) {
  let z = 0;
  for (const [num, s] of data.slips) {
    const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
    if (s.isInternal && s.taxLine === 0) z += Math.round(lineSum / 1.1);
    else if (s.isInternal) z += lineSum - s.taxLine;
    else z += lineSum;
  }
  return z;
}
console.log('税抜合計（計算）:');
console.log('  OLD:', compTaxExcl(oldData).toLocaleString());
console.log('  NEW:', compTaxExcl(newData).toLocaleString());
console.log();

// 差分伝票
const oldNums = new Set(oldData.slips.keys());
const newNums = new Set(newData.slips.keys());
const onlyOld = [...oldNums].filter(n => !newNums.has(n));
const onlyNew = [...newNums].filter(n => !oldNums.has(n));
console.log('OLDのみ:', onlyOld.length, '件');
console.log('NEWのみ:', onlyNew.length, '件');
if (onlyOld.length) console.log('  OLDだけの伝票:', onlyOld.join(', '));
if (onlyNew.length) console.log('  NEWだけの伝票:', onlyNew.join(', '));
console.log();

// 両方にある伝票で中身が違うもの
const diffSlips = [];
for (const num of oldNums) {
  if (!newNums.has(num)) continue;
  const o = oldData.slips.get(num);
  const n = newData.slips.get(num);
  const oSum = o.lines.reduce((a, x) => a + x.amount, 0);
  const nSum = n.lines.reduce((a, x) => a + x.amount, 0);
  if (oSum !== nSum || o.lines.length !== n.lines.length || o.taxLine !== n.taxLine) {
    diffSlips.push({ num, old: { sum: oSum, lines: o.lines.length, tax: o.taxLine }, new: { sum: nSum, lines: n.lines.length, tax: n.taxLine }, oData: o, nData: n });
  }
}
console.log('内容が変わった伝票:', diffSlips.length, '件');
for (const d of diffSlips) {
  console.log(`  伝票${d.num}: 金額${d.old.sum}→${d.new.sum} / 明細${d.old.lines}→${d.new.lines} / 消費税行${d.old.tax}→${d.new.tax}`);
  // 詳細差分
  const oLines = d.oData.lines;
  const nLines = d.nData.lines;
  const oKey = oLines.map(l => `${l.code}|${l.qty}|${l.tanka}|${l.amount}`);
  const nKey = nLines.map(l => `${l.code}|${l.qty}|${l.tanka}|${l.amount}`);
  for (let i = 0; i < oLines.length; i++) {
    if (!nKey.includes(oKey[i])) {
      const l = oLines[i];
      console.log(`    OLD行: [${l.code}] ${l.name} qty=${l.qty} 単価=${l.tanka} 金額=${l.amount} 備考=${l.bikou}`);
    }
  }
  for (let i = 0; i < nLines.length; i++) {
    if (!oKey.includes(nKey[i])) {
      const l = nLines[i];
      console.log(`    NEW行: [${l.code}] ${l.name} qty=${l.qty} 単価=${l.tanka} 金額=${l.amount} 備考=${l.bikou}`);
    }
  }
}
