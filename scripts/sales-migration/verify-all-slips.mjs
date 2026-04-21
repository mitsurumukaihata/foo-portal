#!/usr/bin/env node
// 全Excelファイルの全弥生伝票を per-slip filter で検証
// - 存在 0件 → CREATE 必要（新規投入）
// - 存在 1件 → OK
// - 存在 ≥2件 → 重複！ 最古以外を archive
// 結果は verify-results.json に保存

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const CUST_DB = '1ca8d122be214e3892879932147143c9';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, 'verify-all.log');
const RESULTS_FILE = path.join(SCRIPT_DIR, 'verify-results.json');

const BASE_DIR = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細';

const ALL_FILES = [
  { file: '売上明細　2023.4-2023.6.xlsx' },
  { file: '売上明細　2023.7-2023.9.xlsx' },
  { file: '売上明細　2023.10-2023.12.xlsx' },
  { file: '売上明細　2024.1-2024.3.xlsx' },
  { file: '売上明細　2024.4-2025.3.xlsx' },
  { file: '売上明細　2025.4.xlsx' },
  { file: '売上明細　2025.5.xlsx' },
  { file: '売上明細　2025.6.xlsx' },
  { file: '売上明細　2025.7.xlsx' },
  { file: '売上明細　2025.8.xlsx' },
  { file: '売上明細　2025.9.xlsx' },
  { file: '売上明細　2025.10.xlsx' },
  { file: '売上明細　2025.11.xlsx' },
  { file: '売上明細　2025.12.xlsx' },
  { file: '売上明細　2026.1.xlsx' },
  { file: '売上明細　2026.2.xlsx' },
  { file: '売上明細　2026.3.xlsx' },
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function nf(method, p, body, retries = 6) {
  return new Promise((resolve) => {
    const tryFetch = (n, attempt = 1) => {
      const d = body ? JSON.stringify(body) : '';
      const opt = { hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json' } };
      if (d) opt.headers['Content-Length'] = Buffer.byteLength(d);
      const req = https.request(opt, r => {
        let c = ''; r.on('data', x => c += x);
        r.on('end', () => {
          let pp;
          try { pp = JSON.parse(c); }
          catch(e) { if (n>0) { setTimeout(()=>tryFetch(n-1, attempt+1), 5000); return; } return resolve({object:'error',code:'parse',message:e.message}); }
          if (pp?.object === 'error' && ['rate_limited','internal_server_error','service_unavailable','conflict_error','bad_gateway'].includes(pp.code) && n>0) {
            setTimeout(()=>tryFetch(n-1, attempt+1), Math.min(60000, 5000*Math.pow(2, attempt-1)));
            return;
          }
          resolve(pp);
        });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1, attempt+1), 5000); else resolve({object:'error',code:'network',message:e.message}); });
      req.setTimeout(45000, () => req.destroy());
      if (d) req.write(d); req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function excelDateToISO(serial) {
  const n = typeof serial === 'number' ? serial : parseFloat(serial);
  if (!n || isNaN(n)) return null;
  const d = new Date((n - 25569) * 86400 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

// 全Excel解析し、ユニークな slipNo+date ペアを集める
log('━━━ verify-all-slips 開始 ━━━');
log('📖 全Excelファイル解析中...');
const allSlips = new Map(); // key: slipNo|date → {slipNo, date, file}
for (const spec of ALL_FILES) {
  const fp = path.join(BASE_DIR, spec.file);
  if (!fs.existsSync(fp)) { log(`⚠️ ${spec.file} なし`); continue; }
  const wb = XLSX.readFile(fp);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  let cnt = 0;
  for (let i = 5; i < rows.length - 1; i++) {
    const row = rows[i];
    const denpyoNo = String(row[2] || '').trim();
    if (!denpyoNo) continue;
    const shohinName = String(row[15] || '').trim();
    if (shohinName === '《消費税》') continue;
    const date = excelDateToISO(row[1]);
    if (!date) continue;
    const key = denpyoNo + '|' + date;
    if (!allSlips.has(key)) { allSlips.set(key, { slipNo: denpyoNo, date, file: spec.file }); cnt++; }
  }
  log(`  ${spec.file}: ${cnt}伝票`);
}
log(`📋 全ユニーク伝票: ${allSlips.size}`);

// 全伝票を per-slip filter で検証（並列3本で高速化）
log('🔍 per-slip verify 開始（並列3）...');
const results = { ok: [], duplicate: [], missing: [], failed: [] };
let processed = 0;
const startTime = Date.now();

async function verifySlip(s) {
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', {
    filter: {
      and: [
        { property: '備考', rich_text: { contains: '弥生伝票' + s.slipNo } },
        { property: '売上日', date: { equals: s.date } },
      ]
    },
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    page_size: 5
  });
  if (r.object === 'error') {
    results.failed.push({ ...s, error: r.code });
    return;
  }
  const count = (r.results || []).length;
  if (count === 0) results.missing.push({ ...s });
  else if (count === 1) results.ok.push({ ...s, pageId: r.results[0].id });
  else {
    const dups = r.results.slice(1).map(p => p.id);
    results.duplicate.push({ ...s, kept: r.results[0].id, archiveIds: dups });
  }
}

const slipsArr = [...allSlips.values()];
const CONCURRENCY = 3;
const queue = slipsArr.slice();
async function worker() {
  while (queue.length > 0) {
    const s = queue.shift();
    if (!s) break;
    await verifySlip(s);
    processed++;
    if (processed % 100 === 0) {
      const el = Math.round((Date.now()-startTime)/1000);
      const rate = processed / (el || 1);
      const eta = Math.round((allSlips.size - processed) / (rate || 0.1));
      log(`  📊 ${processed}/${allSlips.size} ✅${results.ok.length} ⚠️${results.duplicate.length} ❓${results.missing.length} ❌${results.failed.length} / 経過${Math.floor(el/60)}分 残${Math.floor(eta/60)}分`);
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    }
    await sleep(50); // 軽いスロットリング
  }
}
await Promise.all(Array.from({length: CONCURRENCY}, () => worker()));

fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

// 重複を archive（並列3本で高速化）
log('🗑 重複レコード archive 開始（並列3）...');
const allArchiveIds = results.duplicate.flatMap(d => d.archiveIds);
log(`   対象: ${allArchiveIds.length}件`);
let archiveOk = 0, archiveFail = 0;
const archiveQueue = allArchiveIds.slice();
async function archiveWorker() {
  while (archiveQueue.length > 0) {
    const pid = archiveQueue.shift();
    if (!pid) break;
    const r = await nf('PATCH', '/pages/' + pid, { archived: true });
    if (!r || r.object === 'error') archiveFail++;
    else archiveOk++;
    const total = archiveOk + archiveFail;
    if (total % 50 === 0) log(`  archive ${total}/${allArchiveIds.length} ✅${archiveOk} ❌${archiveFail}`);
    await sleep(50);
  }
}
await Promise.all(Array.from({length: 3}, () => archiveWorker()));

const elapsed = Math.round((Date.now()-startTime)/1000);
log('━━━ 完了 ━━━');
log(`📊 検証結果:`);
log(`  ✅ OK (1件): ${results.ok.length}`);
log(`  ⚠️ DUPLICATE (2+件→archive対象): ${results.duplicate.length}`);
log(`  ❓ MISSING (Excelにあり/DBなし): ${results.missing.length}`);
log(`  ❌ 検索失敗: ${results.failed.length}`);
log(`🗑 archive 完了: ${archiveOk} / 失敗: ${archiveFail}`);
log(`⏱ 経過: ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
