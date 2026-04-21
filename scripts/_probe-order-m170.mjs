// M170 225/80R17.5 の発注管理DBと在庫DBの現状を確認
import https from 'https';

const ORDER_DB = '202a695f8e8880aa92f6f38d9b47b537';
const LTL_NORMAL_DB = '200a695f8e888018b5f5eac83fdad412';

function nf(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
      let c = '';
      r.on('data', x => c += x);
      r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { rej(new Error(c.slice(0, 500))); } });
    });
    req.on('error', rej);
    if (d) req.write(d);
    req.end();
  });
}

console.log('=== 発注管理DB: M170 225/80R17.5 ===');
const orderRes = await nf('POST', '/databases/' + ORDER_DB + '/query', {
  filter: { and: [
    { property: 'パターン', select: { equals: 'M170' } },
  ]},
  page_size: 20,
});
for (const o of (orderRes.results || [])) {
  const p = o.properties;
  console.log({
    id: o.id.slice(-12),
    created: o.created_time?.slice(0,10),
    lastEdit: o.last_edited_time?.slice(0,10),
    サイズ: p['タイヤサイズ']?.select?.name,
    サイズコード: p['サイズコード']?.select?.name,
    パターン: p['パターン']?.select?.name,
    数量: p['数量']?.number,
    ステータス: p['ステータス']?.select?.name,
    納入予定場所: p['納入予定場所']?.select?.name,
    納品日: p['納品日']?.date?.start,
    仕入先: p['仕入先']?.select?.name,
  });
}

console.log();
console.log('=== LTL TBノーマル在庫DB: M170 225/80R17.5 の最新20件 ===');
const stockRes = await nf('POST', '/databases/' + LTL_NORMAL_DB + '/query', {
  filter: { and: [
    { property: 'パターン名', select: { equals: 'M170' } },
    { property: 'サイズコード', select: { equals: '225/80R17.5' } },
  ]},
  sorts: [{ timestamp: 'created_time', direction: 'descending' }],
  page_size: 30,
});
for (const o of (stockRes.results || [])) {
  const p = o.properties;
  console.log({
    id: o.id.slice(-12),
    created: o.created_time,
    タイトル: p['タイトル']?.title?.[0]?.plain_text,
    区分: p['区分']?.select?.name,
    数量: p['数量']?.number,
    倉庫: p['倉庫']?.select?.name,
    パターン: p['パターン名']?.select?.name,
    サイズ: p['サイズコード']?.select?.name,
  });
}
