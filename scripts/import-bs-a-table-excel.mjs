#!/usr/bin/env node
/**
 * ブリヂストンA表Excel → D1 A表 テーブル インポート (v3)
 *
 * 使い方:
 *   node scripts/import-bs-a-table-excel.mjs <path-to-excel>
 *
 * 例: node scripts/import-bs-a-table-excel.mjs "../売上明細/タイヤメーカー価格表/★【YYYY年M月～verX.XX】夏タイヤ価格表_BRIDGESTONE.xlsx"
 *
 * 処理:
 *   1. "価格リスト" シート全行読み込み
 *   2. グループコード → D1カテゴリ (PSR*→PC, LT*/LSR*→LTS, LVR*→バン)
 *   3. PSR8/LTS8/LSR8/LVR8 は 旧モデルフラグ=1
 *   4. ブランドコード → ブランド名 (PO→POTENZA 等)
 *   5. パターン抽出 (商品名称からLI+サイズ+末尾ノイズ除去、TYPE派生保持)
 *   6. サイズの LT/P プレフィックス保持
 *   7. "A表" シートから ★②③④◇△□■*▼ マーク抽出
 *   8. BRIDGESTONE行を全削除→INSERT (冪等)
 *   9. wrangler経由でD1反映
 *
 * BS A表取り込みのクセ: scripts/A表取り込みメモ.md を参照
 */

import fs from 'node:fs';
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
  EX: 'EX', ZZ: 'COMMERCIAL', '00': 'COMMERCIAL', 'D:': ''
};
function groupToCat(g) {
  if (['PSR0','PSR1','PSR8'].includes(g)) return 'PC';
  if (['LTS0','LTS8','LSR0','LSR8'].includes(g)) return 'LTS';
  if (['LVR0','LVR8'].includes(g)) return 'バン';
  return null;
}
function isOldModel(g) { return g === 'PSR8' || g === 'LTS8' || g === 'LSR8' || g === 'LVR8'; }
function buildSize(sec, hen, inch, xl, name) {
  sec = String(sec).trim(); hen = String(hen).trim(); inch = String(inch).trim();
  if (!sec || !inch) return { size: '', prefix: '' };
  let prefix = '';
  if (/\bLT\s*\d{3}\/\d{1,3}/.test(name)) prefix = 'LT';
  else if (/\bP\s*\d{3}\/\d{1,3}/.test(name)) prefix = 'P';
  const base = (hen === '00' || hen === '0' || hen === '99' || !hen) ? sec + 'R' + inch : sec + '/' + hen + 'R' + inch;
  let size = (prefix ? prefix : '') + base;
  if (xl) size += ' XL';
  return { size, prefix };
}

