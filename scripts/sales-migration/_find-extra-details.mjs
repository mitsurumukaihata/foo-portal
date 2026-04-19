// 任意月で「Notionにあるが弥生にない」明細を検出し、--apply で削除
// 使い方: node _find-extra-details.mjs --year 2023 --month 4 [--apply]
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year'));
const MONTH = parseInt(getArg('month'));
const APPLY = process.argv.includes('--apply');
if (!YEAR || !MONTH) { console.log('--year YYYY --month M 必須'); process.exit(1); }

const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${new Date(YEAR, MONTH, 0).getDate()}`;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

function nf(method, p, body, retries = 20) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const parsed = JSON.parse(c);
            if (parsed.object === 'error' && parsed.code === 'rate_limited' && n > 0) { setTimeout(() => tryFetch(n-1), 60000); return; }
            res(parsed);
          } catch(e) { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(new Error(c.slice(0, 300))); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 弥生Excel
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
  if (name === '《消費税》') continue;
  const code = String(row[14] || '').trim();
  const qty = parseFloat(row[21]) || 0;
  const tanka = parseFloat(row[23]) || 0;
  if (!yayoiDetails.has(num)) yayoiDetails.set(num, []);
  yayoiDetails.get(num).push(`${code}|${qty}|${tanka}`);
}

// Notion 伝票
console.log(APPLY ? '[APPLY]' : '[DRY]', YEAR + '/' + MONTH);
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
console.log('弥生伝票数:', yayoiDetails.size, ', Notion伝票数:', slips.length);

const extras = [];
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  const num = m[1];
  const yayoiKeys = yayoiDetails.get(num);
  if (!yayoiKeys) continue;

  // Notion明細取得
  const notionDetails = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    notionDetails.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);

  if (notionDetails.length === yayoiKeys.length) continue;
  if (notionDetails.length < yayoiKeys.length) continue;  // 不足はこのスクリプトでは扱わない

  // 弥生に存在する key を消化していく（同じキーが複数あれば個別に扱う）
  const yayoiRemain = [...yayoiKeys];
  const extraInvoice = [];
  for (const d of notionDetails) {
    const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
    const qty = d.properties['数量']?.number || 0;
    const tanka = d.properties['単価']?.number || 0;
    const key = `${code}|${qty}|${tanka}`;
    const idx = yayoiRemain.indexOf(key);
    if (idx >= 0) {
      yayoiRemain.splice(idx, 1);
    } else {
      extraInvoice.push({
        pageId: d.id,
        code,
        qty,
        tanka,
        title: d.properties['明細タイトル']?.title?.[0]?.plain_text || '',
        bikou: d.properties['備考']?.rich_text?.[0]?.plain_text || '',
        created: d.created_time,
      });
    }
  }
  if (extraInvoice.length > 0) extras.push({ num, pageId: s.id, extras: extraInvoice });
  await sleep(30);
}

console.log('\n余分明細ある伝票:', extras.length, '件');
let totalExtras = 0;
for (const e of extras) {
  console.log(`\n伝票${e.num} (pageId=${e.pageId.slice(0,8)}) 余分${e.extras.length}件:`);
  for (const x of e.extras) {
    console.log(`  [${x.pageId.slice(0,8)}] ${x.code} qty=${x.qty} 単価=${x.tanka} title="${x.title.slice(0,40)}" created=${x.created.slice(0,16)}`);
    totalExtras++;
  }
}
console.log('\n合計余分:', totalExtras, '明細');

if (APPLY && totalExtras > 0) {
  console.log('\n[APPLY] 余分明細を archive します...');
  let ok = 0;
  for (const e of extras) {
    for (const x of e.extras) {
      try {
        const r = await nf('PATCH', '/pages/' + x.pageId, { archived: true });
        if (r.object === 'error' && !/archived/.test(r.message || '')) {
          console.warn('  ' + x.pageId.slice(0,8) + ' error:', r.message);
        } else {
          ok++;
        }
      } catch(e) { console.error('  error:', e.message); }
      await sleep(250);
    }
  }
  console.log('archive完了:', ok, '件');
}
