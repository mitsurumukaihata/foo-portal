// 指定伝票のうち、指定の明細タイトルの明細をarchiveする
import https from 'https';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const SLIP = getArg('slip');
const TITLE_MATCH = getArg('title-match');
const YEAR = parseInt(getArg('year', '2024'));
const MONTH = parseInt(getArg('month', '12'));
const MM = MONTH.toString().padStart(2, '0');
const LAST = new Date(YEAR, MONTH, 0).getDate();

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

// 伝票検索
const r1 = await nf('POST', '/databases/' + SALES_DB + '/query', {
  filter: { property: '備考', rich_text: { contains: '弥生伝票' + SLIP } },
  page_size: 10,
});
if (!r1.results?.[0]) { console.log('伝票なし'); process.exit(1); }
const slip = r1.results[0];
console.log('伝票ID:', slip.id);

// 明細取得
const r2 = await nf('POST', '/databases/' + DETAIL_DB + '/query', {
  filter: { property: '売上伝票', relation: { contains: slip.id } },
  page_size: 100,
});
const details = r2.results || [];
console.log('明細数:', details.length);

// タイトル検索
const matches = details.filter(d => (d.properties['明細タイトル']?.title?.[0]?.plain_text || '').includes(TITLE_MATCH));
console.log('マッチ:', matches.length);
for (const d of matches) {
  const title = d.properties['明細タイトル']?.title?.[0]?.plain_text || '';
  const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
  console.log(`  候補: [${code}] ${title} created=${d.created_time} archived=${d.archived}`);
}

if (matches.length !== 1) {
  console.log('⚠️ マッチが1件ではありません。安全のため削除しません。');
  process.exit(0);
}

console.log('削除:', matches[0].id);
const r3 = await nf('PATCH', '/pages/' + matches[0].id, { archived: true });
console.log('結果:', r3.object, r3.archived);
