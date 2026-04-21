// 弥生Excelから指定伝票の生データをダンプ
import XLSX from 'xlsx';
import fs from 'fs';
const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const SLIP = getArg('slip', '00003928');
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '2'));
let FILE = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(FILE)) FILE = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
let count = 0;
for (let i = 5; i < data.length; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  if (String(r[2]).trim() !== SLIP) continue;
  count++;
  console.log(`  [${count}] code=${r[14]||''} name=${r[15]||''} qty=${r[20]||''} unit=${r[21]||''} 単価=${r[22]||''} 金額=${r[25]||''} 税種=${r[7]||''}`);
}
console.log(`計 ${count} 行`);
