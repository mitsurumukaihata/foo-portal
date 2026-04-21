// 弥生の備考列（エンドユーザー名+車番+管理番号等）をNotionの売上明細に追記
import https from 'https';
import XLSX from 'xlsx';

function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev', path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>res(JSON.parse(c))); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

// 1. Excelから伝票番号→明細行の備考列を抽出
const wb = XLSX.readFile('C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　2026.3.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// 伝票番号→[{code, bikou, idx}]の順序付きリストを作る
const slipDetails = new Map();
for (let i = 5; i < rows.length - 1; i++) {
  const row = rows[i];
  const denpyoNo = String(row[2] || '').trim();
  const shohinName = String(row[15] || '').trim();
  if (!denpyoNo || shohinName === '《消費税》') continue;
  const code = String(row[14] || '').trim();
  const bikou = String(row[30] || '').trim();
  if (!slipDetails.has(denpyoNo)) slipDetails.set(denpyoNo, []);
  slipDetails.get(denpyoNo).push({ code, bikou });
}
console.log('弥生: ' + slipDetails.size + ' 伝票');

// 2. Notionの売上明細を全件取得
console.log('Notion明細を取得中...');
const allDetails = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${DETAIL_DB}/query`, body);
  allDetails.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('Notion明細: ' + allDetails.length + ' 件');

// 3. 伝票IDごとにグルーピングして created_time 順にソート
const bySlipId = new Map();
allDetails.forEach(d => {
  const slipRel = d.properties['売上伝票']?.relation?.[0]?.id;
  if (!slipRel) return;
  if (!bySlipId.has(slipRel)) bySlipId.set(slipRel, []);
  bySlipId.get(slipRel).push(d);
});
// 各伝票グループ内をcreated_time順にソート
for (const [, arr] of bySlipId) {
  arr.sort((a, b) => (a.created_time || '').localeCompare(b.created_time || ''));
}

// 4. 売上伝票を全件取得して、弥生伝票番号→NotionSlipID のマップを作る
console.log('売上伝票を取得中...');
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const allSlips = [];
cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  allSlips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

const slipIdByDenpyoNo = new Map();
allSlips.forEach(s => {
  const bikou = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = bikou.match(/弥生伝票(\d+)/);
  if (m) slipIdByDenpyoNo.set(m[1], s.id);
});
console.log('売上伝票マップ: ' + slipIdByDenpyoNo.size + ' 件');

// 5. マッチングして弥生備考を書き込み
let updated = 0, skipped = 0, noMatch = 0;
for (const [denpyoNo, yayoiRows] of slipDetails) {
  const slipId = slipIdByDenpyoNo.get(denpyoNo);
  if (!slipId) { noMatch += yayoiRows.length; continue; }
  const notionRows = bySlipId.get(slipId);
  if (!notionRows) { noMatch += yayoiRows.length; continue; }

  // 弥生の順番とNotionの順番を1:1で対応
  for (let j = 0; j < Math.min(yayoiRows.length, notionRows.length); j++) {
    const yBikou = yayoiRows[j].bikou;
    if (!yBikou) { skipped++; continue; }
    const notionId = notionRows[j].id;
    await nf('PATCH', `/pages/${notionId}`, {
      properties: {
        '弥生備考': { rich_text: [{ text: { content: yBikou } }] },
      }
    });
    updated++;
    await sleep(200);
  }
  if (updated % 50 === 0 && updated > 0) console.log('  ' + updated + ' 件更新...');
}

console.log();
console.log('=== 結果 ===');
console.log('更新: ' + updated + ' 件');
console.log('スキップ（備考空）: ' + skipped + ' 件');
console.log('マッチなし: ' + noMatch + ' 件');
