// 特定商品コードの全行を売上明細Excelから抽出
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
let total = 0, count = 0, nonZero = 0;
for (let i = 5; i < data.length - 1; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const code = String(r[14] || '').trim();
  if (code !== CODE) continue;
  const num = String(r[2]).trim();
  const tax = String(r[7] || '');
  const name = String(r[15] || '');
  const qty = r[21];
  const unit = r[23];
  const amount = parseFloat(r[25] || 0);
  count++;
  total += amount;
  if (amount !== 0) nonZero++;
  console.log(`伝票${num} 税=${tax.padEnd(10)} ${name.padEnd(25)} qty=${String(qty||'').padStart(4)} 単価=${String(unit||'').padStart(8)} 金額=${String(amount).padStart(8)}`);
}
console.log();
console.log('合計:', total.toLocaleString(), '| 行数:', count, '| 金額あり:', nonZero);
