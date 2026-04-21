// 売上明細からイドム物流/高宮運送 のFOOパック請求を抽出
import XLSX from 'xlsx';
import fs from 'fs';

const FILES = [
  'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　2026.3.xlsx',
  'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　2026.3.xlsx',
  'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　2026.2.xlsx',
  'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　2026.2.xlsx',
  'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　2026.1.xlsx',
  'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　2026.1.xlsx',
];

const file = FILES.find(f => fs.existsSync(f));
if (!file) { console.log('ファイルなし'); process.exit(1); }

console.log('ファイル:', file);
const wb = XLSX.readFile(file);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

// 得意先がイドム物流 or 高宮運送 の伝票を抽出
const idmSlips = new Map(); // 伝票番号 → { custName, lines }
for (let i = 5; i < data.length - 1; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const custName = String(r[6] || '');
  if (!/イドム|高宮/.test(custName)) continue;
  const num = String(r[2]).trim();
  if (!idmSlips.has(num)) idmSlips.set(num, { custName, lines: [] });
  idmSlips.get(num).lines.push({
    code: String(r[14] || ''),
    name: String(r[15] || ''),
    qty: Number(r[21]) || 0,
    unit: String(r[16] || ''),
    tanka: Number(r[23]) || 0,
    amount: Number(r[25]) || 0,
    bikou: String(r[30] || ''),
  });
}

console.log();
console.log('イドム物流/高宮運送 の伝票:', idmSlips.size, '件');
console.log();

for (const [num, slip] of idmSlips) {
  console.log('━━━ 伝票', num, '━━━', slip.custName);
  for (const l of slip.lines) {
    console.log(`  [${l.code}] ${l.name} qty=${l.qty}${l.unit} 単価=${l.tanka} 金額=${l.amount} 備考=${l.bikou.slice(0,40)}`);
  }
  console.log();
}

// FOOパック商品コードで全期間検索
console.log();
console.log('=== FOO系商品コード別サマリ（イドム/高宮） ===');
const codeSummary = new Map();
for (const [num, slip] of idmSlips) {
  for (const l of slip.lines) {
    if (!/^FOO/i.test(l.code)) continue;
    const key = l.code;
    if (!codeSummary.has(key)) codeSummary.set(key, { total: 0, count: 0, name: l.name });
    codeSummary.get(key).total += l.amount;
    codeSummary.get(key).count++;
  }
}
for (const [code, s] of codeSummary) {
  console.log(`  ${code} ${s.name.slice(0,30)} → ${s.count}行 計${s.total.toLocaleString()}円`);
}
