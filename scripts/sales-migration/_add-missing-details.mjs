// 任意月で「弥生にあるがNotionにない」明細を検出し、--apply でNotionに追加
// 使い方: node _add-missing-details.mjs --year YYYY --month M [--apply]
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year'));
const MONTH = parseInt(getArg('month'));
const APPLY = process.argv.includes('--apply');
if (!YEAR || !MONTH) { console.log('--year YYYY --month M 必須'); process.exit(1); }

const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${new Date(YEAR, MONTH, 0).getDate()}`;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

function nf(method, p, body, retries = 20) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try { const pp = JSON.parse(c); if (pp.object === 'error' && pp.code === 'rate_limited' && n > 0) { setTimeout(() => tryFetch(n-1), 60000); return; } res(pp); } catch(e) { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(new Error(c.slice(0, 300))); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 品目マッピング
function mapHinmoku(code, name) {
  if (/^V/.test(code)) return 'バルブ';
  if (/^N/.test(code)) return 'ナット';
  if (/^SH/.test(code)) return '出張';
  if (code === 'HT02' || /ハイタイヤ/.test(name)) return 'その他';
  if (code === 'HT03') return 'その他';
  if (/組替/.test(name)) return '組替';
  if (/脱着/.test(name)) return '脱着';
  if (/バランス/.test(name)) return 'バランス';
  if (/廃タイヤ/.test(name)) return '廃タイヤ';
  if (/^L?K/.test(code)) return '組替';
  if (/タイヤ/.test(name)) return 'タイヤ';
  return 'その他';
}

// 弥生
const candidates = [
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
];
const qs = [[1,3],[4,6],[7,9],[10,12]];
for (const [s, e] of qs) if (MONTH >= s && MONTH <= e) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${s}-${YEAR}.${e}.xlsx`);
if (MONTH >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.4-${YEAR+1}.3.xlsx`);
else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR-1}.4-${YEAR}.3.xlsx`);
const FILE = candidates.find(p => fs.existsSync(p));

const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoiDetails = new Map();
const yayoiSlipTaxType = new Map();
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  const ds = row[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(row[2]).trim();
  const taxType = String(row[7] || '');
  const name = String(row[15] || '').trim();
  yayoiSlipTaxType.set(num, taxType);
  if (name === '《消費税》') continue;
  const code = String(row[14] || '').trim();
  const qty = parseFloat(row[21]) || 0;
  const tanka = parseFloat(row[23]) || 0;
  const kingaku = parseFloat(row[25]) || 0;
  const bikou = String(row[30] || '').trim();
  if (!yayoiDetails.has(num)) yayoiDetails.set(num, []);
  yayoiDetails.get(num).push({ code, name, qty, tanka, kingaku, bikou });
}

console.log(APPLY ? '[APPLY]' : '[DRY]', YEAR + '/' + MONTH);

// Notion
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

// 不足検出
const missingReports = [];
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  const num = m[1];
  const yayoiLines = yayoiDetails.get(num);
  if (!yayoiLines) continue;

  const notionDetails = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    notionDetails.push(...(r.results || []));
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);

  if (notionDetails.length >= yayoiLines.length) continue;

  const notionKeys = new Set();
  for (const d of notionDetails) {
    const c = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
    const q = d.properties['数量']?.number || 0;
    const t = d.properties['単価']?.number || 0;
    notionKeys.add(`${c}|${q}|${t}`);
  }
  const missing = yayoiLines.filter(y => !notionKeys.has(`${y.code}|${y.qty}|${y.tanka}`));
  if (missing.length > 0) missingReports.push({ num, pageId: s.id, missing, taxType: yayoiSlipTaxType.get(num) || '' });
  await sleep(30);
}

console.log('\n明細不足伝票:', missingReports.length, '件');
let totalMissing = 0;
let totalAmount = 0;
for (const r of missingReports) {
  console.log(`\n伝票${r.num} (${r.pageId.slice(0,8)}) 税区分=${r.taxType} 不足=${r.missing.length}件:`);
  for (const m of r.missing) {
    console.log(`  [${m.code}] ${m.name.slice(0,30)} qty=${m.qty} 単価=${m.tanka} 金額=${m.kingaku} 備考="${m.bikou.slice(0,20)}"`);
    totalMissing++;
    totalAmount += m.kingaku;
  }
}
console.log(`\n合計: ${totalMissing}明細 / ${totalAmount.toLocaleString()}円`);

if (APPLY && totalMissing > 0) {
  console.log('\n[APPLY] 不足明細を追加中...');
  let addedCount = 0;
  let totalZeinukiIncrement = 0;
  const slipIncrements = new Map();  // pageId → {zeinuki, zei, zeikomi}
  for (const r of missingReports) {
    let sz = 0, st = 0, sk = 0;
    for (const m of r.missing) {
      const isInternal = /内税/.test(r.taxType);
      // 内税の場合: 金額には税込、税抜=round(金額/1.1)、税額=金額-税抜
      // 外税の場合: 金額=税抜、税額=round(税抜*0.1)、税込=金額+税額
      let zeinuki, zeigaku, zeikomi;
      if (isInternal) {
        zeinuki = Math.round(m.kingaku / 1.1);
        zeigaku = m.kingaku - zeinuki;
        zeikomi = m.kingaku;
      } else {
        zeinuki = m.kingaku;
        zeigaku = Math.round(m.kingaku * 0.1);
        zeikomi = m.kingaku + zeigaku;
      }
      sz += zeinuki;
      st += zeigaku;
      sk += zeikomi;
      const props = {
        '明細タイトル': { title: [{ text: { content: (m.code + ' ' + m.name).slice(0, 200) } }] },
        '商品コード': { rich_text: [{ text: { content: m.code } }] },
        '品目': { select: { name: mapHinmoku(m.code, m.name) } },
        '数量': { number: m.qty },
        '単価': { number: m.tanka },
        '税込小計': { number: zeikomi },
        '税額': { number: zeigaku },
        '税区分': { select: { name: isInternal ? '内税' : '外税' } },
        '売上伝票': { relation: [{ id: r.pageId }] },
      };
      if (m.bikou) props['備考'] = { rich_text: [{ text: { content: m.bikou.slice(0, 200) } }] };
      try {
        const res = await nf('POST', '/pages', { parent: { database_id: DETAIL_DB }, properties: props });
        if (res.object === 'error') console.warn('  error:', res.message);
        else { addedCount++; }
      } catch(e) { console.error('  error:', e.message); }
      await sleep(300);
    }
    slipIncrements.set(r.pageId, { zeinuki: sz, zei: st, zeikomi: sk });
  }

  // 親伝票の税抜合計・税込合計・消費税合計も加算
  console.log('\n伝票合計を更新中...');
  for (const [pageId, inc] of slipIncrements) {
    try {
      const g = await nf('GET', '/pages/' + pageId);
      const curZ = g.properties['税抜合計']?.number || 0;
      const curS = g.properties['消費税合計']?.number || 0;
      const curK = g.properties['税込合計']?.number || 0;
      const nz = curZ + inc.zeinuki;
      const ns = curS + inc.zei;
      const nk = curK + inc.zeikomi;
      console.log(`  ${pageId.slice(0,8)}: 税抜 ${curZ.toLocaleString()}→${nz.toLocaleString()}`);
      await nf('PATCH', '/pages/' + pageId, { properties: {
        '税抜合計': { number: nz },
        '消費税合計': { number: ns },
        '税込合計': { number: nk },
      }});
      await sleep(300);
    } catch(e) { console.error('  update error:', e.message); }
  }
  console.log('追加完了:', addedCount, '明細');
}
