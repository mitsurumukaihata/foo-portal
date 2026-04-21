// 指定月の売上伝票を全削除→Excelから再投入
// 使い方: node _reset-and-reimport.mjs --year 2026 --month 3

import https from 'https';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  return args[i + 1] || true;
}
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '3'));
const MM = MONTH.toString().padStart(2, '0');
const LAST_DAY = new Date(YEAR, MONTH, 0).getDate();
const DATE_FROM = `${YEAR}-${MM}-01`;
const DATE_TO = `${YEAR}-${MM}-${LAST_DAY}`;

const WORKER = 'notion-proxy.33322666666mm.workers.dev';
const SALES_DB  = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const CUST_DB   = '1ca8d122be214e3892879932147143c9';

function nf(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: WORKER, path: p, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let c = '';
      res.on('data', d => c += d);
      res.on('end', () => { try { resolve(JSON.parse(c)); } catch(e) { reject(new Error('Parse: ' + c.slice(0, 300))); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log(`=== ${YEAR}/${MONTH} 売上データ リセット＆再投入 ===`);
console.log(`期間: ${DATE_FROM} 〜 ${DATE_TO}`);

// ═══════════════════════════════════════════════════════════
// ① 既存の伝票と明細を全削除
// ═══════════════════════════════════════════════════════════
console.log();
console.log('[1/3] 既存伝票を取得中...');
const slips = [];
let cursor = null;
do {
  const body = {
    filter: { and: [
      { property: '売上日', date: { on_or_after: DATE_FROM } },
      { property: '売上日', date: { on_or_before: DATE_TO } },
    ]},
    page_size: 100
  };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  slips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log(`  既存伝票: ${slips.length}件`);

console.log('[1/3] 既存明細を取得中...');
let allDetails = 0;
for (const s of slips) {
  let dcursor = null;
  const ids = [];
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: s.id } }, page_size: 100 };
    if (dcursor) body.start_cursor = dcursor;
    const r = await nf('POST', `/databases/${DETAIL_DB}/query`, body);
    ids.push(...(r.results || []).map(p => p.id));
    dcursor = r.has_more ? r.next_cursor : null;
  } while (dcursor);

  for (const id of ids) {
    try { await nf('PATCH', '/pages/' + id, { archived: true }); allDetails++; } catch(e) {}
    await sleep(80);
  }
  if (allDetails % 100 === 0 && allDetails > 0) console.log(`  明細削除: ${allDetails}件...`);
}
console.log(`  明細削除: ${allDetails}件`);

// 伝票も削除（再作成するので）
console.log('[1/3] 伝票削除中...');
let slipDel = 0;
for (const s of slips) {
  try { await nf('PATCH', '/pages/' + s.id, { archived: true }); slipDel++; } catch(e) {}
  await sleep(100);
}
console.log(`  伝票削除: ${slipDel}件`);

// ═══════════════════════════════════════════════════════════
// ② Excelから再投入（migrate-sales.mjsの簡易版を内包）
// ═══════════════════════════════════════════════════════════
console.log();
console.log('[2/3] Excel読込・再投入...');

let FILE_PATH = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(FILE_PATH)) {
  FILE_PATH = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
}
if (!fs.existsSync(FILE_PATH)) {
  console.log(`❌ Excelファイルが見つかりません: ${FILE_PATH}`);
  process.exit(1);
}
console.log(`  ファイル: ${FILE_PATH}`);

// migrate-sales.mjs を呼び出す
import { spawn } from 'child_process';
console.log('  → migrate-sales.mjs を呼び出します');
console.log();

const child = spawn('node', ['scripts/sales-migration/migrate-sales.mjs', '--file', `売上明細　${YEAR}.${MONTH}.xlsx`], {
  stdio: 'inherit',
  shell: true,
});

child.on('close', (code) => {
  console.log();
  console.log(code === 0 ? '✅ 完了' : '❌ エラー (code: ' + code + ')');
  process.exit(code);
});
