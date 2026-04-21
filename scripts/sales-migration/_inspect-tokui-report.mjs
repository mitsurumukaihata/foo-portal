// 得意先別売上日報の構造確認
import XLSX from 'xlsx';
import fs from 'fs';
const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '3'));
const file = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/得意先別売上日報/得意先別売上日報　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(file)) { console.log('ファイルなし:', file); process.exit(1); }
const wb = XLSX.readFile(file);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
console.log(`=== ${YEAR}/${MONTH} 得意先別売上日報 ===`);
console.log('行数:', data.length);
console.log();
console.log('最初の10行:');
for (let i = 0; i < Math.min(10, data.length); i++) {
  const r = data[i] || [];
  console.log(`[${i}]`, r.slice(0, 18).map(c => {
    if (c == null) return '';
    const s = String(c);
    return s.length > 15 ? s.slice(0, 12) + '...' : s;
  }).join(' | '));
}
console.log();
console.log('データ行サンプル（5〜15）:');
for (let i = 5; i < Math.min(15, data.length); i++) {
  const r = data[i] || [];
  console.log(`[${i}]`, r.slice(0, 15).map(c => c == null ? '' : String(c).slice(0,12)).join(' | '));
}
console.log();
console.log('末尾3行:');
for (let i = Math.max(0, data.length - 3); i < data.length; i++) {
  const r = data[i] || [];
  console.log(`[${i}]`, r.slice(0, 15).map(c => c == null ? '' : String(c).slice(0,15)).join(' | '));
}
