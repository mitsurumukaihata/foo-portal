// HT02の商品明細ファイルを確認
import XLSX from 'xlsx';
import fs from 'fs';

const FILE = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　ハイタイヤ　2026.3.xlsx';
if (!fs.existsSync(FILE)) { console.log('ファイルなし'); process.exit(1); }
const wb = XLSX.readFile(FILE);
console.log('シート一覧:', wb.SheetNames);
for (const sname of wb.SheetNames) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sname], { header: 1 });
  console.log();
  console.log('=== シート:', sname, '/ 行数:', data.length, '===');
  // 列数確認
  const maxCols = Math.max(...data.slice(0, 10).map(r => (r || []).length));
  console.log('最大列数:', maxCols);
  // 最初の10行
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const r = data[i] || [];
    console.log(`[${i}]`, r.slice(0, 30).map(c => c == null ? '' : String(c).slice(0, 15)).join(' | '));
  }
  console.log('...');
  // 末尾3行
  for (let i = Math.max(0, data.length - 3); i < data.length; i++) {
    const r = data[i] || [];
    console.log(`[${i}]`, r.slice(0, 30).map(c => c == null ? '' : String(c).slice(0, 15)).join(' | '));
  }
}
