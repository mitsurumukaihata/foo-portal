// 商品別売上明細表（弥生公式）vs 売上明細 の HT02 突合
import XLSX from 'xlsx';
import fs from 'fs';

// ① 商品別売上明細表（弥生 正式集計）
const officialFile = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　ハイタイヤ　2026.3.xlsx';
const owb = XLSX.readFile(officialFile);
const odata = XLSX.utils.sheet_to_json(owb.Sheets[owb.SheetNames[0]], { header: 1 });
const officialRows = [];
for (let i = 5; i < odata.length; i++) {
  const r = odata[i];
  if (!r || !r[1] || String(r[1]).trim() === '<<総合計>>') continue;
  officialRows.push({
    row: i,
    date: r[6],
    slip: String(r[7] || '').trim(),
    custCode: String(r[10] || '').trim(),
    custName: String(r[11] || '').trim(),
    staffName: String(r[16] || '').trim(),
    qty: Number(r[21] || 0),
    unitPrice: Number(r[23] || 0),
    amount: Number(r[25] || 0),
    taxClass: String(r[29] || '').trim(),
  });
}

// ② 一般売上明細（月次） HT02 のみ
const salesFile = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　2026.3.xlsx';
const swb = XLSX.readFile(salesFile);
const sdata = XLSX.utils.sheet_to_json(swb.Sheets[swb.SheetNames[0]], { header: 1 });
const salesRows = [];
for (let i = 5; i < sdata.length - 1; i++) {
  const r = sdata[i];
  if (!r || !r[2]) continue;
  if (String(r[14] || '').trim() !== 'HT02') continue;
  salesRows.push({
    row: i,
    slip: String(r[2]).trim(),
    torihikiKubun: String(r[3] || '').trim(),
    custCode: String(r[5] || '').trim(),
    custName: String(r[6] || '').trim(),
    staffName: String(r[11] || '').trim(),
    productName: String(r[15] || '').trim(),
    qty: Number(r[21] || 0),
    unitPrice: Number(r[23] || 0),
    amount: Number(r[25] || 0),
    bikou: String(r[30] || '').trim(),
  });
}

console.log('=== HT02 件数サマリ ===');
console.log('商品別売上明細表:', officialRows.length, '行 / 金額', officialRows.reduce((a,r)=>a+r.amount,0), '/ qty', officialRows.reduce((a,r)=>a+r.qty,0));
console.log('一般売上明細    :', salesRows.length, '行 / 金額', salesRows.reduce((a,r)=>a+r.amount,0), '/ qty', salesRows.reduce((a,r)=>a+r.qty,0));
console.log();

// ③ 伝票番号 × 金額 × qty でキー化して突合
function key(r) { return `${r.slip}|${r.qty}|${r.unitPrice}|${r.amount}`; }
const officialMap = new Map();
for (const r of officialRows) {
  const k = key(r);
  if (!officialMap.has(k)) officialMap.set(k, []);
  officialMap.get(k).push(r);
}
const salesMap = new Map();
for (const r of salesRows) {
  const k = key(r);
  if (!salesMap.has(k)) salesMap.set(k, []);
  salesMap.get(k).push(r);
}

// 商品別にあり、売上明細にないもの
console.log('■ 商品別売上明細表だけにあるHT02行:');
let onlyOfficial = 0;
for (const [k, arr] of officialMap) {
  const inSales = (salesMap.get(k) || []).length;
  const extra = arr.length - inSales;
  if (extra > 0) {
    for (let i = 0; i < extra; i++) {
      const r = arr[i];
      console.log(`  伝票${r.slip} ${r.custName} qty=${r.qty} 単価=${r.unitPrice} 金額=${r.amount}`);
      onlyOfficial++;
    }
  }
}
if (onlyOfficial === 0) console.log('  なし');
console.log();

// 売上明細にあり、商品別にないもの
console.log('■ 一般売上明細だけにあるHT02行（商品別日報に含まれないもの）:');
let onlySales = 0;
let onlySalesSum = 0;
for (const [k, arr] of salesMap) {
  const inOfficial = (officialMap.get(k) || []).length;
  const extra = arr.length - inOfficial;
  if (extra > 0) {
    for (let i = 0; i < extra; i++) {
      const r = arr[arr.length - 1 - i]; // 末尾から
      console.log(`  伝票${r.slip} ${r.custName} qty=${r.qty} 単価=${r.unitPrice} 金額=${r.amount} 備考=${r.bikou}`);
      onlySalesSum += r.amount;
      onlySales++;
    }
  }
}
if (onlySales === 0) console.log('  なし');
console.log();
console.log(`商品別にだけある: ${onlyOfficial}行 / 売上明細にだけある: ${onlySales}行`);
console.log(`売上明細にだけある金額合計: ${onlySalesSum}円`);
