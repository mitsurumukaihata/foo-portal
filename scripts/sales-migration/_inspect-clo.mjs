// CLOの支払明細Excelを確認
import XLSX from 'xlsx';
import fs from 'fs';

const FILE = 'C:/Users/Mitsuru Mukaihata/Downloads/支払明細　CLO (2).xlsx';
if (!fs.existsSync(FILE)) { console.log('ファイルなし:', FILE); process.exit(1); }
const wb = XLSX.readFile(FILE);
console.log('シート一覧:', wb.SheetNames);
for (const sname of wb.SheetNames) {
  const ws = wb.Sheets[sname];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  console.log();
  console.log('=== シート:', sname, '/ 行数:', data.length, '===');
  const maxCols = Math.max(...data.slice(0, 30).map(r => (r || []).length));
  console.log('最大列数:', maxCols);
  console.log();
  for (let i = 0; i < Math.min(40, data.length); i++) {
    const r = data[i] || [];
    console.log(`[${i}]`, r.slice(0, 20).map(c => c == null ? '' : String(c).slice(0, 18)).join(' | '));
  }
  if (data.length > 40) {
    console.log('...');
    for (let i = Math.max(0, data.length - 5); i < data.length; i++) {
      const r = data[i] || [];
      console.log(`[${i}]`, r.slice(0, 20).map(c => c == null ? '' : String(c).slice(0, 18)).join(' | '));
    }
  }
}
