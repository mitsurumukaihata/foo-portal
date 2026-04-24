#!/usr/bin/env node
/**
 * ブリヂストンA表Excel → D1 A表 テーブル インポート
 *
 * 使い方:
 *   node scripts/import-bs-a-table-excel.mjs <path-to-excel>
 *
 * 例: node scripts/import-bs-a-table-excel.mjs "../売上明細/タイヤメーカー価格表/★【2026年2月～ver2.00】夏タイヤ価格表_BRIDGESTONE.xlsx"
 *
 * 処理:
 *   1. Excel "価格リスト" シート全行を読み込み (4400行程度)
 *   2. グループ名→カテゴリ(PC/LTS/バン)にマッピング
 *   3. ブランドコード→ブランド名に翻訳
 *   4. 商品名称から パターン抽出 (サイズ・LI・末尾コード除去)
 *   5. "A表" シートから ★②③◇△ マーク抽出
 *   6. 既存 BRIDGESTONE 行を DELETE → 新データを INSERT
 *   7. wrangler 経由で D1 に反映 (INSERT 200行/バッチ)
 *
 * 想定されるA表の分類記号:
 *   ★ = BS認定 (BMW/Mercedes等の承認タイヤ)
 *   ②③④ = 発売月 (2月/3月/4月)
 *   ◇ = 4リブ
 *   △ = 3リブ
 *   □ / ■ = 特殊規格
 *
 * 重要: 冪等でないため、BRIDGESTONE行は毎回全削除→再投入する。
 *       DUNLOP/TOYO/YOKOHAMA 行は触らない。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import XLSX from 'xlsx';

const EXCEL_PATH = process.argv[2];
if (!EXCEL_PATH) { console.error('Excelパスを指定してください'); process.exit(1); }
if (!fs.existsSync(EXCEL_PATH)) { console.error('ファイルが見つかりません:', EXCEL_PATH); process.exit(1); }

const BRAND_MAP = {
  PO: 'POTENZA', EP: 'ECOPIA', RE: 'REGNO', DU: 'DUELER',
  AZ: 'ALENZA', PZ: 'Playz', NE: 'NEXTRY', NW: 'NEWNO',
  SK: 'SNEAKER', SL: 'SEIBERLING', FN: 'FINESSA', FS: 'FIRESTONE',
  SF: 'SEIBERLING', TP: 'TOPRUN', BS: 'BS',
  MU: 'MULTI WEATHER', DG: 'DRIVEGUARD', GR: 'GR',
  EX: 'EX', ZZ: '', '00': '', 'D:': ''
};
function groupToCat(g) {
  if (['PSR0','PSR1','PSR8'].includes(g)) return 'PC';
  if (['LTS0','LTS8','LSR0','LSR8'].includes(g)) return 'LTS';
  if (['LVR0','LVR8'].includes(g)) return 'バン';
  return null;
}
function buildSize(sec, hen, inch, xl) {
  sec = String(sec).trim(); hen = String(hen).trim(); inch = String(inch).trim();
  if (!sec || !inch) return '';
  const base = (hen === '00' || hen === '0' || !hen) ? sec + 'R' + inch : sec + '/' + hen + 'R' + inch;
  return xl ? base + ' XL' : base;
}
function extractPattern(nm) {
  let s = nm.replace(/\s+/g, ' ').trim();
  s = s.replace(/^\*?\d{2,3}[A-Z]{1,3}\s*/, '');
  s = s.replace(/^\*?[\dA-Z]{1,3}MT?\s*/, '');
  s = s.replace(/^P\s+/, '');
  s = s.replace(/\d{2,3}[XxＸ]\d{3,4}\s*R?\s*\d{1,3}/, '');
  s = s.replace(/LT?\d{3}\/\d{1,3}\s*R\s*\d{1,3}(?:LT)?/, '');
  s = s.replace(/\d{3}\/\d{1,3}\s*F?Z?R?\s*\d{1,3}/, '');
  s = s.replace(/\d{3,4}\s*[-–—]\s*\d{1,3}(?:LT)?\s*\d*/, '');
  s = s.replace(/\d{3,4}\s*SR\s*\d{1,3}/, '');
  s = s.replace(/\d{3}\s*R\s*\d{1,3}/, '');
  s = s.replace(/\b(XL|XLPR|PR|RF)\b/g, '');
  s = s.replace(/\s+(T|TL|0WT|RBT|RWT)\s+/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

function esc(s) { if (s === null || s === undefined) return 'NULL'; if (typeof s === 'number') return s; return "'" + String(s).replace(/'/g, "''") + "'"; }

const wb = XLSX.readFile(EXCEL_PATH);
console.log('Reading:', EXCEL_PATH);

// 1. 価格リスト シート
const kakakuSheet = wb.Sheets['価格リスト'];
if (!kakakuSheet) { console.error('価格リスト シートが見つかりません'); process.exit(1); }
const rows = XLSX.utils.sheet_to_json(kakakuSheet, { header: 1, defval: '' });
console.log('価格リスト 行数:', rows.length);

const parsed = [];
for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  const g = String(r[1]||'').trim();
  const cat = groupToCat(g);
  if (!cat) continue;
  const code = String(r[2]||'').trim();
  const name = String(r[4]||'').trim();
  const rinc = String(r[6]||'').trim();
  const xl = String(r[10]||'').trim() === 'XL';
  const brandCd = String(r[11]||'').trim();
  const brandName = BRAND_MAP[brandCd] !== undefined ? BRAND_MAP[brandCd] : brandCd;
  const size = buildSize(r[7], r[8], r[9], xl);
  if (!size) continue;
  const pattern = extractPattern(name) || brandName;
  const atable = r[21];
  const price = (atable && atable !== 0 && atable !== '') ? atable : null;
  parsed.push({ cat, group: g, code, brandCd, brand: brandName, pattern, size, name, rinc, price });
}
console.log('有効な行:', parsed.length);

// 2. A表 シートから マーク抽出
const atSheet = wb.Sheets['A表'];
const atRows = atSheet ? XLSX.utils.sheet_to_json(atSheet, { header: 1, defval: '' }) : [];
const marks = {};
for (let i = 11; i < atRows.length; i++) {
  const r = atRows[i];
  for (let c = 1; c < r.length; c++) {
    const v = String(r[c] || '').trim();
    if (/^\d{8,15}$/.test(v)) {
      const raw = String(r[c-1] || '').trim();
      const m = raw.match(/[★②③④◇△□■]+/);
      if (m) marks[v] = m[0];
    }
  }
}
console.log('マーク付き商品:', Object.keys(marks).length);

// 3. SQL 生成
const insertBatches = [];
const BATCH = 200;
for (let i = 0; i < parsed.length; i += BATCH) {
  const chunk = parsed.slice(i, i+BATCH);
  const vals = chunk.map(r => {
    const id = 'bs_' + r.code;
    const note = marks[r.code] || '';
    return '(' + [
      esc(id), esc(r.cat), esc('BRIDGESTONE'),
      esc(r.pattern || r.brand || ''),
      esc(r.size), esc(''), esc(''),
      r.price !== null ? r.price : 'NULL',
      'NULL', esc(''), esc(note),
      esc('2026-02-01'), esc(''),
      esc(new Date().toISOString()), esc(new Date().toISOString()),
      esc(r.code), esc(r.name), esc(r.rinc), esc(r.brandCd), esc('bs-a-table-excel')
    ].join(',') + ')';
  }).join(',');
  insertBatches.push(
    'INSERT INTO A表 (id,カテゴリ,メーカー,パターン,サイズ,加重指数,カテゴリ詳細,価格,短縮コード,備考,注意,最終更新日,notion_url,created_time,last_edited_time,商品コード,商品名称,rinc品名,brand_code,source) VALUES ' + vals
  );
}

const deleteStmt = "DELETE FROM A表 WHERE メーカー = 'BRIDGESTONE'";
const fullSql = [deleteStmt, ...insertBatches].join(';\n') + ';';

const tmpFile = './_bs_sync_tmp.sql';
fs.writeFileSync(tmpFile, fullSql);
console.log('Generated SQL:', (fs.statSync(tmpFile).size / 1024).toFixed(1), 'KB');
console.log('Executing wrangler...');
execSync(`npx wrangler d1 execute foo-portal-db --remote --file=${tmpFile}`, {
  cwd: './cloudflare-worker',
  stdio: 'inherit',
});
fs.unlinkSync(tmpFile);
console.log('✅ 完了:', parsed.length, '行をBS行として反映');
