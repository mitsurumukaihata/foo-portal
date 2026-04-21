// HT02の詳細分析
import XLSX from 'xlsx';
import fs from 'fs';
const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '3'));
const CODE = getArg('code', 'HT02');
let f = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(f)) f = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
const wb = XLSX.readFile(f);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

let qtyAll = 0, qtyPaid = 0, qtyFree = 0;
let amountTotal = 0;
let priceBuckets = new Map();
for (let i = 5; i < data.length - 1; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const code = String(r[14] || '').trim();
  if (code !== CODE) continue;
  const qty = parseFloat(r[21] || 0);
  const unit = parseFloat(r[23] || 0);
  const amount = parseFloat(r[25] || 0);
  qtyAll += qty;
  amountTotal += amount;
  if (amount > 0) qtyPaid += qty;
  else qtyFree += qty;
  const key = unit + '円';
  priceBuckets.set(key, (priceBuckets.get(key) || 0) + qty);
}
console.log('CODE:', CODE);
console.log('qty合計(全):', qtyAll);
console.log('qty(金額>0):', qtyPaid);
console.log('qty(金額=0):', qtyFree);
console.log('金額合計:', amountTotal.toLocaleString());
console.log();
console.log('単価別qty:');
for (const [k, v] of priceBuckets) console.log(' ', k, ':', v);
console.log();
// 商品別日報が算出しそうな値
console.log('商品別日報 純売上数=178 / 純売上額=68,700 との比較:');
console.log('  qty差(178 - paid):', 178 - qtyPaid);
console.log('  qty差(178 - all):', 178 - qtyAll);
console.log('  金額差(82000 - 68700):', 82000 - 68700);
// 試算: 178×386 = 68708 (close)
console.log('  68700 ÷ 178 =', (68700/178).toFixed(2), '円/本');