function extractPatternRaw(nm, brandName) {
  let s = nm.replace(/\s+/g, ' ').trim();
  s = s.replace(/^\*?\*?[PD]?\d{2,3}[A-Z]{1,3}\s+/, '');
  s = s.replace(/^(\d{1,3}[A-Z]{1,3}T?)\s+/, '');
  s = s.replace(/^(LT|P)\s*/, '');
  const sizeRegs = [
    /\d{2,3}[xＸ]\d{3,4}\s*R?\s*\d{1,3}/i,
    /\d{3}\/\d{1,3}\s*F?Z?R?\s*\d{1,3}/,
    /\d{3,4}\s*[-–—]\s*\d{1,3}(?:LT)?\s*\d*\s*[A-Z]?/,
    /\d{3}\s*SR\s*\d{1,3}/,
    /\d{3}\s*R\s*\d{1,3}/,
  ];
  for (const re of sizeRegs) s = s.replace(re, ' ');
  s = s.replace(/\b(XL|XLPR|PR|RF|LLPR)\b/g, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (brandName && !s.toUpperCase().includes(brandName.toUpperCase().split(/\s/)[0])) {
    s = brandName + ' ' + s;
  }
  return s.trim();
}

const NOISE_TAIL = [
  'T 10','T 23','T 99','T ##','T#','T##','TUT','TUT##A5','TUT##M1','T##2D','T##2B','T##2C',
  'T','TL','D0','D099','D0EA','D0EABD','D0 EA','D0 99','D0YL','D0YH','D0 BD','D0NE','D0TEVE',
  'CE','EA','CEEA','CE EA','OE','BD','N0','A0','A5','M1','WN','MO','NE','ER','SQ','JK','EABD','EAJK',
  'STAR','1STAR','2STAR','3STAR',
  '23','99','10','11','23EL','23EV','23EAJK','23NE',
  'MGT','YQ','S60','PN','TM1','TA1','RFT','R9','R9TV','5TW1WC99','TC17ERP','BDN','B','C','F','R',
  'T D0','T D099','R STAR','T NO','D00Y','D0H1','T 40','T 41','T 47','T C','T B','T 05','T AO',
  'T OE','T ED','T OM','T WN','AO','OM','JK','ST','WNST','XXX5WNST','99D1','99ST','99SQ','999N','D099N'
];
function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function cleanPattern(p) {
  let s = p.trim().replace(/\s+/g, ' ');
  let changed = true, passes = 0;
  while (changed && passes < 30) {
    changed = false; passes++;
    if (/TYPE\s+[A-Z]{1,3}\s*$/i.test(s)) break;
    for (const tok of NOISE_TAIL) {
      const re = new RegExp('\\s+' + escRegex(tok) + '\\s*$', 'i');
      if (re.test(s)) { s = s.replace(re, '').trim(); changed = true; }
    }
  }
  return s;
}

function esc(s) { if (s === null || s === undefined) return 'NULL'; if (typeof s === 'number') return s; return "'" + String(s).replace(/'/g, "''") + "'"; }

const wb = XLSX.readFile(EXCEL_PATH);
console.log('読み込み:', EXCEL_PATH);

const kakakuSheet = wb.Sheets['価格リスト'];
if (!kakakuSheet) { console.error('価格リスト シートなし'); process.exit(1); }
const rows = XLSX.utils.sheet_to_json(kakakuSheet, { header: 1, defval: '' });

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
  const { size, prefix } = buildSize(r[7], r[8], r[9], xl, name);
  if (!size) continue;
  const patRaw = extractPatternRaw(name, brandName);
  const pattern = cleanPattern(patRaw) || brandName;
  const atable = r[21];
  const price = (atable && atable !== 0 && atable !== '') ? atable : null;
  parsed.push({ cat, group: g, code, brandCd, brand: brandName, pattern, size, prefix, name, rinc, price, oldModel: isOldModel(g) ? 1 : 0 });
}
console.log('有効行:', parsed.length);

const atSheet = wb.Sheets['A表'];
const atRows = atSheet ? XLSX.utils.sheet_to_json(atSheet, { header: 1, defval: '' }) : [];
const marks = {};
for (let i = 11; i < atRows.length; i++) {
  const r = atRows[i];
  for (let c = 1; c < r.length; c++) {
    const v = String(r[c] || '').trim();
    if (/^\d{8,15}$/.test(v)) {
      const raw = String(r[c-1] || '').trim();
      const m = raw.match(/[★②③④◇△□■*▼]+/);
      if (m) marks[v] = m[0];
    }
  }
}
console.log('マーク付き:', Object.keys(marks).length);

const BATCH = 200;
const batches = [];
for (let i = 0; i < parsed.length; i += BATCH) {
  const chunk = parsed.slice(i, i+BATCH);
  const vals = chunk.map(r => {
    const id = 'bs_' + r.code;
    return '(' + [
      esc(id), esc(r.cat), esc('BRIDGESTONE'),
      esc(r.pattern || r.brand || ''),
      esc(r.size), esc(''), esc(''),
      r.price !== null ? r.price : 'NULL',
      'NULL', esc(''), esc(marks[r.code] || ''),
      esc('2026-02-01'), esc(''),
      esc(new Date().toISOString()), esc(new Date().toISOString()),
      esc(r.code), esc(r.name), esc(r.rinc), esc(r.brandCd), esc('bs-a-table-v3'),
      r.oldModel, esc(r.prefix || '')
    ].join(',') + ')';
  }).join(',');
  batches.push(
    'INSERT INTO A表 (id,カテゴリ,メーカー,パターン,サイズ,加重指数,カテゴリ詳細,価格,短縮コード,備考,注意,最終更新日,notion_url,created_time,last_edited_time,商品コード,商品名称,rinc品名,brand_code,source,旧モデル,規格プレフィックス) VALUES ' + vals
  );
}

const fullSql = "DELETE FROM A表 WHERE メーカー = 'BRIDGESTONE';\n" + batches.join(';\n') + ';';
const tmpFile = './_bs_sync_tmp.sql';
fs.writeFileSync(tmpFile, fullSql);
console.log('SQL:', (fs.statSync(tmpFile).size/1024).toFixed(1), 'KB');
console.log('wrangler 実行中...');
execSync(`npx wrangler d1 execute foo-portal-db --remote --file=${tmpFile}`, {
  cwd: './cloudflare-worker',
  stdio: 'inherit',
});
fs.unlinkSync(tmpFile);
console.log('✅ 完了:', parsed.length, '行');
