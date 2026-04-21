// 商品コード別に売上明細 vs 商品別売上日報を突合
import XLSX from 'xlsx';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '3'));

// 売上明細Excel
let salesFile = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(salesFile)) salesFile = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
const swb = XLSX.readFile(salesFile);
const sdata = XLSX.utils.sheet_to_json(swb.Sheets[swb.SheetNames[0]], { header: 1 });

// 伝票ごとに集計 → 商品コード別の税抜を計算
// 内税伝票は 税込合計から税抜を按分
const slips = new Map();
for (let i = 5; i < sdata.length - 1; i++) {
  const r = sdata[i];
  if (!r || !r[2]) continue;
  const num = String(r[2]).trim();
  const taxType = String(r[7] || '');
  const code = String(r[14] || '').trim();
  const name = String(r[15] || '').trim();
  const qty = parseFloat(r[21] || 0);
  const amount = parseFloat(r[25] || 0);
  if (!slips.has(num)) slips.set(num, { isInternal: /内税/.test(taxType), lines: [], taxLine: 0 });
  const s = slips.get(num);
  if (name === '《消費税》') s.taxLine += amount;
  else s.lines.push({ code, name, qty, amount });
}

// 商品コード別に税抜合計（売上明細側）
const salesByCode = new Map();
for (const [num, s] of slips) {
  if (s.isInternal && s.taxLine === 0) {
    // 伝票合計の税抜 = round(lineSum/1.1)
    const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
    if (lineSum === 0) continue;
    const zeinukiSlip = Math.round(lineSum / 1.1);
    // 明細比率で按分
    for (const l of s.lines) {
      const share = Math.round(zeinukiSlip * l.amount / lineSum);
      const cur = salesByCode.get(l.code) || { name: l.name, qty: 0, zeinuki: 0 };
      cur.qty += l.qty;
      cur.zeinuki += share;
      if (!cur.name) cur.name = l.name;
      salesByCode.set(l.code, cur);
    }
  } else {
    // 外税 or 内税で消費税行あり: 金額列がそのまま税抜
    const taxDeduction = s.taxLine || 0; // 内税だと引く必要
    const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
    for (const l of s.lines) {
      let zeinuki = l.amount;
      if (s.isInternal && taxDeduction > 0 && lineSum > 0) {
        zeinuki -= Math.round(taxDeduction * l.amount / lineSum);
      }
      const cur = salesByCode.get(l.code) || { name: l.name, qty: 0, zeinuki: 0 };
      cur.qty += l.qty;
      cur.zeinuki += zeinuki;
      if (!cur.name) cur.name = l.name;
      salesByCode.set(l.code, cur);
    }
  }
}

// 商品別売上日報
let repFile = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(repFile)) repFile = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
const rwb = XLSX.readFile(repFile);
const rd = XLSX.utils.sheet_to_json(rwb.Sheets[rwb.SheetNames[0]], { header: 1 });

// 列構造: 0=空 1=商品コード 2=商品名 3=純売上数 4=総売上額 5=返品額 6=返品率 7=値引額 8=値引率 9=その他 10=純売上額
const repByCode = new Map();
for (let i = 5; i < rd.length; i++) {
  const r = rd[i];
  if (!r || !r[1]) continue;
  if (String(r[1]).trim() === '<<総合計>>') continue;
  const code = String(r[1]).trim();
  const name = String(r[2] || '').trim();
  const qty = Number(r[3]) || 0;
  const gross = Number(r[4]) || 0;   // 総売上額
  const neturi = Number(r[10]) || 0;  // 純売上額
  repByCode.set(code, { name, qty, gross, net: neturi });
}

// 突合
console.log(`=== ${YEAR}/${MONTH} 商品コード別 突合 ===`);
let totalSales = 0, totalRep = 0;
const diffs = [];
const allCodes = new Set([...salesByCode.keys(), ...repByCode.keys()]);
for (const code of allCodes) {
  const s = salesByCode.get(code) || { name: '', qty: 0, zeinuki: 0 };
  const r = repByCode.get(code) || { name: '', qty: 0, gross: 0, net: 0 };
  totalSales += s.zeinuki;
  totalRep += r.net;
  const diff = s.zeinuki - r.net;
  if (Math.abs(diff) >= 1) {
    diffs.push({ code, name: s.name || r.name, sales: s.zeinuki, rep: r.net, diff });
  }
}
diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
console.log('合計: 売上明細側=', totalSales.toLocaleString(), '商品日報側=', totalRep.toLocaleString(), '差=', (totalSales - totalRep).toLocaleString());
console.log();
console.log('差がある商品（上位30）:');
console.log('コード      | 商品名                  | 売上明細    | 商品日報    | 差額');
console.log('─'.repeat(100));
for (const d of diffs.slice(0, 30)) {
  console.log(`${(d.code||'(空)').padEnd(12)}| ${(d.name||'').padEnd(25)}| ${d.sales.toLocaleString().padStart(11)} | ${d.rep.toLocaleString().padStart(11)} | ${d.diff.toLocaleString().padStart(10)}`);
}
console.log();
console.log('差がある商品の合計:', diffs.reduce((a, d) => a + d.diff, 0).toLocaleString());
console.log('差があった商品数:', diffs.length);
