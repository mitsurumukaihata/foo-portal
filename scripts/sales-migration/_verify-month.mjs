// 月別の照合（弥生Excel vs Notion）
// 使い方: node _verify-month.mjs --year 2026 --month 3
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  return args[i + 1] || true;
}
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '3'));
const MM = MONTH.toString().padStart(2, '0');
const LAST = new Date(YEAR, MONTH, 0).getDate();
const DATE_FROM = `${YEAR}-${MM}-01`;
const DATE_TO = `${YEAR}-${MM}-${String(LAST).padStart(2,'0')}`;

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

function nf(method, p, body, retries = 3) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev',
        path: p, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
      }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try { res(JSON.parse(c)); }
          catch(e) {
            if (n > 0) { setTimeout(() => tryFetch(n-1), 2000); }
            else { rej(new Error('Parse: ' + c.slice(0, 200))); }
          }
        });
      });
      req.on('error', (e) => {
        if (n > 0) { setTimeout(() => tryFetch(n-1), 2000); }
        else { rej(e); }
      });
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log(`=== ${YEAR}/${MONTH} 照合 ===`);

// 弥生Excel（月次・四半期・年単位バンドル対応）
let FILE = null;
const candidates = [
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
];
const qs = [[1,3],[4,6],[7,9],[10,12]];
for (const [s, e] of qs) if (MONTH >= s && MONTH <= e) {
  candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${s}-${YEAR}.${e}.xlsx`);
}
if (MONTH >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.4-${YEAR+1}.3.xlsx`);
else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR-1}.4-${YEAR}.3.xlsx`);
FILE = candidates.find(p => fs.existsSync(p));
if (!FILE) { console.log('Excelファイルなし'); process.exit(1); }

const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoiSlips = new Set();
const yayoiSlipDetailMap = new Map();
let yayoiDetailCount = 0;
let yayoiTotalAmount = 0;
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  // バンドルファイル対応: 日付で対象月に絞る
  const ds = row[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(row[2]).trim();
  const prodName = String(row[15] || '');
  const amount = Number(row[25]) || 0;
  if (prodName === '《消費税》') {
    yayoiTotalAmount += amount;
    continue;
  }
  yayoiSlips.add(num);
  yayoiDetailCount++;
  yayoiSlipDetailMap.set(num, (yayoiSlipDetailMap.get(num) || 0) + 1);
  yayoiTotalAmount += amount;
}
console.log('弥生 伝票:', yayoiSlips.size, '/ 明細:', yayoiDetailCount, '/ 合計:', yayoiTotalAmount.toLocaleString());

// 商品日報
let yayoiNetTotal = null;
const reportPath = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
const reportPath2 = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報/商品別売上日報　${YEAR}.${MONTH}.xlsx`;
const repFile = fs.existsSync(reportPath) ? reportPath : (fs.existsSync(reportPath2) ? reportPath2 : null);
if (repFile) {
  const rwb = XLSX.readFile(repFile);
  const rd = XLSX.utils.sheet_to_json(rwb.Sheets[rwb.SheetNames[0]], { header: 1 });
  let nt = 0;
  for (let i = 5; i < rd.length; i++) {
    const r = rd[i];
    if (!r || !r[1]) continue;
    if (String(r[1]).trim() === '<<総合計>>') continue;
    nt += Number(r[10]) || 0;
  }
  yayoiNetTotal = nt;
  console.log('弥生 商品日報 純売上額:', yayoiNetTotal.toLocaleString());
}

// Notion
console.log();
console.log('Notion取得中...');
const slips = [];
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: DATE_FROM } },
    { property: '売上日', date: { on_or_before: DATE_TO } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  slips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

let notionDetailCount = 0;
let notionTaxExclTotal = 0;
const emptySlips = [];
const slipDetailMismatch = [];
for (const s of slips) {
  let dcount = 0;
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    dcount += (r.results || []).length;
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);
  notionDetailCount += dcount;
  notionTaxExclTotal += s.properties['税抜合計']?.number || 0;
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  const num = m ? m[1] : '';
  if (dcount === 0) emptySlips.push(num || s.id.slice(0,8));
  if (num && yayoiSlipDetailMap.has(num)) {
    const expected = yayoiSlipDetailMap.get(num);
    if (dcount !== expected) slipDetailMismatch.push({ num, notion: dcount, yayoi: expected });
  }
  await sleep(40);
}

console.log();
console.log('=== 結果 ===');
console.log('弥生 伝票:', yayoiSlips.size, '/ 明細:', yayoiDetailCount);
console.log('Notion 伝票:', slips.length, '/ 明細:', notionDetailCount);
console.log('Notion 伝票税抜合計:', notionTaxExclTotal.toLocaleString());
if (yayoiNetTotal != null) {
  console.log('差額(Notion - 弥生純売上):', (notionTaxExclTotal - yayoiNetTotal).toLocaleString());
}
console.log('差分 伝票:', slips.length - yayoiSlips.size);
console.log('差分 明細:', notionDetailCount - yayoiDetailCount);
if (emptySlips.length) {
  console.log('明細0件の伝票:', emptySlips.length, '件:', emptySlips.slice(0,20).join(','));
}
if (slipDetailMismatch.length) {
  console.log('明細数不一致:', slipDetailMismatch.length, '件');
  slipDetailMismatch.slice(0,20).forEach(m => console.log('  伝票' + m.num + ': Notion' + m.notion + ' 弥生' + m.yayoi));
}
if (slips.length === yayoiSlips.size && notionDetailCount === yayoiDetailCount && emptySlips.length === 0 && slipDetailMismatch.length === 0) {
  console.log();
  console.log('✅ 完全一致！');
} else {
  console.log();
  console.log('❌ 不一致あり');
}
