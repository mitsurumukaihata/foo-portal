// 指定伝票の現状を表示
import https from 'https';
const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const SLIP = getArg('slip', '00003928');
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '2'));
const MM = MONTH.toString().padStart(2, '0');
const LAST = new Date(YEAR, MONTH, 0).getDate();
const DATE_FROM = `${YEAR}-${MM}-01`;
const DATE_TO = `${YEAR}-${MM}-${String(LAST).padStart(2,'0')}`;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
function nf(method, p, body, retries = 3) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 2000); else rej(new Error(c.slice(0, 200))); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 2000); else rej(e); });
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}

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

for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  const num = m ? m[1] : '';
  if (num !== SLIP) continue;
  console.log('伝票', num, 'page_id', s.id);
  console.log('  税抜:', s.properties['税抜合計']?.number, '消費税:', s.properties['消費税合計']?.number, '税込:', s.properties['税込合計']?.number);
  // 明細
  const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 });
  console.log('  明細', r.results.length, '件');
  for (const d of r.results) {
    const title = d.properties['明細タイトル']?.title?.[0]?.plain_text || '';
    const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
    const qty = d.properties['数量']?.number || 0;
    const tanka = d.properties['単価']?.number || 0;
    const zei = d.properties['税額']?.number || 0;
    const zeikomi = d.properties['税込小計']?.number || 0;
    const bikou = d.properties['備考']?.rich_text?.[0]?.plain_text || '';
    console.log(`    [${code}] ${title} qty=${qty} 単価=${tanka} 税=${zei} 税込=${zeikomi} 備考=${bikou.slice(0,30)}`);
  }
}
