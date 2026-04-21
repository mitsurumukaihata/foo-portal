// Phase D: 36ヶ月の最終照合レポート
// 各月の3帳票（売上明細計算/商品別日報/得意先別日報/Notion）を統合した最終サマリを出力
import { spawnSync } from 'child_process';
import XLSX from 'xlsx';
import fs from 'fs';
import https from 'https';

const WORKER = 'notion-proxy.33322666666mm.workers.dev';
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
function nf(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: WORKER, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
      let c = '';
      r.on('data', x => c += x);
      r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { rej(new Error(c.slice(0,200))); } });
    });
    req.on('error', rej);
    if (d) req.write(d);
    req.end();
  });
}

function readReportTotal(path) {
  if (!fs.existsSync(path)) return null;
  const wb = XLSX.readFile(path);
  const d = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  for (let i = d.length - 1; i >= 0; i--) {
    const r = d[i] || [];
    if (String(r[1] || '').trim() === '<<総合計>>') {
      return Number(r[10] || r[9] || 0);
    }
  }
  return null;
}

function readSalesFile(year, month) {
  const candidates = [
    `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${year}.${month}.xlsx`,
    `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.${month}.xlsx`,
  ];
  const qs = [[1,3],[4,6],[7,9],[10,12]];
  for (const [s, e] of qs) if (month >= s && month <= e) {
    candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.${s}-${year}.${e}.xlsx`);
  }
  if (month >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year}.4-${year+1}.3.xlsx`);
  else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${year-1}.4-${year}.3.xlsx`);
  return candidates.find(p => fs.existsSync(p));
}

function computeSalesZeinuki(year, month) {
  const file = readSalesFile(year, month);
  if (!file) return null;
  const wb = XLSX.readFile(file);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const slips = new Map();
  for (let i = 5; i < data.length - 1; i++) {
    const r = data[i];
    if (!r || !r[2]) continue;
    const ds = r[1];
    if (typeof ds === 'number') {
      const dt = new Date((ds - 25569) * 86400 * 1000);
      if (dt.getFullYear() !== year || dt.getMonth() + 1 !== month) continue;
    }
    const num = String(r[2]).trim();
    const taxType = String(r[7] || '');
    const name = String(r[15] || '');
    const amount = parseFloat(r[25] || 0);
    if (!slips.has(num)) slips.set(num, { isInternal: /内税/.test(taxType), lines: [], taxLine: 0 });
    const s = slips.get(num);
    if (name === '《消費税》') s.taxLine += amount;
    else s.lines.push({ amount });
  }
  let zeinuki = 0;
  for (const [num, s] of slips) {
    const lineSum = s.lines.reduce((a, x) => a + x.amount, 0);
    if (s.isInternal && s.taxLine === 0) zeinuki += Math.round(lineSum / 1.1);
    else if (s.isInternal) zeinuki += lineSum - s.taxLine;
    else zeinuki += lineSum;
  }
  return { zeinuki, slipCount: slips.size };
}

async function getNotionTotal(year, month) {
  const mm = String(month).padStart(2, '0');
  const lastD = new Date(year, month, 0).getDate();
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(lastD).padStart(2,'0')}`;
  let slips = [];
  let cursor = null;
  do {
    const body = { filter: { and: [
      { property: '売上日', date: { on_or_after: from } },
      { property: '売上日', date: { on_or_before: to } },
    ]}, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
    slips.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  let total = 0;
  for (const s of slips) total += s.properties['税抜合計']?.number || 0;
  return { total, count: slips.length };
}

const months = [];
for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  if (y === 2023 && m < 4) continue;
  if (y === 2026 && m > 3) continue;
  months.push({ y, m });
}

console.log('=== Phase D: 36ヶ月 最終レポート ===');
console.log();
console.log('年月    | 売明計算    | 商品日報    | 得意先日報  | Notion      | N伝票 | 売明-商品 | 売明-得意 | Notion-売明');
console.log('─'.repeat(120));

const rows = [];
for (const { y, m } of months) {
  const sales = computeSalesZeinuki(y, m);
  const shohin = readReportTotal(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/商品別売上日報/商品別売上日報　${y}.${m}.xlsx`);
  const tokui = readReportTotal(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/得意先別売上日報/得意先別売上日報　${y}.${m}.xlsx`);
  let notion = null;
  try { notion = await getNotionTotal(y, m); } catch(e) { notion = { total: null, count: null }; }
  const sz = sales ? sales.zeinuki : null;
  const d1 = (sz != null && shohin != null) ? sz - shohin : null;
  const d2 = (sz != null && tokui != null) ? sz - tokui : null;
  const d3 = (notion && notion.total != null && sz != null) ? notion.total - sz : null;
  const row = { year: y, month: m, sales: sz, shohin, tokui, notion: notion?.total, notionCount: notion?.count, slipCount: sales?.slipCount, diff1: d1, diff2: d2, diff3: d3 };
  rows.push(row);
  console.log(`${y}/${String(m).padStart(2)}  | ${String(sz || '-').padStart(11)} | ${String(shohin || '-').padStart(11)} | ${String(tokui || '-').padStart(11)} | ${String(notion?.total || '-').padStart(11)} | ${String(notion?.count || '-').padStart(5)} | ${String(d1 || '').padStart(9)} | ${String(d2 || '').padStart(9)} | ${String(d3 || '').padStart(11)}`);
}

const sumSales = rows.reduce((a, r) => a + (r.sales || 0), 0);
const sumShohin = rows.reduce((a, r) => a + (r.shohin || 0), 0);
const sumTokui = rows.reduce((a, r) => a + (r.tokui || 0), 0);
const sumNotion = rows.reduce((a, r) => a + (r.notion || 0), 0);
console.log('─'.repeat(120));
console.log(`合計    | ${String(sumSales).padStart(11)} | ${String(sumShohin).padStart(11)} | ${String(sumTokui).padStart(11)} | ${String(sumNotion).padStart(11)}`);

fs.writeFileSync('_phase-d-final.json', JSON.stringify(rows, null, 2));
console.log();
console.log('→ _phase-d-final.json');
