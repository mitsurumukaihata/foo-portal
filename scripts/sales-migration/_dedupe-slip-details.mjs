// 指定伝票内の重複明細を検出して削除（リトライで重複が出た時用）
// 使い方: node _dedupe-slip-details.mjs --slip 00003928
import https from 'https';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const SLIP = getArg('slip', null);
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log(`=== ${YEAR}/${MONTH} 重複明細チェック ===`);

// 伝票一覧取得
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

let totalDup = 0;
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  const num = m ? m[1] : '';
  if (SLIP && num !== SLIP) continue;

  // 明細取得
  const details = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    details.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);

  // 重複検出: 明細タイトル+商品コード+数量+単価+税込小計+備考でキー化
  const map = new Map();
  for (const d of details) {
    const title = d.properties['明細タイトル']?.title?.[0]?.plain_text || '';
    const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
    const qty = d.properties['数量']?.number || 0;
    const tanka = d.properties['単価']?.number || 0;
    const zeikomi = d.properties['税込小計']?.number || 0;
    const bikou = d.properties['備考']?.rich_text?.[0]?.plain_text || '';
    const key = `${title}|${code}|${qty}|${tanka}|${zeikomi}|${bikou}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ id: d.id, created: d.created_time });
  }

  const dups = [];
  for (const [key, arr] of map) {
    if (arr.length > 1) {
      // 古い順にソートして、新しい方を削除候補に
      arr.sort((a, b) => a.created.localeCompare(b.created));
      for (let i = 1; i < arr.length; i++) {
        dups.push({ id: arr[i].id, key });
      }
    }
  }

  if (dups.length) {
    console.log(`伝票${num}: ${details.length}明細中 ${dups.length}件重複`);
    for (const dup of dups) {
      console.log(`  削除: ${dup.key}`);
      try {
        await nf('PATCH', '/pages/' + dup.id, { archived: true });
        totalDup++;
      } catch(e) { console.log('  ❌ ' + e.message); }
      await sleep(150);
    }
  }
}

console.log();
console.log(`削除: ${totalDup}件`);
