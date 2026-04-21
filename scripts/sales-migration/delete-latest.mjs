import https from 'https';
function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev',
      path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>res(JSON.parse(c))); });
    req.on('error', rej);
    if (d) req.write(d);
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

// 最新の3伝票を取得してアーカイブ
const res = await nf('POST', `/databases/${SALES_DB}/query`, {
  sorts: [{ timestamp: 'created_time', direction: 'descending' }],
  page_size: 3
});

console.log('削除対象伝票:', res.results.length, '件');
for (const slip of res.results || []) {
  const title = slip.properties['伝票タイトル']?.title?.[0]?.plain_text || '';
  const meisaiRel = slip.properties['明細一覧']?.relation || [];
  console.log('  ' + title + ' (' + meisaiRel.length + '明細)');

  // 明細を先にアーカイブ
  for (const rel of meisaiRel) {
    await nf('PATCH', `/pages/${rel.id}`, { archived: true });
    await sleep(350);
  }
  // 伝票をアーカイブ
  await nf('PATCH', `/pages/${slip.id}`, { archived: true });
  await sleep(350);
  console.log('    ✓ アーカイブ済み');
}
console.log('完了');
