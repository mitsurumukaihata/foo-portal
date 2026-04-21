// 弥生と比較して、Notion側で余剰な明細だけを削除（真の重複のみ）
// 使い方: node _dedupe-vs-yayoi-2024-11.mjs
import https from 'https';
import XLSX from 'xlsx';

const YEAR = 2024;
const MONTH = 11;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const FILE = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　2024.4-2025.3.xlsx';

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

console.log(`=== ${YEAR}/${MONTH} 弥生比較型 重複削除 ===`);

// Notion伝票取得
const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const LAST = new Date(YEAR, MONTH, 0).getDate();
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${String(LAST).padStart(2,'0')}`;
const notionSlips = [];
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: DATE_FROM } },
    { property: '売上日', date: { on_or_before: DATE_TO } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  notionSlips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('Notion伝票:', notionSlips.length);

// 伝票番号 → pageId
const slipMap = new Map();
for (const s of notionSlips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  slipMap.set(m[1], s.id);
}

// Excel読込: 伝票番号 → [キー, ...]（キーは code|qty|tanka|bikou）
const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoiMap = new Map(); // 伝票 → Map(key → count)
for (let i = 5; i < data.length; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const ds = r[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(r[2]).trim();
  if (!slipMap.has(num)) continue;
  const shohinName = String(r[15] || '').trim();
  if (shohinName === '《消費税》') continue;
  const code = String(r[14] || '').trim();
  const qty = parseFloat(r[21] || 0);
  const tanka = parseFloat(r[23] || 0);
  const bikou = String(r[30] || '').trim();
  const key = `${code}|${qty}|${tanka}|${bikou}`;
  if (!yayoiMap.has(num)) yayoiMap.set(num, new Map());
  const cm = yayoiMap.get(num);
  cm.set(key, (cm.get(key) || 0) + 1);
}
console.log('弥生処理済伝票:', yayoiMap.size);

// 各伝票で余剰明細を削除
let totalDeleted = 0;
let slipsProcessed = 0;
for (const [num, pageId] of slipMap) {
  const yayoiCounts = yayoiMap.get(num) || new Map();
  // Notion 明細取得
  const details = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: pageId } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    details.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);

  // 古い順にソート（新しい方を削除したい）
  details.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));

  // Notion 側でキーごとに明細をグループ化
  const notionByKey = new Map();
  for (const d of details) {
    const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
    const qty = d.properties['数量']?.number || 0;
    const tanka = d.properties['単価']?.number || 0;
    const bikou = d.properties['弥生備考']?.rich_text?.[0]?.plain_text || '';
    const key = `${code}|${qty}|${tanka}|${bikou}`;
    if (!notionByKey.has(key)) notionByKey.set(key, []);
    notionByKey.get(key).push(d);
  }

  // キーごとに弥生カウント vs Notionカウントを比較
  const toDelete = [];
  for (const [key, notionArr] of notionByKey) {
    const yc = yayoiCounts.get(key) || 0;
    const nc = notionArr.length;
    if (nc > yc) {
      // 余剰分を新しい順に削除（最新 = 最後に追加されたもの）
      const excess = nc - yc;
      for (let i = notionArr.length - excess; i < notionArr.length; i++) {
        toDelete.push(notionArr[i]);
      }
    }
  }

  if (toDelete.length > 0) {
    console.log(`伝票${num}: Notion${details.length}件 → ${toDelete.length}件削除予定`);
    for (const d of toDelete) {
      try {
        await nf('PATCH', '/pages/' + d.id, { archived: true });
        const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
        const qty = d.properties['数量']?.number || 0;
        const tanka = d.properties['単価']?.number || 0;
        console.log(`  ✓ 削除: ${code} ${qty}×${tanka}`);
        totalDeleted++;
      } catch(e) {
        console.log(`  ❌ 削除失敗: ${e.message}`);
      }
      await sleep(300);
    }
  }
  slipsProcessed++;
  if (slipsProcessed % 50 === 0) console.log(`  進捗 ${slipsProcessed}/${slipMap.size}`);
  await sleep(30);
}

console.log();
console.log('=== 結果 ===');
console.log('削除:', totalDeleted, '件');
