// 2024/12 の 00015392 の欠落明細を補填する
// 年バンドル Excel (2024.4-2025.3.xlsx) を使用し、日付フィルタで 2024/12 のみ抽出
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

const YEAR = 2024;
const MONTH = 12;
const TARGET_SLIPS = ['00015392']; // 追加対象

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const FILE = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　2024.4-2025.3.xlsx';

function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev',
        path: p, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
      }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try { res(JSON.parse(c)); }
          catch(e) { if (n > 0) setTimeout(() => tryFetch(n-1), 3000); else rej(new Error(c.slice(0, 200))); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n-1), 3000); else rej(e); });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function hankanaToZen(s) {
  const map = {'ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ','ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ','ｺ':'コ','ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ','ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ','ﾄ':'ト','ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ','ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ','ﾎ':'ホ','ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ','ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ','ﾗ':'ラ','ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ','ﾜ':'ワ','ｦ':'ヲ','ﾝ':'ン','ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ','ｬ':'ャ','ｭ':'ュ','ｮ':'ョ','ｯ':'ッ','ｰ':'ー','｡':'。','､':'、','｢':'「','｣':'」','ﾞ':'゛','ﾟ':'゜'};
  return String(s).replace(/[\uFF61-\uFF9F]/g, c => map[c] || c);
}
function extractTireInfo(name) {
  const sizeMatch = name.match(/(\d{2,3}\/\d{2}R\d{2}\.?\d*|\d{2,3}R\d{2}|\d{2,3}\.\d{1,2}-\d{2}|\d{2,3}-\d{2})/);
  return { size: sizeMatch ? sizeMatch[0] : '', brand: '' };
}
function mapHinmoku(code, name) {
  if (/^V/.test(code)) return 'バルブ';
  if (/^N/.test(code)) return 'ナット';
  if (/^SH/.test(code)) return '出張';
  if (code === 'HT02' || /ハイタイヤ/.test(name)) return 'その他';
  if (/組替|脱着/.test(name)) return '組替';
  if (/^L?K/.test(code)) return '組替';
  if (/^[TS]\d/.test(code) || /タイヤ/.test(name)) return 'タイヤ';
  return 'その他';
}

// Notion伝票取得
console.log('=== 2024/12 伝票00015392 の不足明細補填 ===');
console.log('対象:', TARGET_SLIPS.join(','));
const DATE_FROM = `${YEAR}-12-01`;
const DATE_TO = `${YEAR}-12-31`;
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
console.log('Notion伝票取得:', notionSlips.length);

const slipMap = new Map();
for (const s of notionSlips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  const num = m[1];
  if (!TARGET_SLIPS.includes(num)) continue;
  slipMap.set(num, { pageId: s.id, existingKeys: new Set() });
}
console.log('対象Notion伝票:', slipMap.size);

// 既存明細キー構築
for (const [num, ent] of slipMap) {
  const details = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: ent.pageId } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    details.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);
  for (const d of details) {
    const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
    const qty = d.properties['数量']?.number || 0;
    const tanka = d.properties['単価']?.number || 0;
    const bikou = d.properties['弥生備考']?.rich_text?.[0]?.plain_text || '';
    ent.existingKeys.add(`${code}|${qty}|${tanka}|${bikou}`);
  }
  console.log(`伝票${num}: 既存明細${details.length}件`);
}

// Excel読込（年バンドル + 日付フィルタ）
const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoiDetails = new Map();
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
  if (!yayoiDetails.has(num)) yayoiDetails.set(num, []);
  yayoiDetails.get(num).push({
    shohinCode: String(r[14] || '').trim(),
    productName: shohinName,
    unit: String(r[16] || '').trim(),
    suryou: parseFloat(r[21] || 0),
    tanka: parseFloat(r[23] || 0),
    kingaku: parseFloat(r[25] || 0),
    zeiTenka: String(r[7] || '').trim(),
    bikou: String(r[30] || '').trim(),
  });
}
for (const [num, ds] of yayoiDetails) console.log(`伝票${num}: 弥生明細${ds.length}件`);

// 不足検出＆追加（キー一致: code|qty|tanka|bikou）
let added = 0;
let failed = 0;
for (const [num, ent] of slipMap) {
  const details = yayoiDetails.get(num) || [];
  const missing = [];
  // 同じキーの重複は複数弥生側にあっても既存1件しかないと「1件不足」として扱う必要がある
  const existingCount = new Map();
  for (const k of ent.existingKeys) existingCount.set(k, (existingCount.get(k) || 0) + 1);
  const usedCount = new Map();
  for (const d of details) {
    const key = `${d.shohinCode}|${d.suryou}|${d.tanka}|${d.bikou}`;
    const used = usedCount.get(key) || 0;
    const avail = existingCount.get(key) || 0;
    if (used < avail) { usedCount.set(key, used + 1); continue; }
    missing.push(d);
    usedCount.set(key, used + 1);
  }
  console.log(`\n伝票${num}: 不足${missing.length}件`);
  for (const d of missing) {
    const isInclusive = /内税/.test(d.zeiTenka);
    let unitPrice = d.tanka;
    if (unitPrice === 0 && d.suryou > 0 && d.kingaku > 0) unitPrice = Math.round(d.kingaku / d.suryou);
    let zeinuki = d.kingaku, zei = 0, zeikomi = d.kingaku;
    if (isInclusive) {
      zeinuki = Math.round(d.kingaku / 1.1);
      zei = d.kingaku - zeinuki;
    } else {
      zei = Math.round(d.kingaku * 0.1);
      zeikomi = d.kingaku + zei;
    }
    const tireInfo = extractTireInfo(d.productName);
    const hinmoku = mapHinmoku(d.shohinCode, d.productName);
    const detailTitle = `${hinmoku} ${tireInfo.size || ''}`.trim() || d.productName.slice(0, 40);
    const props = {
      '明細タイトル': { title: [{ text: { content: detailTitle } }] },
      '売上伝票': { relation: [{ id: ent.pageId }] },
      '商品コード': { rich_text: [{ text: { content: d.shohinCode } }] },
      '品目': { select: { name: hinmoku } },
      'タイヤサイズ': { rich_text: [{ text: { content: tireInfo.size } }] },
      '数量': { number: d.suryou || 0 },
      '単価': { number: unitPrice || 0 },
      '税区分': { select: { name: isInclusive ? '内税' : '外税' } },
      '税額': { number: zei },
      '税込小計': { number: zeikomi },
      '備考': { rich_text: [{ text: { content: hankanaToZen(d.productName) } }] },
    };
    if (d.unit) props['単位'] = { select: { name: d.unit } };
    if (d.bikou) props['弥生備考'] = { rich_text: [{ text: { content: d.bikou } }] };
    let ok = false;
    for (let retry = 0; retry < 3 && !ok; retry++) {
      try {
        const r = await nf('POST', '/pages', { parent: { database_id: DETAIL_DB }, properties: props });
        if (r.object === 'error') throw new Error(r.message);
        if (!r.id) throw new Error('no id');
        ok = true;
        added++;
        console.log(`  ✓ ${d.shohinCode} ${d.productName.slice(0,30)} (${d.suryou}×${unitPrice})`);
      } catch(e) {
        if (retry < 2) { console.log(`  ⚠️ リトライ ${retry+1}/3: ${e.message}`); await sleep(2000); }
        else { console.log(`  ❌ ${d.shohinCode}: ${e.message}`); failed++; }
      }
    }
    await sleep(400);
  }
}

console.log();
console.log('=== 結果 ===');
console.log('追加:', added, '件');
if (failed > 0) console.log('失敗:', failed, '件');
