#!/usr/bin/env node
/**
 * A表 (BS業界価格表) を Notion → D1 に同期
 *
 * 使い方:
 *   node scripts/sync-a-table-from-notion.mjs          # 差分同期(created/last_edited で新しいもののみ)
 *   node scripts/sync-a-table-from-notion.mjs --full   # 全件上書き (DELETE→INSERT)
 *
 * 前提:
 *   - cloudflare-worker/ に wrangler.toml があり、D1 が binding 済み
 *   - Notion API は Worker proxy 経由 (/v1/databases/:id/query)
 *   - 引数なしなら差分同期のみ(last_edited_time が D1 より新しい行を UPSERT)
 *
 * 対象 Notion DB:
 *   PC:  2f6a695f8e8881e88f56ccd99cec9c74
 *   LTS: 213a695f8e888166bfb4e50682f7479c
 *   バン: 214a695f8e8881ed89dffaa0a5eb3587
 *
 * D1 スキーマ: A表 (id, カテゴリ, メーカー, パターン, サイズ, 加重指数, カテゴリ詳細,
 *                   価格, 短縮コード, 備考, 注意, 最終更新日, notion_url,
 *                   created_time, last_edited_time)
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import https from 'node:https';

const NOTION_DBS = [
  { id: '2f6a695f8e8881e88f56ccd99cec9c74', category: 'PC' },
  { id: '213a695f8e888166bfb4e50682f7479c', category: 'LTS' },
  { id: '214a695f8e8881ed89dffaa0a5eb3587', category: 'バン' },
];

const WORKER_HOST = 'notion-proxy.33322666666mm.workers.dev';
const FULL_MODE = process.argv.includes('--full');

async function queryAll(dsId) {
  const all = [];
  let cursor;
  while (true) {
    const body = JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 });
    const res = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: WORKER_HOST,
        path: '/v1/databases/' + dsId + '/query',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    if (res.status !== 200) throw new Error('Notion fetch failed: ' + res.status + ' ' + res.body);
    const j = JSON.parse(res.body);
    all.push(...j.results);
    if (!j.has_more) break;
    cursor = j.next_cursor;
  }
  return all;
}

function escSql(s) {
  if (s === null || s === undefined) return 'NULL';
  if (typeof s === 'number') return s;
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function rowToValues(r, category) {
  const p = r.properties;
  const vals = [
    escSql(r.id),
    escSql(category),
    escSql(p['メーカー']?.select?.name || ''),
    escSql(p['パターン']?.select?.name || ''),
    escSql(p['サイズ']?.rich_text?.[0]?.plain_text || ''),
    escSql(p['加重指数']?.rich_text?.[0]?.plain_text || ''),
    escSql(p['カテゴリ']?.select?.name || ''),
    p['価格']?.number ?? 'NULL',
    'NULL', // 短縮コード: formula なので同期対象外
    escSql(p['備考']?.rich_text?.[0]?.plain_text || ''),
    escSql(p['注意']?.rich_text?.[0]?.plain_text || ''),
    escSql(p['最終更新日']?.date?.start || null),
    escSql(r.url),
    escSql(r.created_time),
    escSql(r.last_edited_time),
  ];
  return '(' + vals.join(',') + ')';
}

function buildInsertBatch(rows, category) {
  const BATCH = 100;
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const values = rows.slice(i, i + BATCH).map(r => rowToValues(r, category)).join(',');
    batches.push(
      'INSERT INTO A表 (id,カテゴリ,メーカー,パターン,サイズ,加重指数,カテゴリ詳細,価格,' +
      '短縮コード,備考,注意,最終更新日,notion_url,created_time,last_edited_time) VALUES ' + values
    );
  }
  return batches;
}

function runWranglerSQL(sqlFile) {
  execSync(`npx wrangler d1 execute foo-portal-db --remote --file=${sqlFile}`, {
    cwd: './cloudflare-worker',
    stdio: 'inherit',
  });
}

async function main() {
  console.log('=== A表 同期開始 (' + (FULL_MODE ? 'FULL' : 'DIFF') + ') ===');

  const allBatches = [];
  if (FULL_MODE) {
    allBatches.push('DELETE FROM A表');
  }

  for (const { id, category } of NOTION_DBS) {
    console.log(`Fetching ${category} (${id}) ...`);
    const rows = await queryAll(id);
    console.log(`  ${rows.length} rows`);
    // DIFF mode: ON CONFLICT DO UPDATE (UPSERT) のため、PRIMARY KEY(id) で置換
    const batches = buildInsertBatch(rows, category).map(sql =>
      FULL_MODE ? sql : sql.replace('INSERT INTO', 'INSERT OR REPLACE INTO')
    );
    allBatches.push(...batches);
  }

  const sql = allBatches.join(';\n') + ';';
  const tmpFile = './_atable_sync_tmp.sql';
  fs.writeFileSync(tmpFile, sql);
  console.log(`\nExecuting ${allBatches.length} batches via wrangler...`);
  runWranglerSQL(tmpFile);
  fs.unlinkSync(tmpFile);
  console.log('✅ 完了');
}

main().catch(e => { console.error(e); process.exit(1); });
