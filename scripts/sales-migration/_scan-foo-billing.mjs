// 全36ヶ月の売上明細からFOOパック請求行を抽出してユニーク契約を構築
import XLSX from 'xlsx';
import fs from 'fs';

function readSales(year, month) {
  const candidates = [
    `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${year}.${month}.xlsx`,
    `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.${month}.xlsx`,
  ];
  const qs = [[1,3],[4,6],[7,9],[10,12]];
  for (const [s, e] of qs) if (month >= s && month <= e) {
    candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.${s}-${year}.${e}.xlsx`);
  }
  if (month >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.4-${year+1}.3.xlsx`);
  else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year-1}.4-${year}.3.xlsx`);
  return candidates.find(p => fs.existsSync(p));
}

// 商品名からリース期間を抽出
function parseLeasePeriod(name) {
  // "f.o.oパック TB 2023.6.1-2028.5.31" or "2024.10.11.2029.10.10" (tyrpo)
  const m = name.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})[\-\.]\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (m) {
    const start = `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    const end = `${m[4]}-${String(m[5]).padStart(2,'0')}-${String(m[6]).padStart(2,'0')}`;
    return { start, end };
  }
  // "2024.11-2029.11" (month only)
  const m2 = name.match(/(\d{4})\.(\d{1,2})[^\d](\d{4})\.(\d{1,2})/);
  if (m2) {
    return {
      start: `${m2[1]}-${String(m2[2]).padStart(2,'0')}-01`,
      end: `${m2[3]}-${String(m2[4]).padStart(2,'0')}-01`,
    };
  }
  return null;
}

function classifyCategory(code, name) {
  if (/FOOTB/i.test(code)) return 'f.o.oパックTB';
  if (/FOOLTL/i.test(code)) return 'f.o.oパックLTL';
  if (/FOOLTS/i.test(code)) return 'f.o.oパックLTS';
  if (/FOOLT/i.test(code)) return 'f.o.oパックLT';
  if (/FOO/i.test(code)) return 'f.o.oパックライト';
  return 'f.o.oパックライト';
}

const months = [];
for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  if (y === 2023 && m < 4) continue;
  if (y === 2026 && m > 3) continue;
  months.push({ y, m });
}

// (得意先|車番|リース開始日|商品コード) → { ...details, firstSeen, lastSeen, unitPriceHistory }
const contracts = new Map();

for (const { y, m } of months) {
  const file = readSales(y, m);
  if (!file) continue;
  const wb = XLSX.readFile(file);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const ym = `${y}-${String(m).padStart(2,'0')}`;
  for (let i = 5; i < data.length - 1; i++) {
    const r = data[i];
    if (!r || !r[2]) continue;
    const dateSerial = r[1];
    // 日付フィルタ（年まとめファイル用）
    if (typeof dateSerial === 'number') {
      const date = new Date((dateSerial - 25569) * 86400 * 1000);
      if (date.getFullYear() !== y || date.getMonth() + 1 !== m) continue;
    }
    const code = String(r[14] || '').trim();
    if (!/^FOO/i.test(code)) continue;
    const custName = String(r[6] || '').trim();
    const name = String(r[15] || '').trim();
    const unitPrice = Number(r[23]) || 0;
    const bikou = String(r[30] || '').trim();
    const period = parseLeasePeriod(name);
    if (!period) continue;

    // ユニークキー: 得意先 + 車番 + 開始日 + 商品コード
    const key = `${custName}|${bikou}|${period.start}|${code}`;
    if (!contracts.has(key)) {
      contracts.set(key, {
        custName, code, name,
        category: classifyCategory(code, name),
        leaseStart: period.start,
        leaseEnd: period.end,
        plate: bikou,
        unitPrices: new Map(),
        firstSeen: ym,
        lastSeen: ym,
      });
    }
    const c = contracts.get(key);
    c.unitPrices.set(ym, unitPrice);
    if (ym < c.firstSeen) c.firstSeen = ym;
    if (ym > c.lastSeen) c.lastSeen = ym;
  }
}

console.log('=== FOO契約スキャン結果 ===');
console.log('ユニーク契約数:', contracts.size);
console.log();

// 得意先別サマリ
const byCust = new Map();
for (const [key, c] of contracts) {
  if (!byCust.has(c.custName)) byCust.set(c.custName, []);
  byCust.get(c.custName).push(c);
}
const custSorted = [...byCust.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [cust, list] of custSorted) {
  const latestPrices = list.map(c => [...c.unitPrices.values()].pop() || 0);
  const totalMonthly = latestPrices.reduce((a, b) => a + b, 0);
  console.log(`  ${cust.padEnd(30)}: ${list.length}台 月額合計${totalMonthly.toLocaleString()}円`);
}
console.log();

// 商品区分別サマリ
const byCat = new Map();
for (const [key, c] of contracts) {
  byCat.set(c.category, (byCat.get(c.category) || 0) + 1);
}
console.log('商品区分別:');
for (const [cat, n] of byCat) console.log(`  ${cat}: ${n}`);
console.log();

// 車番が空の契約
const noplate = [...contracts.values()].filter(c => !c.plate).length;
console.log('車番空の契約:', noplate, '件');

// 最終月額のバリエーション
const priceHist = new Map();
for (const c of contracts.values()) {
  const latest = [...c.unitPrices.values()].pop();
  priceHist.set(latest, (priceHist.get(latest) || 0) + 1);
}
console.log();
console.log('月額の分布（出現回数）:');
for (const [p, n] of [...priceHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15)) {
  console.log(`  ${p.toLocaleString()}円 × ${n}契約`);
}

// JSONで出力
fs.writeFileSync('_foo-contracts-from-sales.json', JSON.stringify([...contracts.values()].map(c => ({
  ...c,
  unitPrices: Object.fromEntries(c.unitPrices),
  latestPrice: [...c.unitPrices.values()].pop() || 0,
})), null, 2));
console.log();
console.log('結果を _foo-contracts-from-sales.json に保存');
