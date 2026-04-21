// 弥生Excelから正確な税抜合計・消費税合計・税込合計を算出してNotion伝票に書き戻す
// 使い方: node _fix-slip-totals.mjs --year 2026 --month 3
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '3'));
const MM = MONTH.toString().padStart(2, '0');
const LAST = new Date(YEAR, MONTH, 0).getDate();
const DATE_FROM = `${YEAR}-${MM}-01`;
const DATE_TO = `${YEAR}-${MM}-${String(LAST).padStart(2,'0')}`;

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';

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

console.log(`=== ${YEAR}/${MONTH} 伝票合計の修正 ===`);

// 弥生Excelから伝票別の正確な合計を計算（月次・四半期・年単位バンドル対応）
let FILE = null;
const candidates = [
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
];
const qs = [[1,3],[4,6],[7,9],[10,12]];
for (const [s, e] of qs) if (MONTH >= s && MONTH <= e) {
  candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${s}-${YEAR}.${e}.xlsx`);
}
if (MONTH >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.4-${YEAR+1}.3.xlsx`);
else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR-1}.4-${YEAR}.3.xlsx`);
FILE = candidates.find(p => fs.existsSync(p));
if (!FILE) { console.log('Excelファイルなし'); process.exit(1); }
const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

// 伝票番号 → { isInternal, total, taxLine }
// 内税: total=金額合計(税込), taxLine=消費税行
// 外税: total=金額合計(税抜), taxLine=消費税行
const yayoiSlips = new Map();
for (let i = 5; i < data.length; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  // バンドルファイル対応: 日付で対象月に絞る
  const ds = r[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  const num = String(r[2]).trim();
  const taxType = String(r[7] || '');
  const prodName = String(r[15] || '');
  const amount = Number(r[25]) || 0;
  if (!yayoiSlips.has(num)) yayoiSlips.set(num, { isInternal: taxType.includes('内税'), total: 0, taxLine: 0 });
  const e = yayoiSlips.get(num);
  if (prodName === '《消費税》') e.taxLine += amount;
  else e.total += amount;
}

// 伝票別の正確な合計を計算
// 内税伝票: 弥生の金額=税込、消費税行=ほぼ0 → 税抜=round(金額/1.1)
// 外税伝票: 弥生の金額=税抜、消費税行=消費税
const correctTotals = new Map();
for (const [num, y] of yayoiSlips) {
  let zeinuki, zei, zeikomi;
  if (y.isInternal) {
    if (y.taxLine > 0) {
      // まれに消費税行があるケース
      zeinuki = y.total - y.taxLine;
      zei = y.taxLine;
      zeikomi = y.total;
    } else {
      // 金額=税込、消費税行=0 → 伝票単位で税抜換算（最小誤差）
      zeinuki = Math.round(y.total / 1.1);
      zei = y.total - zeinuki;
      zeikomi = y.total;
    }
  } else {
    // 外税伝票: 金額=税抜、消費税行=消費税
    zeinuki = y.total;
    zei = y.taxLine;
    zeikomi = zeinuki + zei;
  }
  correctTotals.set(num, { zeinuki, zei, zeikomi });
}

// Notion伝票を取得
console.log('Notion伝票取得中...');
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
console.log('Notion伝票:', slips.length);

let updated = 0;
let totalZeinuki = 0;
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  const num = m[1];
  const correct = correctTotals.get(num);
  if (!correct) continue;

  const curZeinuki = s.properties['税抜合計']?.number || 0;
  totalZeinuki += correct.zeinuki;

  if (curZeinuki !== correct.zeinuki) {
    try {
      await nf('PATCH', '/pages/' + s.id, {
        properties: {
          '税抜合計': { number: correct.zeinuki },
          '消費税合計': { number: correct.zei },
          '税込合計': { number: correct.zeikomi },
        }
      });
      updated++;
      if (updated % 20 === 0) console.log('  ' + updated + '件修正...');
    } catch(e) { console.log('  ❌ 伝票' + num + ':', e.message); }
    await sleep(150);
  }
}

console.log();
console.log('修正:', updated, '件');
console.log('Notion税抜合計（修正後）:', totalZeinuki.toLocaleString());
