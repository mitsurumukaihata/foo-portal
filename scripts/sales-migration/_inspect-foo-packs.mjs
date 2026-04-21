// fooパック支払管理フォルダの全ファイルを調査
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const DIR = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/fooパック支払管理';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.xlsx'));

console.log('=== FOOパック支払管理フォルダ ===');
console.log('ファイル数:', files.length);
console.log();

for (const fname of files) {
  const wb = XLSX.readFile(path.join(DIR, fname));
  console.log('━━━', fname, '━━━');
  console.log('  シート数:', wb.SheetNames.length);
  // 最初の数シートだけ一瞬
  for (let si = 0; si < Math.min(3, wb.SheetNames.length); si++) {
    const sname = wb.SheetNames[si];
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sname], { header: 1 });
    const getCell = (r, c) => (data[r] || [])[c];
    console.log(`  [${sname}]`);
    // 契約情報を推定: row 8-12 あたり
    const rows = [];
    for (let i = 0; i < 16; i++) {
      const r = data[i] || [];
      if (!r.some(c => c != null && String(c).trim())) continue;
      rows.push(`    [${i}] ${r.slice(0, 15).map(c => c == null ? '' : String(c).slice(0, 15)).join(' | ')}`);
    }
    rows.forEach(r => console.log(r));
  }
  console.log('  全シート名:', wb.SheetNames.map(s => `"${s}"`).join(', '));
  console.log();
}
