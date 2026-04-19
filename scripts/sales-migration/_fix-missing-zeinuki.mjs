// Notion売上伝票で「税抜合計」がnull/undefinedの伝票を検出し、明細の数量×単価の合計で埋める
// 使い方: node _fix-missing-zeinuki.mjs --year YYYY --month M [--dry]
import https from 'https';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year', '2024'));
const MONTH = parseInt(getArg('month', '11'));
const DRY = process.argv.includes('--dry');
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

console.log(DRY ? '[DRY RUN]' : '[APPLY]', YEAR + '/' + MONTH);

const all = [];
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: DATE_FROM } },
    { property: '売上日', date: { on_or_before: DATE_TO } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  all.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

const missing = [];
for (const s of all) {
  const z = s.properties['税抜合計']?.number;
  if (z == null || z === 0) missing.push(s);
}
console.log('対象（税抜合計なし or 0）:', missing.length, '/ 全伝票:', all.length);

let fixed = 0;
for (const s of missing) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  const num = m ? m[1] : '(番号なし)';

  // 明細取得
  let lineSum = 0;
  let detailCount = 0;
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    for (const d of r.results) {
      const qty = d.properties['数量']?.number || 0;
      const tanka = d.properties['単価']?.number || 0;
      lineSum += qty * tanka;
      detailCount++;
    }
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);

  console.log(`伝票${num} pageId=${s.id.slice(0,8)} 明細${detailCount}件 → 税抜合計=${lineSum.toLocaleString()}`);
  if (!DRY && lineSum > 0) {
    await nf('PATCH', '/pages/' + s.id, { properties: { '税抜合計': { number: lineSum } } });
    fixed++;
    await sleep(200);
  }
}

console.log('修正完了:', fixed, '件');
