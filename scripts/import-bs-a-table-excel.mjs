#!/usr/bin/env node
/**
 * ブリヂストンA表Excel → D1 A表 テーブル インポート (v5)
 *
 * 使い方:
 *   node scripts/import-bs-a-table-excel.mjs <path-to-excel>
 *
 * 処理の要点 (v5):
 *   1. "A表" シートの ブランド行(row 9)・パターン行(row 10) を読み、
 *      セル結合を forward-fill で展開して「列→(ブランド,パターン)」写像を作る
 *   2. "A表" シートの全商品コードを走査し、所属ブランド/パターンを取得
 *   3. マーク(★②③④◇△□■*▼) も同時抽出
 *   4. "価格リスト" シートから 「A表掲載商品コード」 に一致する商品のみパース
 *   5. 価格・サイズ・LT/Pプレフィックス・旧モデルフラグを付与
 *   6. BRIDGESTONE行を全削除 → INSERT (冪等)
 *
 * 取り込まれるもの (2026/2 ver2.00 時点):
 *   PC: 730行 / LTS: 65行 / バン: 104行 / 合計 899行
 *
 * BS A表取り込みのクセ: scripts/A表取り込みメモ.md を参照
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import XLSX from 'xlsx';

const EXCEL_PATH = process.argv[2];
if (!EXCEL_PATH) { console.error('Excelパスを指定してください'); process.exit(1); }
if (!fs.existsSync(EXCEL_PATH)) { console.error('ファイルが見つかりません:', EXCEL_PATH); process.exit(1); }

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
  // 商品名から R155/R175 等の半インチ(.5)表記を検出してインチに補正
  const nameMatch = String(name).match(/\bR(\d{2,3})(?:LT)?\b/);
  if (nameMatch) {
    const rNum = nameMatch[1];
    if (rNum.length === 3 && rNum.endsWith('5')) {
      inch = rNum.substring(0, 2) + '.5';
    }
  }
  // BS バイアスプライ商用トラックサイズ表記揺れ補正
  // BS: "600R15" / 他メーカー: "6.00R15" → 他メーカーに合わせる
  // sec が「4-9始まりの3桁」かつ hen が "00" ならバイアス表記に変換
  let secDisplay = sec;
  if (/^[4-9]\d0$/.test(sec) && (hen === '00' || hen === '0' || !hen || hen === '99')) {
    // 600 → 6.00, 650 → 6.50, 700 → 7.00, 750 → 7.50
    secDisplay = sec[0] + '.' + sec.slice(1);
  }
  const base = (hen === '00' || hen === '0' || hen === '99' || !hen) ? secDisplay + 'R' + inch : secDisplay + '/' + hen + 'R' + inch;
  let size = (prefix ? prefix : '') + base;
  if (xl) size += ' XL';
  return { size, prefix };
}
function esc(s) { if (s === null || s === undefined) return 'NULL'; if (typeof s === 'number') return s; return "'" + String(s).replace(/'/g, "''") + "'"; }

const wb = XLSX.readFile(EXCEL_PATH);
console.log('読み込み:', EXCEL_PATH);

// === Step 1: A表シートから (code → brand, pattern, mark) 辞書を構築 ===
const atSheet = wb.Sheets['A表'];
if (!atSheet) { console.error('A表 シートなし'); process.exit(1); }
const atRows = XLSX.utils.sheet_to_json(atSheet, { header: 1, defval: '' });

// Row 9(idx 8)=ブランド、Row 10(idx 9)=パターン(上部セクション用)
const brandRow = atRows[8] || [];
const patternRow = atRows[9] || [];
const maxCols = Math.max(brandRow.length, patternRow.length);

// 上部セクション用 colInfo
let curBrand = '', curPattern = '';
const topColInfo = {};
for (let c = 0; c < maxCols; c++) {
  if (brandRow[c] && String(brandRow[c]).trim()) curBrand = String(brandRow[c]).trim();
  if (patternRow[c] && String(patternRow[c]).trim()) curPattern = String(patternRow[c]).trim();
  topColInfo[c] = { brand: curBrand, pattern: curPattern };
}

// セクションヘッダー("FOR XXX")を検出し、LIGHTTRACK等の下部セクションを特定
// 下部セクションは独自のブランド/パターン行を持つ
const sections = []; // [{startRow, minCol, brandPatternRow, ...}]
for (let i = 0; i < atRows.length; i++) {
  for (let c = 0; c < atRows[i].length; c++) {
    const v = String(atRows[i][c]||'').trim();
    if (/^FOR\s+LIGHTTRACK/i.test(v)) {
      // LIGHTTRACK セクションの開始: brand+pattern は1行下、sub-headerは3行下、dataは4行下〜
      sections.push({
        name: 'LIGHTTRACK',
        startRow: i,      // "FOR LIGHTTRACK" の行
        headerRow: i + 1, // brand+pattern combined
        dataStartRow: i + 4, // data start (sub-header row + 1)
        minCol: c         // LIGHTTRACK コラムの開始位置
      });
    }
  }
}

// LIGHTTRACK セクション用 colInfo (combined brand+pattern row)
function buildLtColInfo(sec) {
  const hdr = atRows[sec.headerRow] || [];
  const info = {};
  let curBP = '';
  for (let c = sec.minCol; c < hdr.length; c++) {
    const v = hdr[c] && String(hdr[c]).trim();
    if (v) curBP = v;
    info[c] = curBP; // 例: "ECOPIA R214/R201", "DURAVIS M807/M810"
  }
  return info;
}
const ltSections = sections.map(sec => ({ ...sec, bpInfo: buildLtColInfo(sec) }));
console.log('検出した下部セクション:', ltSections.map(s => `${s.name}@row${s.startRow+1}col${s.minCol}`).join(', '));

// LIGHTTRACK の brand+pattern 結合文字列を ブランド/パターン に分割
// パターン: 先頭ワードがブランド名(ECOPIA/DURAVIS/REGNO等)ならそれ、残りがパターン
const KNOWN_BRANDS = ['ECOPIA','DURAVIS','REGNO','POTENZA','ALENZA','DUELER','Playz','NEXTRY','NEWNO','SEIBER LING','SEIBERLING','FINESSA','TOPRUN','LUFT RVⅡ','LUFT RV','MULTI WEATHER'];
function splitBP(combined) {
  if (!combined) return { brand: '', pattern: '' };
  for (const b of KNOWN_BRANDS) {
    if (combined.startsWith(b + ' ')) return { brand: b, pattern: combined.slice(b.length).trim() };
    if (combined === b) return { brand: b, pattern: b };
  }
  // 先頭が英大文字なら全体をパターンとして扱う(ブランド不明)
  return { brand: '', pattern: combined };
}

// データ行走査: 商品コード → (brand, pattern, mark)
// セクション判定: 行・列が LIGHTTRACK 範囲なら LIGHTTRACK 用 colInfo、そうでなければ top colInfo
const codeInfo = {};
for (let i = 11; i < atRows.length; i++) {
  const r = atRows[i];
  for (let c = 0; c < r.length; c++) {
    const v = String(r[c] || '').trim();
    if (/^\d{8,15}$/.test(v)) {
      // どのセクションか判定
      let bp = null;
      for (const sec of ltSections) {
        if (i >= sec.dataStartRow && c >= sec.minCol && sec.bpInfo[c]) {
          bp = splitBP(sec.bpInfo[c]);
          break;
        }
      }
      if (!bp) {
        const info = topColInfo[c] || {};
        bp = { brand: info.brand || '', pattern: info.pattern || '' };
      }
      const raw = c > 0 ? String(r[c-1] || '').trim() : '';
      const m = raw.match(/[★②③④◇△□■*▼]+/);
      codeInfo[v] = { brand: bp.brand, pattern: bp.pattern, mark: m ? m[0] : '' };
    }
  }
}
console.log('A表掲載コード:', Object.keys(codeInfo).length);

// === Step 2: 価格リストを掲載コードに絞ってパース ===
const kakakuSheet = wb.Sheets['価格リスト'];
if (!kakakuSheet) { console.error('価格リスト シートなし'); process.exit(1); }
const rows = XLSX.utils.sheet_to_json(kakakuSheet, { header: 1, defval: '' });

const parsed = [];
for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  const code = String(r[2]||'').trim();
  if (!code || !codeInfo[code]) continue;
  const g = String(r[1]||'').trim();
  const cat = groupToCat(g);
  if (!cat) continue;
  const name = String(r[4]||'').trim();
  const rinc = String(r[6]||'').trim();
  const xl = String(r[10]||'').trim() === 'XL';
  const brandCd = String(r[11]||'').trim();
  const { size, prefix } = buildSize(r[7], r[8], r[9], xl, name);
  if (!size) continue;
  const atable = r[21];
  const price = (atable && atable !== 0 && atable !== '') ? atable : null;
  const info = codeInfo[code];
  parsed.push({
    cat, group: g, code, brandCd,
    brand: info.brand,       // ← A表シートから拾ったクリーンなブランド名
    pattern: info.pattern,   // ← A表シートから拾ったクリーンなパターン名
    mark: info.mark,
    size, prefix, name, rinc, price,
    oldModel: isOldModel(g) ? 1 : 0
  });
}
console.log('取り込み候補:', parsed.length);

// === Step 3: SQL生成 & 実行 ===
const BATCH = 200;
const batches = [];
for (let i = 0; i < parsed.length; i += BATCH) {
  const chunk = parsed.slice(i, i+BATCH);
  const vals = chunk.map(r => {
    return '(' + [
      esc('bs_' + r.code), esc(r.cat), esc('BRIDGESTONE'),
      esc(r.pattern || ''),
      esc(r.size), esc(''), esc(''),
      r.price !== null ? r.price : 'NULL',
      'NULL', esc(''), esc(r.mark || ''),
      esc('2026-02-01'), esc(''),
      esc(new Date().toISOString()), esc(new Date().toISOString()),
      esc(r.code), esc(r.name), esc(r.rinc), esc(r.brandCd), esc('bs-a-table-v5'),
      r.oldModel, esc(r.prefix || ''), esc(r.brand || '')
    ].join(',') + ')';
  }).join(',');
  batches.push(
    'INSERT INTO A表 (id,カテゴリ,メーカー,パターン,サイズ,加重指数,カテゴリ詳細,価格,短縮コード,備考,注意,最終更新日,notion_url,created_time,last_edited_time,商品コード,商品名称,rinc品名,brand_code,source,旧モデル,規格プレフィックス,ブランド) VALUES ' + vals
  );
}

const fullSql = "DELETE FROM A表 WHERE メーカー = 'BRIDGESTONE';\n" + batches.join(';\n') + ';';
const tmpFile = './cloudflare-worker/_bs_sync_tmp.sql';
fs.writeFileSync(tmpFile, fullSql);
console.log('SQL:', (fs.statSync(tmpFile).size/1024).toFixed(1), 'KB');
console.log('wrangler 実行中...');
execSync(`npx wrangler d1 execute foo-portal-db --remote --file=_bs_sync_tmp.sql`, {
  cwd: './cloudflare-worker',
  stdio: 'inherit',
});
fs.unlinkSync(tmpFile);
console.log('✅ 完了:', parsed.length, '行');
