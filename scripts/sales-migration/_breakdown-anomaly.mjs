// 異常値月の差額を商品コード別に分解（FOOパック丸め誤差を分離）
import XLSX from 'xlsx';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '2025'));
const MONTH = parseInt(getArg('month', '6'));

function readSales(y, m) {
  const candidates = [
    `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${y}.${m}.xlsx`,
    `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${y}.${m}.xlsx`,
  ];
  const qs = [[1,3],[4,6],[7,9],[10,12]];
  for (const [s, e] of qs) if (m >= s && m <= e) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${y}.${s}-${y}.${e}.xlsx`);
  if (m >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${y}.4-${y+1}.3.xlsx`);
  else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${y-1}.4-${y}.3.xlsx`);
  return candidates.find(p => fs.existsSync(p));
}

const file = readSales(YEAR, MONTH);
if (!file) { console.log('売上明細なし'); process.exit(1); }
const wb = XLSX.readFile(file);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

// 伝票単位にグループ化
const slips = new Map();
for (let i = 5; i < data.length - 1; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const ds = r[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(r[2]).trim();
  const taxType = String(r[7] || '');
  const code = String(r[14] || '').trim();
  const name = String(r[15] || '').trim();
  const qty = Number(r[21]) || 0;
  const amount = Number(r[25]) || 0;
  if (!slips.has(num)) slips.set(num, { isInternal: /内税/.test(taxType), cust: String(r[6]||''), lines: [], taxLine: 0 });
  const s = slips.get(num);
  if (name === '《消費税》') s.taxLine += amount;
  else s.lines.push({ code, name, qty, amount });
}

// 商品コード別の税抜を計算（内税伝票は按分）
const salesByCode = new Map();
function add(code, name, qty, amount) {
  const cur = salesByCode.get(code) || { name, qty: 0, amount: 0 };
  cur.qty += qty;
  cur.amount += amount;
  salesByCode.set(code, cur);
}
for (const [num, s] of slips) {
  if (s.isInternal && s.taxLine === 0) {
    const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
    if (lineSum === 0) continue;
    const zSlip = Math.round(lineSum / 1.1);
    for (const l of s.lines) {
      const share = Math.round(zSlip * l.amount / lineSum);
      add(l.code, l.name, l.qty, share);
    }
  } else {
    const taxDed = s.taxLine || 0;
    const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
    for (const l of s.lines) {
      let z = l.amount;
      if (s.isInternal && taxDed > 0 && lineSum > 0) {
        z -= Math.round(taxDed * l.amount / lineSum);
      }
      add(l.code, l.name, l.qty, z);
    }
  }
}

// 商品別売上日報
const repPath = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
const rwb = XLSX.readFile(repPath);
const rd = XLSX.utils.sheet_to_json(rwb.Sheets[rwb.SheetNames[0]], { header: 1 });
const repByCode = new Map();
for (let i = 5; i < rd.length; i++) {
  const r = rd[i];
  if (!r || !r[1] || String(r[1]).trim() === '<<総合計>>') continue;
  repByCode.set(String(r[1]).trim(), { name: String(r[2]||''), qty: Number(r[3])||0, net: Number(r[10])||0 });
}

// 差分分析
const allCodes = new Set([...salesByCode.keys(), ...repByCode.keys()]);
const diffs = [];
let fooTotal = 0, nonFooTotal = 0;
let salesTotal = 0, repTotal = 0;
for (const code of allCodes) {
  const s = salesByCode.get(code) || { name: '', qty: 0, amount: 0 };
  const r = repByCode.get(code) || { name: '', qty: 0, net: 0 };
  salesTotal += s.amount;
  repTotal += r.net;
  const diff = s.amount - r.net;
  if (Math.abs(diff) >= 1) {
    const isFoo = /^FOO/i.test(code);
    if (isFoo) fooTotal += diff;
    else nonFooTotal += diff;
    diffs.push({ code, name: s.name || r.name, qty: s.qty, diff, isFoo });
  }
}

console.log(`=== ${YEAR}/${MONTH} 差額分解 ===`);
console.log(`売上明細計算: ${salesTotal.toLocaleString()}`);
console.log(`商品日報純売上: ${repTotal.toLocaleString()}`);
console.log(`全体差額: ${(salesTotal - repTotal).toLocaleString()}`);
console.log();
console.log(`FOOパック丸め誤差: ${fooTotal.toLocaleString()} 円`);
console.log(`非FOO異常値    : ${nonFooTotal.toLocaleString()} 円  ← これが弥生で探すべき金額`);
console.log();
console.log('非FOO差額の内訳（大きい順）:');
const nonFooDiffs = diffs.filter(d => !d.isFoo).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
for (const d of nonFooDiffs.slice(0, 30)) {
  console.log(`  ${d.code.padEnd(10)} ${d.name.slice(0,30).padEnd(30)} qty=${String(d.qty).padStart(5)} 差=${String(d.diff).padStart(10)}`);
}

// 非FOO異常値が大きい商品は、売上明細上でどの伝票に出てくるか
console.log();
console.log('非FOO最大差額商品を含む伝票:');
for (const d of nonFooDiffs.slice(0, 5)) {
  console.log(`  [${d.code}] ${d.name}`);
  const slipList = [];
  for (const [num, s] of slips) {
    for (const l of s.lines) {
      if (l.code === d.code) {
        slipList.push({ num, cust: s.cust, amount: l.amount, qty: l.qty });
        break;
      }
    }
  }
  slipList.sort((a, b) => b.amount - a.amount);
  for (const sl of slipList.slice(0, 8)) {
    console.log(`    伝票${sl.num} ${sl.cust.slice(0,25).padEnd(25)} qty=${sl.qty} 金額=${sl.amount}`);
  }
}
