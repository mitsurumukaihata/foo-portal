#!/usr/bin/env node
// Phase 1-A: Notion 全DBから JSONエクスポート
// per-slip filter で300件キャップ回避しつつ全件取得

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(SCRIPT_DIR, 'export');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const LOG_FILE = path.join(SCRIPT_DIR, 'export.log');
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

// 3rd run: 残り (勤怠・入金・発注)
const DBS = {
  '勤怠管理':     { id: '200a695f8e8880b181d8c77b7dde51b5', dateProp: '日付', large: true },
  '入金管理':     { id: 'a43b48a848084be3bc16841ec0c8603a', small: false },
  '発注管理':     { id: '202a695f8e8880aa92f6f38d9b47b537', small: false },
};

// 月単位でページを全件取得（300件キャップ回避）
async function fetchAllByMonth(dbId, dateProp, fromYm, toYm) {
  const all = [];
  const [fromY, fromM] = fromYm.split('-').map(Number);
  const [toY, toM] = toYm.split('-').map(Number);
  const monthList = [];
  for (let y = fromY, m = fromM; y < toY || (y === toY && m <= toM); m++) {
    if (m > 12) { m = 1; y++; }
    monthList.push({ y, m });
  }
  log(`    月スライス ${monthList.length}ヶ月分取得中...`);
  let fetchedMonths = 0;
  for (const { y, m } of monthList) {
    const lastDay = new Date(y, m, 0).getDate();
    const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
    const endDate = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    let cursor = null, monthAll = [];
    do {
      const b = {
        page_size: 100,
        filter: { property: dateProp, date: { on_or_after: startDate, on_or_before: endDate } }
      };
      if (cursor) b.start_cursor = cursor;
      const r = await nf('POST', '/databases/' + dbId + '/query', b);
      if (r.object === 'error') {
        log(`      ❌ ${startDate}: ${r.code}`);
        break;
      }
      monthAll.push(...(r.results || []));
      cursor = r.has_more ? r.next_cursor : null;
      if (monthAll.length > 500) break; // safety
    } while (cursor);
    all.push(...monthAll);
    fetchedMonths++;
    if (fetchedMonths % 6 === 0) {
      log(`      進捗 ${fetchedMonths}/${monthList.length}ヶ月 / 累計${all.length}件`);
    }
    await sleep(30);
  }
  return all;
}

// 親伝票IDで分割取得（明細DB用）
async function fetchAllByParent(dbId, parentRelProp, parentIds) {
  const all = [];
  const CHUNK = 30; // 一度に検索する親ID数
  log(`    親分割 ${parentIds.length}件の親から明細取得中...`);
  let chunks = 0;
  for (let i = 0; i < parentIds.length; i += CHUNK) {
    const batch = parentIds.slice(i, i + CHUNK);
    let cursor = null;
    do {
      const b = {
        page_size: 100,
        filter: batch.length === 1
          ? { property: parentRelProp, relation: { contains: batch[0] } }
          : { or: batch.map(id => ({ property: parentRelProp, relation: { contains: id } })) }
      };
      if (cursor) b.start_cursor = cursor;
      const r = await nf('POST', '/databases/' + dbId + '/query', b);
      if (r.object === 'error') { log(`      ❌ batch err: ${r.code}`); break; }
      all.push(...(r.results || []));
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
    chunks++;
    if (chunks % 10 === 0) {
      log(`      進捗 ${Math.min(i+CHUNK, parentIds.length)}/${parentIds.length}親 / 累計${all.length}明細`);
    }
    await sleep(50);
  }
  return all;
}

// 通常クエリ（小規模DB）
async function fetchAll(dbId) {
  const all = []; let cursor = null;
  do {
    const b = { page_size: 100 };
    if (cursor) b.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + dbId + '/query', b);
    if (r.object === 'error') break;
    all.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return all;
}

log('━━━ Notion エクスポート開始 ━━━');

const stats = {};
for (const [name, def] of Object.entries(DBS)) {
  log(`📥 ${name} 取得中...`);
  let records = [];
  try {
    if (name === '売上明細') {
      // 売上伝票IDから明細取得
      const slipExport = JSON.parse(fs.readFileSync(path.join(OUT_DIR, '売上伝票.json'), 'utf-8'));
      const slipIds = slipExport.map(s => s.id);
      records = await fetchAllByParent(def.id, '売上伝票', slipIds);
    } else if (name === '仕入明細') {
      const slipExport = JSON.parse(fs.readFileSync(path.join(OUT_DIR, '仕入伝票.json'), 'utf-8'));
      const slipIds = slipExport.map(s => s.id);
      records = await fetchAllByParent(def.id, '仕入伝票', slipIds);
    } else if (def.large && def.dateProp) {
      // 日付分割
      const fromYm = name.includes('勤怠') ? '2024-01' : '2023-04';
      records = await fetchAllByMonth(def.id, def.dateProp, fromYm, '2026-04');
    } else {
      records = await fetchAll(def.id);
    }
    log(`   ✅ ${records.length}件取得`);
    fs.writeFileSync(path.join(OUT_DIR, name + '.json'), JSON.stringify(records, null, 2));
    stats[name] = records.length;
  } catch(e) {
    log(`   ❌ エラー: ${e.message}`);
    stats[name] = -1;
  }
}

log('━━━ エクスポート完了 ━━━');
for (const [name, count] of Object.entries(stats)) {
  log(`  ${name}: ${count}件`);
}
fs.writeFileSync(path.join(OUT_DIR, '_stats.json'), JSON.stringify(stats, null, 2));
