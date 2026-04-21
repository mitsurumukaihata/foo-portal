// 2024/12 の指定伝票について、NotionとYayoiの明細を対比表示
import https from 'https';
import XLSX from 'xlsx';

const TARGET_SLIPS = process.argv.slice(2);
if (TARGET_SLIPS.length === 0) TARGET_SLIPS.push('00014914', '00015272', '00015136');

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

// Notion取得
const notionSlips = [];
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: '2024-12-01' } },
    { property: '売上日', date: { on_or_before: '2024-12-31' } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  notionSlips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

const slipMap = new Map();
for (const s of notionSlips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  if (!TARGET_SLIPS.includes(m[1])) continue;
  slipMap.set(m[1], { pageId: s.id, details: [] });
}

for (const [num, ent] of slipMap) {
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: ent.pageId } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    ent.details.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);
}

// Excel
const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoi = new Map();
for (let i = 5; i < data.length; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  const ds = r[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== 2024 || dt.getMonth() + 1 !== 12) continue;
  }
  const num = String(r[2]).trim();
  if (!TARGET_SLIPS.includes(num)) continue;
  const shohinName = String(r[15] || '').trim();
  if (shohinName === '《消費税》') continue;
  if (!yayoi.has(num)) yayoi.set(num, []);
  yayoi.get(num).push({
    code: String(r[14] || '').trim(),
    name: shohinName,
    qty: parseFloat(r[21] || 0),
    tanka: parseFloat(r[23] || 0),
    kingaku: parseFloat(r[25] || 0),
    bikou: String(r[30] || '').trim(),
  });
}

for (const num of TARGET_SLIPS) {
  const ent = slipMap.get(num);
  const ys = yayoi.get(num) || [];
  console.log('\n=== 伝票' + num + ' ===');
  console.log('Notion明細 (' + (ent?.details.length || 0) + '件):');
  if (ent) for (const d of ent.details) {
    const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
    const title = d.properties['明細タイトル']?.title?.[0]?.plain_text || '';
    const qty = d.properties['数量']?.number || 0;
    const tanka = d.properties['単価']?.number || 0;
    const zeikomi = d.properties['税込小計']?.number || 0;
    const bikou = d.properties['備考']?.rich_text?.[0]?.plain_text || '';
    const created = d.created_time;
    console.log(`  [${created}] ${code} ${title} ${qty}x${tanka}=${zeikomi} / ${bikou.slice(0,30)}`);
  }
  console.log('Yayoi明細 (' + ys.length + '件):');
  for (const d of ys) {
    console.log(`  ${d.code} ${d.name.slice(0,40)} ${d.qty}x${d.tanka}=${d.kingaku} / ${d.bikou.slice(0,30)}`);
  }
}
