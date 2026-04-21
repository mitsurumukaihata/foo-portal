#!/usr/bin/env node
// 未マッチ115顧客を 得意先マスタDB に追加
// - 既に同名の顧客がいればスキップ
// - 新規作成時: 有効=false で登録（後からユーザーが判断してONに）
// - メモに「タイヤ管理表由来・要確認」と記載

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CUSTOMER_DB = 'f632f512f12d49b2b11f2b3e45c70aec';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, 'add-unmatched.log');

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
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d); req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 既存の顧客名を全取得（正規化して比較用）
log('📥 既存得意先マスタ取得中...');
const existingNames = new Set();
{
  let cursor = null, pages = 0;
  do {
    const b = { page_size: 100 };
    if (cursor) b.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + CUSTOMER_DB + '/query', b);
    for (const p of (r.results || [])) {
      const name = p.properties['得意先名']?.title?.[0]?.plain_text || '';
      if (name) existingNames.add(name.trim().replace(/\s/g, '').replace(/\(\d+\)/g, '').toLowerCase());
    }
    cursor = r.has_more ? r.next_cursor : null;
    pages++;
    if (pages > 10) break; // 300件キャップ
  } while(cursor);
}
log(`   既存: ${existingNames.size}件`);

const unmatched = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'unmatched-files.json'), 'utf-8'));
log(`📋 追加対象候補: ${unmatched.length}件`);

let ok=0, skip=0, fail=0;
const results = { created: [], skipped: [], failed: [] };
for (let i = 0; i < unmatched.length; i++) {
  const u = unmatched[i];
  const raw = u.custName.trim();
  const normalized = raw.replace(/\s/g, '').replace(/\(\d+\)/g, '').toLowerCase();
  if (existingNames.has(normalized)) {
    skip++;
    results.skipped.push(raw);
    continue;
  }
  // 作成
  const props = {
    '得意先名': { title: [{ text: { content: raw.slice(0, 100) } }] },
    '有効': { checkbox: false },
    'メモ': { rich_text: [{ text: { content: 'タイヤ管理表由来・要確認（自動追加 2026-04-21）' } }] },
  };
  const r = await nf('POST', '/pages', { parent: { database_id: CUSTOMER_DB }, properties: props });
  if (!r || r.object === 'error' || !r.id) {
    fail++;
    results.failed.push({ name: raw, error: r?.code + ':' + (r?.message?.slice(0,80)||'') });
    log(`  ❌ ${raw}: ${r?.code}`);
  } else {
    ok++;
    existingNames.add(normalized);
    results.created.push(raw);
  }
  await sleep(200);
  if ((i+1) % 20 === 0) log(`  📊 ${i+1}/${unmatched.length} ✅${ok} ⏭${skip} ❌${fail}`);
}

log('━━━ 完了 ━━━');
log(`✅ 作成: ${ok}件  ⏭ スキップ: ${skip}件  ❌ 失敗: ${fail}件`);
fs.writeFileSync(path.join(SCRIPT_DIR, 'add-unmatched-results.json'), JSON.stringify(results, null, 2));
log('→ add-unmatched-results.json に詳細');
