// 汎用: 任意伝票の詳細を Notion と 弥生 で突合
// 使い方: node _inspect-slip-generic.mjs --year 2025 --month 2 --slip 00000450
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year', '2024'));
const MONTH = parseInt(getArg('month', '11'));
const TARGET = getArg('slip', '00014871');
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

const candidates = [
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
];
const qs = [[1,3],[4,6],[7,9],[10,12]];
for (const [s, e] of qs) if (MONTH >= s && MONTH <= e) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${s}-${YEAR}.${e}.xlsx`);
if (MONTH >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.4-${YEAR+1}.3.xlsx`);
else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR-1}.4-${YEAR}.3.xlsx`);
const FILE = candidates.find(p => fs.existsSync(p));

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

let target = null;
for (const s of all) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  if (memo.includes('弥生伝票' + TARGET)) { target = s; break; }
}
if (!target) { console.log('Notionに' + TARGET + '見つからず'); process.exit(1); }

console.log('=== Notion 伝票' + TARGET + ' ===');
console.log('pageId:', target.id);
console.log('売上日:', target.properties['売上日']?.date?.start);
console.log('税抜合計:', target.properties['税抜合計']?.number);
console.log('税込合計:', target.properties['税込合計']?.number);
console.log('消費税合計:', target.properties['消費税合計']?.number);
console.log('備考:', (target.properties['備考']?.rich_text?.[0]?.plain_text || '').slice(0, 200));

const dr = await nf('POST', '/databases/' + DETAIL_DB + '/query', {
  filter: { property: '売上伝票', relation: { contains: target.id } }, page_size: 100
});
console.log('\n--- Notion明細 (' + dr.results.length + '件) ---');
for (const d of dr.results) {
  const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
  const title = d.properties['明細タイトル']?.title?.[0]?.plain_text || '';
  const qty = d.properties['数量']?.number || 0;
  const tanka = d.properties['単価']?.number || 0;
  const zeikomi = d.properties['税込小計']?.number || 0;
  const zeigaku = d.properties['税額']?.number || 0;
  const taxKb = d.properties['税区分']?.select?.name || '';
  console.log(`  ${code} [${title.slice(0,30)}] ${qty}x${tanka} 税込=${zeikomi} 税額=${zeigaku} 税区分=${taxKb}`);
}

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
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  console.log(`  ${dstr} 税区分=${row[7]} 得意先=${row[5]} コード=${row[14]} 商品=${String(row[15]||'').slice(0,30)} 数量=${row[21]} 単価=${row[23]} 金額=${row[25]} 備考=${String(row[30]||'').slice(0,30)}`);
  found++;
}
if (!found) console.log('  弥生にも見つからず');
