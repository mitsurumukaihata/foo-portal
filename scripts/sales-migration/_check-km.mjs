// K&M が得意先マスタに本当にないか、顧客情報DBでの姿を確認
import https from 'https';

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

const TOKUI = 'f632f512f12d49b2b11f2b3e45c70aec';
const CUST_INFO = '1ca8d122be214e3892879932147143c9';

// 得意先マスタで K & M 系を検索（&を含むかどうか）
for (const q of ['K&M', 'K＆M', 'K', 'エムアンドケー', 'M&K', 'Ｋ']) {
  const r = await nf('POST', '/databases/' + TOKUI + '/query', {
    filter: { property: '得意先名', title: { contains: q } },
    page_size: 10,
  });
  const hits = (r.results || []).map(p => p.properties['得意先名']?.title?.[0]?.plain_text);
  if (hits.length) console.log(`得意先マスタ "${q}":`, hits);
}

console.log();

// 顧客情報DB のK&M詳細
const r2 = await nf('POST', '/databases/' + CUST_INFO + '/query', {
  filter: { property: '会社名', title: { contains: 'K&M' } },
  page_size: 5,
});
for (const p of (r2.results || [])) {
  const name = p.properties['会社名']?.title?.[0]?.plain_text;
  console.log('顧客情報DB:', name, p.id);
  const code = p.properties['弥生得意先コード']?.rich_text?.[0]?.plain_text || '';
  console.log('  弥生コード:', code);
}
