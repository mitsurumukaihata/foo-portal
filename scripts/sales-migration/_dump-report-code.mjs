// 商品別売上日報の指定商品コード行を表示
import XLSX from 'xlsx';
import fs from 'fs';
const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '3'));
const CODE = getArg('code', 'HT02');
let f = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(f)) f = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
const wb = XLSX.readFile(f);
const d = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
for (let i = 0; i < d.length; i++) {
  const r = d[i] || [];
  if (!r[1]) continue;
  if (String(r[1]).trim() !== CODE) continue;
  console.log('行', i, ':');
  for (let j = 0; j < 15; j++) console.log('  [' + j + ']', r[j] == null ? '' : r[j]);
}
