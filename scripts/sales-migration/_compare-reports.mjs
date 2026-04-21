// 3種類の弥生帳票を横断比較
// - 売上明細 (伝票別・税区分別)
// - 商品別売上日報 (商品別純売上)
// - 得意先別売上日報 (得意先別純売上)
import XLSX from 'xlsx';
import fs from 'fs';

function readReport(path) {
  if (!fs.existsSync(path)) return null;
  const wb = XLSX.readFile(path);
  const d = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  for (let i = d.length - 1; i >= 0; i--) {
    const r = d[i] || [];
    if (String(r[1] || '').trim() === '<<総合計>>') {
      return Number(r[9] || r[10] || 0);
    }
  }
  return null;
}

function readSales(year, month) {
  // 月単位ファイル最優先 → 四半期 → 年
  const candidates = [
    `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${year}.${month}.xlsx`,
    `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.${month}.xlsx`,
  ];
  const qs = [[1,3],[4,6],[7,9],[10,12]];
  for (const [s, e] of qs) {
    if (month >= s && month <= e) {
      candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.${s}-${year}.${e}.xlsx`);
    }
  }
  // 会計年度まとめ 2024.4-2025.3
  if (month >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.4-${year+1}.3.xlsx`);
  else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year-1}.4-${year}.3.xlsx`);
  let f = candidates.find(p => fs.existsSync(p));
  if (!f) return null;
  const wb = XLSX.readFile(f);
  const d = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const slips = new Map();
  for (let i = 5; i < d.length - 1; i++) {
    const r = d[i];
    if (!r || !r[2]) continue;
    const num = String(r[2]).trim();
    const taxType = String(r[7] || '');
    const name = String(r[15] || '');
    const amount = parseFloat(r[25] || 0);
    // 日付フィルタ（四半期まとめの場合）
    const dateSerial = r[1];
    if (typeof dateSerial === 'number') {
      const date = new Date((dateSerial - 25569) * 86400 * 1000);
      if (date.getFullYear() !== year || date.getMonth() + 1 !== month) continue;
    }
    if (!slips.has(num)) slips.set(num, { isInternal: /内税/.test(taxType), lines: [], taxLine: 0 });
    const s = slips.get(num);
    if (name === '《消費税》') s.taxLine += amount;
    else s.lines.push({ amount });
  }
  let zeinuki = 0;
  for (const [num, s] of slips) {
    const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
    if (s.isInternal && s.taxLine === 0) zeinuki += Math.round(lineSum / 1.1);
    else if (s.isInternal) zeinuki += lineSum - s.taxLine;
    else zeinuki += lineSum;
  }
  return { zeinuki, slipCount: slips.size };
}

console.log('=== 3帳票横断チェック ===');
console.log();
console.log('年月     | 売上明細(計算) | 商品日報      | 得意先日報    | 売明vs商品 | 売明vs得意');
console.log('─'.repeat(100));

const months = [];
for (let y = 2023; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === 2023 && m < 4) continue;
    if (y === 2026 && m > 3) continue;
    months.push({ y, m });
  }
}

let sumSales = 0, sumShohin = 0, sumTokui = 0;
const missing = [];
for (const { y, m } of months) {
  const sales = readSales(y, m);
  const shohin = readReport(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報/商品別売上日報　${y}.${m}.xlsx`);
  const tokui = readReport(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/得意先別売上日報/得意先別売上日報　${y}.${m}.xlsx`);
  const sz = sales ? sales.zeinuki : null;
  if (!sales || shohin == null || tokui == null) {
    missing.push({ y, m, sales: !!sales, shohin: shohin != null, tokui: tokui != null });
  }
  const d1 = (sz != null && shohin != null) ? sz - shohin : null;
  const d2 = (sz != null && tokui != null) ? sz - tokui : null;
  console.log(`${y}/${String(m).padStart(2)}  | ${String(sz || 'なし').padStart(14)} | ${String(shohin || 'なし').padStart(13)} | ${String(tokui || 'なし').padStart(13)} | ${String(d1 || '').padStart(10)} | ${String(d2 || '').padStart(10)}`);
  if (sz != null) sumSales += sz;
  if (shohin != null) sumShohin += shohin;
  if (tokui != null) sumTokui += tokui;
}

console.log('─'.repeat(100));
console.log(`合計      | ${sumSales.toLocaleString().padStart(14)} | ${sumShohin.toLocaleString().padStart(13)} | ${sumTokui.toLocaleString().padStart(13)}`);
console.log();

if (missing.length) {
  console.log('不足ファイル:');
  for (const m of missing) console.log(`  ${m.y}/${m.m}: 売上明細=${m.sales?'OK':'なし'} 商品日報=${m.shohin?'OK':'なし'} 得意先日報=${m.tokui?'OK':'なし'}`);
}
