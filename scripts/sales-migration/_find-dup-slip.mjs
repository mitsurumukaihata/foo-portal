// 2025/2 で 弥生伝票00000455 を備考に含む Notion 伝票を全件検出
import https from 'https';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year', '2025'));
const MONTH = parseInt(getArg('month', '2'));
const TARGET = getArg('slip', '00000455');
const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${new Date(YEAR, MONTH, 0).getDate()}`;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';

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

console.log('全伝票:', all.length);
const matches = [];
for (const s of all) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  if (memo.includes('弥生伝票' + TARGET)) {
    matches.push(s);
  }
}
console.log(`弥生伝票${TARGET}を備考に含む Notion伝票: ${matches.length}件`);
for (const s of matches) {
  console.log(`  pageId=${s.id} 売上日=${s.properties['売上日']?.date?.start} 税抜=${s.properties['税抜合計']?.number} 税込=${s.properties['税込合計']?.number} 備考="${(s.properties['備考']?.rich_text?.[0]?.plain_text || '').slice(0, 100)}"`);
}
