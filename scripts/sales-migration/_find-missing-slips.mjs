// 月指定: 弥生にあってNotionに無い伝票番号を特定
// 使い方: node _find-missing-slips.mjs --year 2024 --month 12
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  return args[i + 1] || true;
}
const YEAR = parseInt(getArg('year', '2024'));
const MONTH = parseInt(getArg('month', '12'));
const MM = MONTH.toString().padStart(2, '0');
const LAST = new Date(YEAR, MONTH, 0).getDate();
const DATE_FROM = `${YEAR}-${MM}-01`;
const DATE_TO = `${YEAR}-${MM}-${String(LAST).padStart(2,'0')}`;

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';

function nf(method, p, body, retries = 5) {
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
            if (n > 0) setTimeout(() => tryFetch(n-1), 3000);
            else rej(new Error('Parse: ' + c.slice(0, 200)));
          }
        });
      });
      req.on('error', (e) => {
        if (n > 0) setTimeout(() => tryFetch(n-1), 3000);
        else rej(e);
      });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 弥生Excel
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
if (!FILE) { console.log('Excelなし'); process.exit(1); }

console.log('=== ' + YEAR + '/' + MONTH + ' 欠落伝票検出 ===');
console.log('Excel:', FILE);

const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoiSlips = new Set();
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  const ds = row[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  if (String(row[15] || '') === '《消費税》') continue;
  yayoiSlips.add(String(row[2]).trim());
}
console.log('弥生 伝票数:', yayoiSlips.size);

// Notion伝票
console.log('Notion取得中...');
const notionSlips = new Set();
const notionSlipNums = []; // 備考から抽出できた番号
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: DATE_FROM } },
    { property: '売上日', date: { on_or_before: DATE_TO } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  for (const s of (r.results || [])) {
    const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
    const m = memo.match(/弥生伝票(\d+)/);
    if (m) notionSlips.add(m[1]);
    notionSlipNums.push({ id: s.id, memo });
  }
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('Notion 伝票数:', notionSlipNums.length, '(伝票番号抽出:', notionSlips.size, ')');

// 差分
const missing = [...yayoiSlips].filter(x => !notionSlips.has(x)).sort();
const extra = [...notionSlips].filter(x => !yayoiSlips.has(x)).sort();

console.log();
console.log('=== 結果 ===');
console.log('弥生にあってNotionに無い:', missing.length, '件');
if (missing.length > 0) {
  console.log(missing.join(','));
}
console.log();
console.log('Notionにあって弥生に無い:', extra.length, '件');
if (extra.length > 0) {
  console.log(extra.join(','));
}

const outFile = `_missing-${YEAR}-${MONTH}.json`;
fs.writeFileSync(outFile, JSON.stringify({ year: YEAR, month: MONTH, missing, extra }, null, 2));
console.log('→', outFile);
