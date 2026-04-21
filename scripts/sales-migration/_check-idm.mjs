// イドム物流・高宮運送の登録状況を確認
import https from 'https';

const TOKUI = 'f632f512f12d49b2b11f2b3e45c70aec';
const CUST_INFO = '1ca8d122be214e3892879932147143c9';

function nf(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
      let c = '';
      r.on('data', x => c += x);
      r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { rej(new Error(c.slice(0,200))); } });
    });
    req.on('error', rej);
    if (d) req.write(d);
    req.end();
  });
}

for (const q of ['高宮', 'イドム', 'IDOM', 'ｲﾄﾞﾑ', '高宮運送', 'イドム物流']) {
  console.log('━━━', q, '━━━');
  for (const db of [
    { id: TOKUI, name: '得意先マスタ', prop: '得意先名' },
    { id: CUST_INFO, name: '顧客情報DB', prop: '会社名' },
  ]) {
    const r = await nf('POST', '/databases/' + db.id + '/query', {
      filter: { property: db.prop, title: { contains: q } },
      page_size: 5,
    });
    const hits = (r.results || []).map(p => ({
      id: p.id,
      name: p.properties[db.prop]?.title?.[0]?.plain_text || '',
      yayoiCode: p.properties['弥生得意先コード']?.rich_text?.[0]?.plain_text || p.properties['弥生得意先コード']?.number || '',
    }));
    if (hits.length) {
      console.log('  [' + db.name + ']');
      for (const h of hits) console.log('    ' + h.name + ' (弥生:' + h.yayoiCode + ')');
    }
  }
}
