// 任意月の弥生伝票について、弥生明細行と Notion 明細行を照合し、Notion側で欠けている行を列挙
// 使い方: node _find-missing-details.mjs --year 2025 --month 8
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year', '2025'));
const MONTH = parseInt(getArg('month', '8'));
const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${new Date(YEAR, MONTH, 0).getDate()}`;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

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

// 弥生Excel読込
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

// 弥生: 伝票番号 → 明細行の配列
const yayoiDetails = new Map();
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  const ds = row[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(row[2]).trim();
  const name = String(row[15] || '').trim();
  if (name === '《消費税》') continue;  // 消費税行は明細に含めない
  const code = String(row[14] || '').trim();
  const qty = parseFloat(row[21]) || 0;
  const tanka = parseFloat(row[23]) || 0;
  const kingaku = parseFloat(row[25]) || 0;
  if (!yayoiDetails.has(num)) yayoiDetails.set(num, []);
  yayoiDetails.get(num).push({ code, name, qty, tanka, kingaku });
}

// Notion: 伝票取得
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

console.log(`=== ${YEAR}/${MONTH} 明細不足検出 ===`);
console.log(`弥生伝票数: ${yayoiDetails.size}, Notion伝票数: ${slips.length}`);

// 各 Notion 伝票ごとに明細照合
const missingReports = [];
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  const num = m[1];
  const yayoiLines = yayoiDetails.get(num) || [];
  if (yayoiLines.length === 0) continue;

  // Notion側の明細取得
  let notionDetails = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    notionDetails.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);

  if (notionDetails.length === yayoiLines.length) continue;  // 件数一致なら詳細チェック不要

  // Notionに存在するkey一覧を作る (code + qty + tanka)
  const notionKeys = new Set();
  for (const d of notionDetails) {
    const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
    const qty = d.properties['数量']?.number || 0;
    const tanka = d.properties['単価']?.number || 0;
    notionKeys.add(`${code}|${qty}|${tanka}`);
  }

  // 弥生にあるがNotionにない明細を抽出
  const missing = [];
  for (const y of yayoiLines) {
    const key = `${y.code}|${y.qty}|${y.tanka}`;
    if (!notionKeys.has(key)) missing.push(y);
  }
  if (missing.length > 0) {
    missingReports.push({ num, pageId: s.id, yayoiCount: yayoiLines.length, notionCount: notionDetails.length, missing });
  }
  await sleep(30);
}

console.log(`\n明細不足伝票: ${missingReports.length}件`);
let totalMissingLines = 0;
let totalMissingAmount = 0;
for (const r of missingReports) {
  console.log(`\n伝票${r.num} (pageId=${r.pageId.slice(0,8)}) 弥生=${r.yayoiCount}件 Notion=${r.notionCount}件 不足=${r.missing.length}件`);
  for (const m of r.missing) {
    console.log(`  不足: [${m.code}] ${m.name.slice(0,40)} qty=${m.qty} 単価=${m.tanka} 金額=${m.kingaku}`);
    totalMissingLines++;
    totalMissingAmount += m.kingaku;
  }
}
console.log(`\n合計: ${totalMissingLines}明細 / 金額合計 ${totalMissingAmount.toLocaleString()}円`);
