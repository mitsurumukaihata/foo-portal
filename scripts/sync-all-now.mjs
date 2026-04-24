#!/usr/bin/env node
/**
 * 全A表関連同期を一発実行
 *
 * 使い方:
 *   node scripts/sync-all-now.mjs
 *
 * 実行内容:
 *   1. Notion → D1 A表 差分同期 (PC/LTS/バン)
 *   2. a-table-maintenance.sql 実行 (サイズマスタ再構築、不整合検出、商品マスタ同期)
 *
 * エラー時は途中で止まる。各ステップの結果は stdout に表示。
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

console.log('\n=== 🔄 A表関連 全同期開始 ' + new Date().toISOString() + ' ===\n');

// Step 1: Notion → D1 差分同期
console.log('📥 [1/2] Notion → D1 A表 差分同期 ...');
execSync('node scripts/sync-a-table-from-notion.mjs', { cwd: ROOT, stdio: 'inherit' });

// Step 2: メンテSQL実行
console.log('\n🛠  [2/2] a-table-maintenance.sql 実行 ...');
execSync('npx wrangler d1 execute foo-portal-db --remote --file=../scripts/a-table-maintenance.sql', {
  cwd: path.join(ROOT, 'cloudflare-worker'),
  stdio: 'inherit',
});

console.log('\n✅ 全同期完了 ' + new Date().toISOString());
