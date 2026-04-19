// 任意月のNotion売上伝票で「弥生伝票NNNNN」が同じ複数件を検出し、--apply時に削除（古い方を残し、新しい方を archive）
// 使い方: node _find-and-delete-dups.mjs --year YYYY --month M [--apply]
import https from 'https';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year', '2025'));
const MONTH = parseInt(getArg('month', '8'));
const APPLY = process.argv.includes('--apply');
const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${new Date(YEAR, MONTH, 0).getDate()}`;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

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

console.log(APPLY ? '[APPLY]' : '[DRY]', YEAR + '/' + MONTH);

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

const groups = new Map();
for (const s of all) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  const num = m[1];
  if (!groups.has(num)) groups.set(num, []);
  groups.get(num).push({
    pageId: s.id,
    created: s.created_time,
    edited: s.last_edited_time,
    zeinuki: s.properties['税抜合計']?.number || 0,
    title: s.properties['伝票タイトル']?.title?.[0]?.plain_text || '',
    memo: memo.slice(0, 80),
  });
}

const dups = [...groups.entries()].filter(([n, a]) => a.length > 1);
console.log('重複弥生番号:', dups.length, '件');
for (const [num, arr] of dups) {
  arr.sort((a, b) => a.created.localeCompare(b.created));
  console.log(`\n--- 弥生${num} (Notion${arr.length}件) ---`);
  for (const a of arr) {
    console.log(`  pageId=${a.pageId} created=${a.created.slice(0,16)} 税抜=${a.zeinuki.toLocaleString()} title="${a.title.slice(0,40)}"`);
  }
  // 古い方を残し、新しい方を削除（archive）
  const keep = arr[0];
  const remove = arr.slice(1);
  console.log(`  → 残す: ${keep.pageId.slice(0,8)} (created ${keep.created.slice(0,10)})`);
  console.log(`  → 削除: ${remove.map(r => r.pageId.slice(0,8)).join(', ')}`);
  if (APPLY) {
    for (const r of remove) {
      // 明細を先にアーカイブ
      let dcur = null;
      do {
        const body = { filter: { property: '売上伝票', relation: { contains: r.pageId } }, page_size: 100 };
        if (dcur) body.start_cursor = dcur;
        const dr = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
        for (const d of dr.results) {
          await nf('PATCH', '/pages/' + d.id, { archived: true });
          await sleep(150);
        }
        dcur = dr.has_more ? dr.next_cursor : null;
      } while (dcur);
      // 伝票をアーカイブ
      const ar = await nf('PATCH', '/pages/' + r.pageId, { archived: true });
      console.log(`    archived ${r.pageId.slice(0,8)} status=${ar.object}`);
      await sleep(300);
    }
  }
}
