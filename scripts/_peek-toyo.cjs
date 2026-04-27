const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/Mitsuru Mukaihata/Desktop/売上明細/タイヤメーカー価格表/PCR夏 システム価格表 (2026年1月1日付) -5.xlsx');
console.log('シート数:', wb.SheetNames.length);
console.log('シート名:', wb.SheetNames);
for (const sn of wb.SheetNames) {
  const sh = wb.Sheets[sn];
  const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  console.log(`\n━━━ シート「${sn}」(${sh['!ref']}) 行数: ${data.length}`);
  data.slice(0, 8).forEach((r, i) => {
    console.log(`  [${i}]`, JSON.stringify(r).slice(0, 250));
  });
}
