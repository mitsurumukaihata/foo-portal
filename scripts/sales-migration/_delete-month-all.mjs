// 任意月の全Notion伝票（と明細）を削除（archive）
// 使い方: node _delete-month-all.mjs --year YYYY --month M [--apply]
import https from 'https';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year'));
const MONTH = parseInt(getArg('month'));
const APPLY = process.argv.includes('--apply');
if (!YEAR || !MONTH) { console.log('--year YYYY --month M 必須'); process.exit(1); }

const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${new Date(YEAR, MONTH, 0).getDate()}`;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

function nf(method, p, body, retries = 30) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const parsed = JSON.parse(c);
            // rate limit時は 60秒待機してリトライ（無限に近く）
            if (parsed.object === 'error' && (parsed.code === 'rate_limited' || parsed.status === 429) && n > 0) {
              console.warn('[rate_limited] retry残' + n + ' ... 60秒待機');
              setTimeout(() => tryFetch(n-1), 60000);
              return;
            }
            // conflict error も軽微なリトライ
            if (parsed.object === 'error' && parsed.status >= 500 && n > 0) {
              console.warn('[5xx error] retry残' + n + ' ... 10秒待機');
              setTimeout(() => tryFetch(n-1), 10000);
              return;
            }
            res(parsed);
          } catch(e) {
            if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(new Error(c.slice(0, 300)));
          }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log(APPLY ? '[APPLY]' : '[DRY]', YEAR + '/' + MONTH, 'の全Notion伝票と明細を削除');

// 伝票取得
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
console.log('対象伝票:', slips.length);

let slipDeleted = 0, detailDeleted = 0;
for (let i = 0; i < slips.length; i++) {
  const s = slips[i];
  // 明細を取得して削除
  const details = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    details.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);
  if ((i+1) % 5 === 0 || i === slips.length-1) console.log((i+1) + '/' + slips.length, '伝票', s.id.slice(0,8), '明細', details.length, '件 (累計: 伝票' + slipDeleted + '/明細' + detailDeleted + ')');
  if (APPLY) {
    // 明細を1件ずつ削除（既にアーカイブ済みエラーは無視して続行）
    for (const d of details) {
      try {
        const r1 = await nf('PATCH', '/pages/' + d.id, { archived: true });
        if (r1.object === 'error' && !/archived/.test(r1.message || '')) {
          console.warn('  明細' + d.id.slice(0,8) + '削除エラー:', r1.message);
        }
        detailDeleted++;
      } catch(e) { /* 続行 */ }
      await sleep(200);
    }
    // 伝票自体を削除（同様に archive エラーは無視）
    try {
      const r2 = await nf('PATCH', '/pages/' + s.id, { archived: true });
      if (r2.object === 'error' && !/archived/.test(r2.message || '')) {
        console.warn('  伝票' + s.id.slice(0,8) + '削除エラー:', r2.message);
      }
      slipDeleted++;
    } catch(e) { /* 続行 */ }
    await sleep(200);
  }
}
console.log('完了: 伝票', slipDeleted, '件削除 / 明細', detailDeleted, '件削除');
