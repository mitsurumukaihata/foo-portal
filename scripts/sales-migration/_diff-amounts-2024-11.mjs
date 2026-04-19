// 2024/11 Notion vs 弥生 の税抜金額を伝票単位で比較
// 重複検出・合計検証も行う
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

const YEAR = 2024;
const MONTH = 11;
const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${new Date(YEAR, MONTH, 0).getDate()}`;

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';

function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(new Error(c.slice(0, 300))); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(e); });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}

// 弥生
const candidates = [
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.10-${YEAR}.12.xlsx`,
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.4-${YEAR+1}.3.xlsx`,
];
const FILE = candidates.find(p => fs.existsSync(p));
console.log('Excel:', FILE);

const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoiSlips = new Map();
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  const ds = row[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(row[2]).trim();
  const taxType = String(row[7] || '');
  const customer = String(row[5] || row[4] || '').trim();
  const name = String(row[15] || '');
  const amount = parseFloat(row[25] || 0);
  if (!yayoiSlips.has(num)) yayoiSlips.set(num, { isInternal: /内税/.test(taxType), lineSum: 0, taxLine: 0, customer, lines: [] });
  const s = yayoiSlips.get(num);
  if (name === '《消費税》') s.taxLine += amount;
  else { s.lineSum += amount; s.lines.push({ name, amount }); }
}
let yayoiTotal = 0;
for (const [num, s] of yayoiSlips) {
  if (s.isInternal && s.taxLine === 0) s.zeinuki = Math.round(s.lineSum / 1.1);
  else if (s.isInternal) s.zeinuki = s.lineSum - s.taxLine;
  else s.zeinuki = s.lineSum;
  yayoiTotal += s.zeinuki;
}
console.log('弥生 伝票数:', yayoiSlips.size, '税抜合計:', yayoiTotal.toLocaleString());

// Notion
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

// 整理
const notionByNum = new Map(); // num -> [{zeinuki, pageId}]
const unnumbered = [];
let notionTotal = 0;
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  const zeinuki = s.properties['税抜合計']?.number || 0;
  const title = s.properties['タイトル']?.title?.[0]?.plain_text || s.properties['Name']?.title?.[0]?.plain_text || '';
  notionTotal += zeinuki;
  if (m) {
    const num = m[1];
    if (!notionByNum.has(num)) notionByNum.set(num, []);
    notionByNum.get(num).push({ zeinuki, pageId: s.id, title });
  } else {
    unnumbered.push({ zeinuki, pageId: s.id, title });
  }
}
console.log('Notion 伝票数:', slips.length, '税抜合計:', notionTotal.toLocaleString());
console.log('番号なしNotion:', unnumbered.length, '件');
for (const u of unnumbered) console.log('  [' + u.pageId.slice(0,8) + '] ' + u.zeinuki.toLocaleString() + ' / ' + u.title.slice(0,40));

// 重複弥生番号
const dup = [...notionByNum.entries()].filter(([n, a]) => a.length > 1);
if (dup.length) {
  console.log('Notion内で弥生番号重複:', dup.length, '件');
  for (const [num, arr] of dup) console.log('  弥生' + num + ': ' + arr.length + '件');
}

// 差分
console.log();
console.log('=== 差分検出 ===');
let matchedSum = 0;
let diffCount = 0;
for (const [num, arr] of notionByNum) {
  const notionSum = arr.reduce((a, x) => a + x.zeinuki, 0);
  const y = yayoiSlips.get(num);
  if (!y) {
    console.log('弥生にないNotion伝票' + num + ': ' + notionSum.toLocaleString());
    diffCount++;
    continue;
  }
  matchedSum += y.zeinuki;
  const d = notionSum - y.zeinuki;
  if (d !== 0) {
    console.log('伝票' + num + ' ズレ: Notion=' + notionSum.toLocaleString() + ' 弥生=' + y.zeinuki.toLocaleString() + ' 差=' + d.toLocaleString() + ' 得意先=' + y.customer);
    diffCount++;
  }
}
for (const [num, y] of yayoiSlips) {
  if (!notionByNum.has(num)) {
    console.log('Notionにない弥生伝票' + num + ': ' + y.zeinuki.toLocaleString() + ' 得意先=' + y.customer);
    diffCount++;
  }
}

console.log();
console.log('差分数:', diffCount);
console.log('マッチした弥生合計:', matchedSum.toLocaleString());
console.log('Notion番号なし合計:', unnumbered.reduce((a,x) => a + x.zeinuki, 0).toLocaleString());
console.log();
console.log('弥生合計 - Notion合計 =', (yayoiTotal - notionTotal).toLocaleString());
