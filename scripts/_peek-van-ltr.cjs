const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/Mitsuru Mukaihata/Desktop/売上明細/タイヤメーカー価格表/PCR夏 システム価格表 (2026年1月1日付) -5.xlsx');
for (const sn of ['【A表】VAN・TAXI', '【A表】LTR']) {
  const sh = wb.Sheets[sn];
  const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  console.log(`\n━━━ ${sn} (${sh['!ref']}) 行数:${data.length}`);
  data.slice(0, 25).forEach((r, i) => console.log(`  [${i}]`, JSON.stringify(r).slice(0, 280)));
}
