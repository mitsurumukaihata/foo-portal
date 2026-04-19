// 2026/3 弥生内で売上明細(計算) vs 商品日報 vs 得意先日報 が +13,270円ズレている
// → 売上明細の伝票単位で、税抜計算とどこか狂っている可能性
// → 内税伝票で消費税行が欠けている等のパターン候補を探す
import XLSX from 'xlsx';
import fs from 'fs';

const YEAR = 2026;
const MONTH = 3;

const candidates = [
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.1-${YEAR}.3.xlsx`,
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR-1}.4-${YEAR}.3.xlsx`,
];
const FILE = candidates.find(p => fs.existsSync(p));
console.log('Excel:', FILE);

const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

const slips = new Map(); // num -> {isInternal, lines:[], taxLine, customer}
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  const ds = row[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(row[2]).trim();
  const taxType = String(row[7] || '');
  const customer = String(row[5] || row[4] || '').trim();
  const name = String(row[15] || '');
  const amount = parseFloat(row[25] || 0);
  if (!slips.has(num)) slips.set(num, { isInternal: /内税/.test(taxType), taxType, customer, lines: [], taxLine: 0 });
  const s = slips.get(num);
  if (name === '《消費税》') s.taxLine += amount;
  else s.lines.push({ name, amount, code: String(row[14] || '').trim() });
}

let calcTotal = 0;
const oddSlips = []; // 内税で消費税行なし、または金額異常の伝票
for (const [num, s] of slips) {
  const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
  let zeinuki;
  if (s.isInternal && s.taxLine === 0) {
    zeinuki = Math.round(lineSum / 1.1);
    s.note = '内税&消費税行なし → 1.1割り戻し';
  } else if (s.isInternal) {
    zeinuki = lineSum - s.taxLine;
    s.note = '内税&消費税行あり → 引き算';
  } else {
    zeinuki = lineSum;
    s.note = '外税 or その他 → そのまま';
  }
  s.lineSum = lineSum;
  s.zeinuki = zeinuki;
  calcTotal += zeinuki;

  // 「内税&消費税行なし」かつ 1.1割り戻しで端数が大きい場合は要疑い
  if (s.isInternal && s.taxLine === 0) {
    // 商品日報は明細を10%税抜で計算するので、計算値と差が出るパターン
    // 推定商品日報基準: 各明細を税込として税抜換算 → Math.round(line.amount / 1.1) を sum
    const altCalc = s.lines.reduce((a, x) => a + Math.round(x.amount / 1.1), 0);
    const delta = altCalc - zeinuki;
    if (Math.abs(delta) > 1) {
      oddSlips.push({ num, customer: s.customer, lineSum, zeinuki, altCalc, delta, taxType: s.taxType, lines: s.lines.length });
    }
  }
}

console.log(`売上明細(計算合計): ${calcTotal.toLocaleString()}`);
console.log(`伝票数: ${slips.size}`);
console.log();
console.log('=== 内税&消費税行なし伝票で「明細単位1.1割り戻し vs 伝票合計1.1割り戻し」の差 ===');
oddSlips.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
let totalDelta = 0;
for (const s of oddSlips.slice(0, 30)) {
  console.log(`伝票${s.num} 得意先${s.customer} 明細${s.lines}件 lineSum=${s.lineSum.toLocaleString()} zeinuki(伝票単位)=${s.zeinuki.toLocaleString()} alt(明細単位)=${s.altCalc.toLocaleString()} 差=${s.delta}`);
  totalDelta += s.delta;
}
console.log();
console.log(`差の合計（上位30件）: ${totalDelta.toLocaleString()}`);
console.log(`全 odd slips の差合計: ${oddSlips.reduce((a,s)=>a+s.delta,0).toLocaleString()}`);
console.log();

// 高額伝票を確認
const sorted = [...slips.entries()].sort(([,a],[,b]) => b.zeinuki - a.zeinuki).slice(0, 10);
console.log('=== 高額伝票TOP10 ===');
for (const [num, s] of sorted) {
  console.log(`伝票${num} ${s.customer} 税区分=${s.taxType} 明細${s.lines.length}件 税抜=${s.zeinuki.toLocaleString()} (lineSum=${s.lineSum.toLocaleString()}, taxLine=${s.taxLine.toLocaleString()})`);
}
