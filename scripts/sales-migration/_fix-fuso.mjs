import https from 'https';
function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev', path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>res(JSON.parse(c))); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const CUST_DB = '1ca8d122be214e3892879932147143c9';

// ふそう東/西の顧客IDを取得
const custs = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${CUST_DB}/query`, body);
  custs.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

const fusoIds = new Set();
custs.forEach(p => {
  const code = p.properties['弥生得意先コード']?.rich_text?.[0]?.plain_text || '';
  if (code === '00371' || code === '200') {
    fusoIds.add(p.id);
    console.log('ふそう: ' + code + ' → ' + p.id);
  }
});

// 売上伝票を全件取得して、顧客がふそうの伝票を抽出
const slips = [];
cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  slips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

const fusoSlips = slips.filter(s => {
  const rels = s.properties['顧客名']?.relation || [];
  return rels.some(r => fusoIds.has(r.id));
});

console.log('ふそう東/西の伝票:', fusoSlips.length, '件');

let updated = 0;
for (const s of fusoSlips) {
  const current = s.properties['作業区分']?.select?.name || '';
  if (current === '出張作業') continue;
  const title = s.properties['伝票タイトル']?.title?.[0]?.plain_text || '';
  await nf('PATCH', `/pages/${s.id}`, {
    properties: { '作業区分': { select: { name: '出張作業' } } }
  });
  updated++;
  console.log('  ✓ ' + title + ' (' + current + ' → 出張作業)');
  await sleep(350);
}
console.log('更新:', updated, '件');
