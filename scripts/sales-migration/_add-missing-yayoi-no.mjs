// 番号なしNotion伝票に対応する弥生伝票番号を自動マッチ→備考に追加
// 使い方: node _add-missing-yayoi-no.mjs --year YYYY --month M [--apply]
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year', '2024'));
const MONTH = parseInt(getArg('month', '4'));
const APPLY = process.argv.includes('--apply');
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log(APPLY ? '[APPLY]' : '[DRY]', YEAR + '/' + MONTH);

// 弥生
const candidates = [
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
];
const qs = [[1,3],[4,6],[7,9],[10,12]];
for (const [s, e] of qs) if (MONTH >= s && MONTH <= e) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${s}-${YEAR}.${e}.xlsx`);
if (MONTH >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.4-${YEAR+1}.3.xlsx`);
else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR-1}.4-${YEAR}.3.xlsx`);
const FILE = candidates.find(p => fs.existsSync(p));
if (!FILE) { console.log('Excelなし'); process.exit(1); }

const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoiSlips = new Map();
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  const ds = row[1];
  let dstr = '';
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    dstr = dt.toISOString().slice(0, 10);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(row[2]).trim();
  const taxType = String(row[7] || '');
  const customer = String(row[5] || row[4] || '').trim();
  const name = String(row[15] || '');
  const amount = parseFloat(row[25] || 0);
  if (!yayoiSlips.has(num)) yayoiSlips.set(num, { date: dstr, isInternal: /内税/.test(taxType), lineSum: 0, taxLine: 0, customer });
  const s = yayoiSlips.get(num);
  if (name === '《消費税》') s.taxLine += amount;
  else s.lineSum += amount;
}
for (const [num, s] of yayoiSlips) {
  if (s.isInternal && s.taxLine === 0) s.zeinuki = Math.round(s.lineSum / 1.1);
  else if (s.isInternal) s.zeinuki = s.lineSum - s.taxLine;
  else s.zeinuki = s.lineSum;
}

// Notion
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

const usedYayoiNos = new Set();
const unnumbered = [];
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (m) usedYayoiNos.add(m[1]);
  else unnumbered.push({
    pageId: s.id,
    date: s.properties['売上日']?.date?.start,
    zeinuki: s.properties['税抜合計']?.number || 0,
    title: s.properties['伝票タイトル']?.title?.[0]?.plain_text || '',
    memo,
  });
}
console.log('番号なしNotion:', unnumbered.length, '件');

// 弥生で未使用のもの
const unusedYayoi = [...yayoiSlips.entries()].filter(([n, s]) => !usedYayoiNos.has(n));
console.log('Notionに紐付いてない弥生:', unusedYayoi.length, '件');

// マッチング: 番号なしNotion ↔ 未使用弥生 (date + zeinuki 一致)
let matched = 0;
for (const u of unnumbered) {
  const cands = unusedYayoi.filter(([n, s]) => s.date === u.date && Math.round(s.zeinuki) === Math.round(u.zeinuki));
  if (cands.length === 1) {
    const [num, s] = cands[0];
    console.log(`✅ 一意マッチ: Notion[${u.pageId.slice(0,8)}] ${u.date} ${u.zeinuki.toLocaleString()} → 弥生${num} ${s.customer}`);
    if (APPLY) {
      const newMemo = `弥生伝票${num} ${u.memo}`.trim();
      await nf('PATCH', '/pages/' + u.pageId, { properties: { '備考': { rich_text: [{ text: { content: newMemo } }] } } });
      matched++;
      await sleep(200);
    }
    // マッチしたら使用済みに
    usedYayoiNos.add(num);
    const idx = unusedYayoi.findIndex(([n]) => n === num);
    unusedYayoi.splice(idx, 1);
  } else if (cands.length === 0) {
    console.log(`⚠️ マッチなし: Notion[${u.pageId.slice(0,8)}] ${u.date} ${u.zeinuki.toLocaleString()} title="${u.title.slice(0,40)}"`);
  } else {
    console.log(`⚠️ 複数マッチ(${cands.length}件): Notion[${u.pageId.slice(0,8)}] ${u.date} ${u.zeinuki.toLocaleString()}`);
    for (const [n, s] of cands) console.log(`   候補: 弥生${n} ${s.customer}`);
  }
}

console.log();
console.log('マッチ&更新:', matched, '件');
console.log('残りの未使用弥生:', unusedYayoi.length, '件');
for (const [n, s] of unusedYayoi.slice(0, 10)) console.log(`   弥生${n} ${s.date} 税抜=${s.zeinuki.toLocaleString()} ${s.customer}`);
