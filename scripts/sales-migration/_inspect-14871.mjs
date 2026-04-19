// 伝票00014871 (2024/11) の詳細を Notion と 弥生 で突合
import https from 'https';
import XLSX from 'xlsx';

const TARGET = '00014871';
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

// Notion検索（2024/11）
const r = await nf('POST', '/databases/' + SALES_DB + '/query', {
  filter: { and: [
    { property: '売上日', date: { on_or_after: '2024-11-01' } },
    { property: '売上日', date: { on_or_before: '2024-11-30' } },
  ]}, page_size: 100
});
// ページング
const all = [...r.results];
let cursor = r.has_more ? r.next_cursor : null;
while (cursor) {
  const n = await nf('POST', '/databases/' + SALES_DB + '/query', { filter: { and: [
    { property: '売上日', date: { on_or_after: '2024-11-01' } },
    { property: '売上日', date: { on_or_before: '2024-11-30' } },
  ]}, page_size: 100, start_cursor: cursor });
  all.push(...n.results);
  cursor = n.has_more ? n.next_cursor : null;
}

let target = null;
for (const s of all) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  if (memo.includes('弥生伝票' + TARGET)) { target = s; break; }
}
if (!target) { console.log('Notionに' + TARGET + '見つからず'); process.exit(1); }

console.log('=== Notion 伝票' + TARGET + ' ===');
console.log('pageId:', target.id);
console.log('売上日:', target.properties['売上日']?.date?.start);
console.log('タイトル:', target.properties['タイトル']?.title?.[0]?.plain_text || target.properties['Name']?.title?.[0]?.plain_text);
console.log('得意先:', target.properties['得意先']?.rich_text?.[0]?.plain_text || JSON.stringify(target.properties['得意先マスタ']));
console.log('税抜合計:', target.properties['税抜合計']?.number);
console.log('税込合計:', target.properties['税込合計']?.number);
console.log('消費税:', target.properties['消費税']?.number);
console.log('内税/外税:', target.properties['税区分']?.select?.name);
console.log('備考:', (target.properties['備考']?.rich_text?.[0]?.plain_text || '').slice(0, 200));

// 明細取得
const dr = await nf('POST', '/databases/' + DETAIL_DB + '/query', {
  filter: { property: '売上伝票', relation: { contains: target.id } }, page_size: 100
});
console.log('\n--- Notion明細 (' + dr.results.length + '件) ---');
for (const d of dr.results) {
  const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
  const title = d.properties['明細タイトル']?.title?.[0]?.plain_text || '';
  const qty = d.properties['数量']?.number || 0;
  const tanka = d.properties['単価']?.number || 0;
  const zeinuki = d.properties['税抜小計']?.number || 0;
  const zeikomi = d.properties['税込小計']?.number || 0;
  console.log(`  ${code} [${title.slice(0,30)}] ${qty}x${tanka} 税抜=${zeinuki} 税込=${zeikomi}`);
}

// 弥生
console.log('\n=== 弥生 伝票' + TARGET + ' ===');
const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
let found = 0;
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || String(row[2] || '').trim() !== TARGET) continue;
  const ds = row[1];
  let dstr = '';
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    dstr = dt.toISOString().slice(0, 10);
    if (dt.getFullYear() !== 2024 || dt.getMonth() + 1 !== 11) continue;
  }
  console.log(`  ${dstr} 税区分=${row[7]} 得意先=${row[5]} 商品コード=${row[14]} 商品名=${row[15]} 数量=${row[21]} 単価=${row[23]} 金額=${row[25]} 備考=${row[30] || ''}`);
  found++;
}
if (!found) console.log('  弥生にも00014871なし（11月）');
