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
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';

// 1. 弥生から《消費税》行の金額を伝票番号ごとに抽出
const wb = XLSX.readFile('C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　2026.3.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

const yayoiTax = new Map(); // 伝票番号 → 弥生消費税額
for (let i = 5; i < rows.length - 1; i++) {
  const row = rows[i];
  const denpyoNo = String(row[2] || '').trim();
  const name = String(row[15] || '').trim();
  if (name === '《消費税》' && denpyoNo) {
    const tax = parseFloat(row[25] || 0);
    yayoiTax.set(denpyoNo, (yayoiTax.get(denpyoNo) || 0) + tax);
  }
}
console.log('弥生《消費税》行: ' + yayoiTax.size + ' 伝票');

// 2. Notionの売上伝票を全件取得
const slips = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  slips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('Notion伝票: ' + slips.length + ' 件');

// 3. 備考から弥生伝票番号を抽出して照合・上書き
let fixed = 0, noChange = 0, noMatch = 0, totalDiff = 0;
for (const s of slips) {
  const bikou = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = bikou.match(/弥生伝票(\d+)/);
  if (!m) { noMatch++; continue; }
  const dNo = m[1];
  const yTax = yayoiTax.get(dNo);
  if (yTax === undefined) { noMatch++; continue; }

  const currentTax = s.properties['消費税合計']?.number || 0;
  const currentZeinuki = s.properties['税抜合計']?.number || 0;
  const diff = yTax - currentTax;

  if (diff === 0) { noChange++; continue; }

  totalDiff += diff;
  const newZeikomi = currentZeinuki + yTax;
  await nf('PATCH', `/pages/${s.id}`, {
    properties: {
      '消費税合計': { number: yTax },
      '税込合計': { number: newZeikomi },
    }
  });
  fixed++;
  await sleep(350);
}

console.log();
console.log('=== 修正結果 ===');
console.log('修正: ' + fixed + ' 件');
console.log('変更なし: ' + noChange + ' 件');
console.log('マッチなし: ' + noMatch + ' 件');
console.log('差額合計: ' + totalDiff + ' 円 (これが0→12のうち修正された分)');
