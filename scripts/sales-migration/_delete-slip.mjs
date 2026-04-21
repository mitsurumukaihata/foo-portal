// 指定伝票番号の売上伝票+明細をNotionから削除
// 使い方: node _delete-slip.mjs --slip 00003978
import https from 'https';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const SLIP = getArg('slip', null);
if (!SLIP) { console.log('--slip 必須'); process.exit(1); }

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
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 2000); else rej(e); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 2000); else rej(e); });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 備考で弥生伝票番号を検索
console.log('伝票検索:', SLIP);
const slips = [];
let cursor = null;
do {
  const body = { filter: { property: '備考', rich_text: { contains: '弥生伝票' + SLIP } }, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  slips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('該当伝票:', slips.length);
for (const s of slips) console.log('  page_id:', s.id);

for (const s of slips) {
  // 明細取得
  const details = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    details.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);
  console.log('明細:', details.length, '件');
  for (const d of details) {
    await new Promise((res, rej) => {
      const body = JSON.stringify({ archived: true });
      const req = https.request({ hostname: WORKER, path: '/pages/' + d.id, method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => { let c = ''; r.on('data', x => c += x); r.on('end', () => res(c)); });
      req.on('error', rej);
      req.write(body); req.end();
    });
    await sleep(120);
  }
  console.log('  明細削除完了');
  // 伝票削除
  await new Promise((res, rej) => {
    const body = JSON.stringify({ archived: true });
    const req = https.request({ hostname: WORKER, path: '/pages/' + s.id, method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => { let c = ''; r.on('data', x => c += x); r.on('end', () => res(c)); });
    req.on('error', rej);
    req.write(body); req.end();
  });
  console.log('  伝票削除完了');
}
console.log('完了');
