// 差額の原因を分解する
// 弥生商品日報の純売上額 vs Notion税抜合計 の差を、計算方式別に分解
// 使い方: node _analyze-diff.mjs --year 2026 --month 3
import XLSX from 'xlsx';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '3'));

console.log(`=== ${YEAR}/${MONTH} 差額分析 ===`);
console.log();

// 1) 売上明細Excel を読む
let salesFile = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(salesFile)) salesFile = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
const swb = XLSX.readFile(salesFile);
const sdata = XLSX.utils.sheet_to_json(swb.Sheets[swb.SheetNames[0]], { header: 1 });

// 伝票番号 → { isInternal, lines: [{code, name, amount}], taxLine }
const slips = new Map();
let yayoiAmountTotal = 0; // 弥生金額列の合計（内税=税込混合）
let yayoiTaxTotal = 0;    // 《消費税》行の合計
for (let i = 5; i < sdata.length - 1; i++) {
  const r = sdata[i];
  if (!r || !r[2]) continue;
  const num = String(r[2]).trim();
  const taxType = String(r[7] || '');
  const code = String(r[14] || '').trim();
  const name = String(r[15] || '').trim();
  const qty = parseFloat(r[21] || 0);
  const unitPrice = parseFloat(r[23] || 0);
  const amount = parseFloat(r[25] || 0);
  if (!slips.has(num)) slips.set(num, { isInternal: /内税/.test(taxType), lines: [], taxLine: 0 });
  const s = slips.get(num);
  if (name === '《消費税》') {
    s.taxLine += amount;
    yayoiTaxTotal += amount;
  } else {
    s.lines.push({ code, name, qty, unitPrice, amount });
  }
  yayoiAmountTotal += amount;
}

console.log('■ 弥生 売上明細Excel');
console.log('  伝票数:', slips.size);
console.log('  金額列合計（外税=税抜 + 内税=税込 + 消費税行）:', yayoiAmountTotal.toLocaleString());
console.log('  うち《消費税》行合計:', yayoiTaxTotal.toLocaleString());
console.log();

// 2) 3通りの「税抜」計算
let methodA = 0; // 伝票単位: 外税=そのまま / 内税=round(合計/1.1)
let methodB = 0; // 明細単位: 外税=そのまま / 内税=round(個別税込/1.1)
let methodC = 0; // 明細単位: 外税=そのまま / 内税=floor(個別税込/1.1)
let methodD = 0; // 明細単位: 外税=そのまま / 内税=ceil(個別税込/1.1)
let internalSlips = 0, externalSlips = 0;
let internalLineCount = 0;
for (const [num, s] of slips) {
  const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
  if (s.isInternal) {
    internalSlips++;
    internalLineCount += s.lines.length;
    if (s.taxLine > 0) {
      // 消費税行がある内税伝票 → 税抜 = 金額合計 - 消費税行
      methodA += (lineSum - s.taxLine);
      methodB += (lineSum - s.taxLine);
      methodC += (lineSum - s.taxLine);
      methodD += (lineSum - s.taxLine);
    } else {
      // A: 伝票合計を1回だけ round
      methodA += Math.round(lineSum / 1.1);
      // B: 明細ごとに round
      for (const l of s.lines) methodB += Math.round(l.amount / 1.1);
      // C: 明細ごとに floor
      for (const l of s.lines) methodC += Math.floor(l.amount / 1.1);
      // D: 明細ごとに ceil
      for (const l of s.lines) methodD += Math.ceil(l.amount / 1.1);
    }
  } else {
    externalSlips++;
    // 外税: 金額列 = 税抜（消費税行は別）
    for (const l of s.lines) { methodA += l.amount; methodB += l.amount; methodC += l.amount; methodD += l.amount; }
  }
}

console.log('■ 税抜合計の計算方式別');
console.log('  内税伝票:', internalSlips, '件 /', internalLineCount, '明細');
console.log('  外税伝票:', externalSlips, '件');
console.log();
console.log('  A) 伝票単位 round(合計/1.1):', methodA.toLocaleString(), '← 現在のNotion方式');
console.log('  B) 明細単位 round(金額/1.1):', methodB.toLocaleString());
console.log('  C) 明細単位 floor(金額/1.1):', methodC.toLocaleString());
console.log('  D) 明細単位 ceil (金額/1.1):', methodD.toLocaleString());
console.log();

// 3) 商品別売上日報の純売上額
let repFile = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(repFile)) repFile = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(repFile)) { console.log('商品別売上日報ファイルなし'); process.exit(0); }

const rwb = XLSX.readFile(repFile);
const rd = XLSX.utils.sheet_to_json(rwb.Sheets[rwb.SheetNames[0]], { header: 1 });
let reportNet = 0;
let reportGross = 0;
let reportTax = 0;
let reportDiscount = 0;
let reportReturn = 0;
// 列構造を確認
console.log('■ 商品別売上日報');
console.log('  列数:', rd[0]?.length, '   ヘッダ周辺:');
for (let i = 0; i < 5; i++) console.log('   [row' + i + ']', (rd[i]||[]).slice(0,20).map(c=>String(c||'').slice(0,10)).join('|'));

for (let i = 5; i < rd.length; i++) {
  const r = rd[i];
  if (!r || !r[1]) continue;
  if (String(r[1]).trim() === '<<総合計>>') {
    console.log('  総合計行:', r.slice(0,15).map(c=>String(c||'')).join('|'));
    continue;
  }
  const qty = Number(r[2]) || 0;
  const gross = Number(r[8]) || 0;
  const discount = Number(r[9]) || 0;
  const net = Number(r[10]) || 0;
  const tax = Number(r[11]) || 0;
  reportGross += gross;
  reportDiscount += discount;
  reportNet += net;
  reportTax += tax;
}
console.log('  売上額合計(col8):', reportGross.toLocaleString());
console.log('  値引額合計(col9):', reportDiscount.toLocaleString());
console.log('  純売上額合計(col10):', reportNet.toLocaleString());
console.log('  消費税額合計(col11):', reportTax.toLocaleString());
console.log();

console.log('■ 差額');
console.log('  A - 商品日報純売上:', (methodA - reportNet).toLocaleString());
console.log('  B - 商品日報純売上:', (methodB - reportNet).toLocaleString());
console.log('  C - 商品日報純売上:', (methodC - reportNet).toLocaleString());
console.log('  D - 商品日報純売上:', (methodD - reportNet).toLocaleString());
