// 指定月の売上伝票+明細を全削除
// 使い方: node _delete-month.mjs --year 2024 --month 4
import https from 'https';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '0'));
const MONTH = parseInt(getArg('month', '0'));
if (!YEAR || !MONTH) { console.log('--year --month 必須'); process.exit(1); }

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const WORKER = 'notion-proxy.33322666666mm.workers.dev';

function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: WORKER, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(new Error(c.slice(0, 200))); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(e); });
      req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MM = String(MONTH).padStart(2, '0');
const lastD = new Date(YEAR, MONTH, 0).getDate();
const from = `${YEAR}-${MM}-01`;
const to = `${YEAR}-${MM}-${String(lastD).padStart(2,'0')}`;

console.log(`=== ${YEAR}/${MONTH} 削除 ===`);
console.log('期間:', from, '〜', to);

// 伝票取得
const slips = [];
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: from } },
    { property: '売上日', date: { on_or_before: to } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  slips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('伝票:', slips.length);

// 明細削除
let detailDel = 0, slipDel = 0, failed = 0;
for (const s of slips) {
  // 明細取得
  const details = [];
  let dcur = null;
  do {
    try {
      const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
      if (dcur) body.start_cursor = dcur;
      const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
      details.push(...(r.results || []));
      dcur = r.has_more ? r.next_cursor : null;
    } catch(e) { console.log('  ❌ 明細取得:', e.message); break; }
  } while (dcur);
  // 明細削除
  for (const d of details) {
    try {
      await new Promise((res, rej) => {
        const body = JSON.stringify({ archived: true });
        const req = https.request({ hostname: WORKER, path: '/pages/' + d.id, method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
          let c = '';
          r.on('data', x => c += x);
          r.on('end', () => res(c));
        });
        req.on('error', rej);
        req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
        req.write(body);
        req.end();
      });
      detailDel++;
    } catch(e) { failed++; }
    await sleep(80);
  }
  // 伝票削除
  try {
    await new Promise((res, rej) => {
      const body = JSON.stringify({ archived: true });
      const req = https.request({ hostname: WORKER, path: '/pages/' + s.id, method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => res(c));
      });
      req.on('error', rej);
      req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
      req.write(body);
      req.end();
    });
    slipDel++;
    if (slipDel % 20 === 0) console.log(`  伝票削除: ${slipDel}/${slips.length}`);
  } catch(e) { failed++; }
  await sleep(100);
}

console.log();
console.log(`伝票削除: ${slipDel} / 明細削除: ${detailDel} / 失敗: ${failed}`);
