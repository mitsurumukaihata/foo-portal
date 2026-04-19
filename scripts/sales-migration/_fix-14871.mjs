// 伝票00014871 (2024/11/27 高田化学様) の税抜小計・税抜合計を弥生の正しい値に修正
// 弥生は外税伝票: LK01=3200, PK01=3200, LK02=3600, 消費税=1000, 税込合計=11000
import https from 'https';

const SALES_PAGE_ID = '343a695f-8e88-8105-bf28-e8cb586a80b3';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

// 期待値 (商品コード -> 税抜小計)
const EXPECTED = {
  'LK01': 3200,
  'PK01': 3200,
  'LK02': 3600,
};

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

const DRY = process.argv.includes('--dry');
console.log(DRY ? '[DRY RUN]' : '[APPLY]');

// 明細取得
const dr = await nf('POST', '/databases/' + DETAIL_DB + '/query', {
  filter: { property: '売上伝票', relation: { contains: SALES_PAGE_ID } }, page_size: 100
});
console.log('明細数:', dr.results.length);

for (const d of dr.results) {
  const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
  const zeinuki = d.properties['税抜小計']?.number;
  const expected = EXPECTED[code];
  if (expected == null) { console.log('  スキップ [未マップ]:', code); continue; }
  console.log('  ' + code + ': 現在=' + zeinuki + ' → 修正=' + expected);
  if (DRY) continue;
  const r1 = await nf('PATCH', '/pages/' + d.id, { properties: { '税抜小計': { number: expected } } });
  console.log('    応答:', JSON.stringify(r1).slice(0, 200));
  await sleep(300);
}

// 伝票の税抜合計を 10,000 に
console.log('\n伝票税抜合計: undefined(=0) → 10,000');
if (!DRY) {
  const r2 = await nf('PATCH', '/pages/' + SALES_PAGE_ID, { properties: { '税抜合計': { number: 10000 } } });
  console.log('  応答:', JSON.stringify(r2).slice(0, 300));
}

console.log('\n完了');
