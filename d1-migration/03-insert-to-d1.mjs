#!/usr/bin/env node
// Phase 1-C: SQL ファイルを D1 へバルクインサート
// wrangler d1 execute で大量の SQL を分割実行

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(SCRIPT_DIR, 'sql');
const CHUNK_DIR = path.join(SCRIPT_DIR, 'sql-chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR);

const LOG_FILE = path.join(SCRIPT_DIR, 'insert.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

const WRANGLER_DIR = path.resolve(SCRIPT_DIR, '..', 'cloudflare-worker');

// D1 は1ファイルあたりのSQL実行に制限あり。
// 大きいSQLは分割（各チャンク最大 5000行 目安）
function splitSQL(sqlContent, maxStatementsPerChunk = 5) {
  // INSERT文ごとに分割。末尾の ; を除去して正規化
  const statements = sqlContent.split(/;\s*\n/)
    .map(s => s.trim().replace(/;$/, '').trim())  // 末尾のセミコロンを削除
    .filter(s => s);
  const chunks = [];
  for (let i = 0; i < statements.length; i += maxStatementsPerChunk) {
    const c = statements.slice(i, i + maxStatementsPerChunk).join(';\n') + ';';
    chunks.push(c);
  }
  return chunks;
}

// テーブル順（relation の順序を考慮） [ファイル名 ASCII, 実テーブル名]
const TABLE_ORDER = [
  ['customers', '得意先マスタ'],
  ['endusers', '顧客情報DB'],
  ['products', '商品マスタ'],
  ['suppliers', '仕入先マスタ'],
  ['vehicles', '車両マスタ'],
  ['sales_slips', '売上伝票'],
  ['sales_details', '売上明細'],
  ['purchase_slips', '仕入伝票'],
  ['purchase_details', '仕入明細'],
  ['kintai', '勤怠管理'],
  ['receipts', '入金管理'],
  ['orders', '発注管理'],
];

log('━━━ D1 インサート開始 ━━━');
const stats = {};
const startTime = Date.now();

for (const [fileSlug, tableName] of TABLE_ORDER) {
  const sqlPath = path.join(SQL_DIR, tableName + '.sql');
  if (!fs.existsSync(sqlPath)) {
    log(`⚠️ ${tableName}.sql が無い → skip`);
    stats[tableName] = { skipped: true };
    continue;
  }
  const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
  if (!sqlContent.trim()) {
    log(`⚠️ ${tableName}.sql 空 → skip`);
    stats[tableName] = { empty: true };
    continue;
  }

  log(`📥 ${tableName} インサート開始`);
  const chunks = splitSQL(sqlContent, 5);
  log(`   ${chunks.length} チャンクに分割`);

  let ok = 0, fail = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkName = `${fileSlug}-${i}.sql`;
    const chunkPath = path.join(CHUNK_DIR, chunkName);
    fs.writeFileSync(chunkPath, chunks[i]);
    const relPath = path.relative(WRANGLER_DIR, chunkPath).replace(/\\/g, '/');
    try {
      const cmd = `npx wrangler d1 execute foo-portal-db --remote --file="${relPath}" --yes`;
      const result = spawnSync(cmd, {
          cwd: WRANGLER_DIR,
          env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '0f8f7fc9f1f353c30d4407cc05954f00' },
          shell: true,
          stdio: 'pipe',
        }
      );
      if (result.status === 0) ok++;
      else {
        fail++;
        log(`   ❌ chunk ${i}: exit ${result.status} / ${result.stderr?.toString().slice(0,200)}`);
      }
    } catch(e) {
      fail++;
      log(`   ❌ chunk ${i}: ${e.message}`);
    }
    if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
      log(`   進捗 ${i+1}/${chunks.length} ✅${ok} ❌${fail}`);
    }
  }
  log(`   ✅ ${tableName}: ${ok}/${chunks.length} チャンク成功`);
  stats[tableName] = { chunks: chunks.length, ok, fail };
}

const elapsed = Math.round((Date.now() - startTime) / 1000);
log('━━━ 完了 ━━━');
log(`⏱ 経過: ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
fs.writeFileSync(path.join(SCRIPT_DIR, 'insert-stats.json'), JSON.stringify(stats, null, 2));
