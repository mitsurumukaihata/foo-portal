#!/usr/bin/env node
// 売上明細 を Excel から直接 SQL生成（Notion経由より遥かに高速）
// ただし 売上伝票ID (Notion page id) 紐付けが必要なので、既に取得した売上伝票.jsonを使う

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = path.join(SCRIPT_DIR, 'export');
const SQL_DIR = path.join(SCRIPT_DIR, 'sql');
if (!fs.existsSync(SQL_DIR)) fs.mkdirSync(SQL_DIR);

const BASE_DIR = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細';

const ALL_FILES = [
  '売上明細　2023.4-2023.6.xlsx', '売上明細　2023.7-2023.9.xlsx', '売上明細　2023.10-2023.12.xlsx',
  '売上明細　2024.1-2024.3.xlsx', '売上明細　2024.4-2025.3.xlsx',
  '売上明細　2025.4.xlsx', '売上明細　2025.5.xlsx', '売上明細　2025.6.xlsx',
  '売上明細　2025.7.xlsx', '売上明細　2025.8.xlsx', '売上明細　2025.9.xlsx',
  '売上明細　2025.10.xlsx', '売上明細　2025.11.xlsx', '売上明細　2025.12.xlsx',
  '売上明細　2026.1.xlsx', '売上明細　2026.2.xlsx', '売上明細　2026.3.xlsx',
];

// 半角カナ→全角カナ（簡略版）
function hankanaToZen(s) {
  if (!s) return '';
  return s.replace(/[\uff61-\uff9f]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0xFEE0));
}

function excelDateToISO(serial) {
  const n = typeof serial === 'number' ? serial : parseFloat(serial);
  if (!n || isNaN(n)) return null;
  const d = new Date((n - 25569) * 86400 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function mapHinmoku(code, name) {
  const c = (code||'').toUpperCase(), n = name||'';
  if (/廃タイヤ/.test(n)) return '廃タイヤ';
  if (/中古ホイール/.test(n)) return 'ホイール';
  if (/再生|更生/.test(n)) return 'タイヤ販売(更生)';
  if (/中古/.test(n)) return 'タイヤ販売(中古)';
  if (/Fバランス/.test(n)) return 'Fバランス';
  if (/^SH01/.test(c) || /市内出張/.test(n)) return '出張(市内)';
  if (/^SH02/.test(c) || /市外出張/.test(n)) return '出張(市外)';
  const wm = c.match(/^(LKL|LK|TK|PK|OR|TPPTK)(\d+)/);
  if (wm) { const num = wm[2]; if (num === '01') return '組替'; if (num === '02' || num === '05') return '脱着'; if (num === '03') return 'バランス'; }
  if (/組替/.test(n)) return '組替';
  if (/脱着/.test(n)) return '脱着';
  if (/バランス/.test(n)) return 'バランス';
  if (/^HT/.test(c)) return 'その他';
  if (/^FOO/.test(c)) return 'f.o.oパック';
  if (/^\d/.test(c)) return 'タイヤ販売(新品)';
  return 'その他';
}

function mapTax(s) {
  if (!s) return '課税(10%)';
  if (/10\.0%|10%|課税/.test(s)) return '課税(10%)';
  if (/8\.0%|8%|軽減/.test(s)) return '軽減税率(8%)';
  if (/非課税/.test(s)) return '非課税';
  return '課税(10%)';
}

function extractTireInfo(productName) {
  const n = hankanaToZen(productName || '');
  const sizeMatch = n.match(/(\d{2,3}(?:\/\d{2,3})?R\d{1,3}(?:\.\d)?)/);
  const size = sizeMatch ? sizeMatch[1] : '';
  const beforeSize = sizeMatch ? n.slice(0, sizeMatch.index).trim() : n;
  const brandMatch = beforeSize.match(/([MRWVGXDSP][A-Z0-9a-z]*\d+[a-zA-Z]*)/);
  return { size, brand: brandMatch ? brandMatch[1] : '' };
}

const CAR_RE = /([\u4e00-\u9fff\u3040-\u309f]{1,4}\s*\d{2,4}\s*[\u3040-\u309f]\s*\d{1,4}-\d{1,4})/g;
function extractCar(s) {
  if (!s) return '';
  const m = [...s.matchAll(CAR_RE)];
  return m[0] ? m[0][1].replace(/\s/g, '') : '';
}

// 売上伝票.json を読み込んで、弥生伝票番号+日付 → Notion page id のマップ作成
const slipsJson = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, '売上伝票.json'), 'utf-8'));
const slipKeyToId = new Map();
for (const p of slipsJson) {
  const bikou = p.properties['備考']?.rich_text?.map(t => t.plain_text).join('') || '';
  const date = p.properties['売上日']?.date?.start || '';
  const m = bikou.match(/弥生伝票(\d+)/);
  if (m && date) slipKeyToId.set(m[1] + '|' + date, p.id);
}
console.log('売上伝票マップ:', slipKeyToId.size);

// Excel から明細抽出
const details = [];
let skipNoSlip = 0;
for (const file of ALL_FILES) {
  const fp = path.join(BASE_DIR, file);
  if (!fs.existsSync(fp)) { console.log(`⚠️ ${file} なし`); continue; }
  const wb = XLSX.readFile(fp);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  let fileCount = 0;
  for (let i = 5; i < rows.length - 1; i++) {
    const row = rows[i];
    const denpyoNo = String(row[2] || '').trim();
    if (!denpyoNo) continue;
    const date = excelDateToISO(row[1]);
    if (!date) continue;
    const slipId = slipKeyToId.get(denpyoNo + '|' + date);
    if (!slipId) { skipNoSlip++; continue; }
    const shohinName = String(row[15] || '').trim();
    if (shohinName === '《消費税》') continue;
    const shohinCode = String(row[14] || '').trim();
    const tireInfo = extractTireInfo(shohinName);
    const hinmoku = mapHinmoku(shohinCode, shohinName);
    const taxKb = String(row[29] || '').trim();
    const taxName = mapTax(taxKb);
    const amt = parseFloat(row[25] || 0);
    const bikou = String(row[30] || '').trim();
    const qty = parseFloat(row[21] || 0);
    const price = parseFloat(row[23] || 0);
    const unit = String(row[16] || '').trim();
    const carNo = extractCar(bikou);

    // 税込小計の推定: 金額を税込とする（簡易）
    const rate = taxName === '課税(10%)' ? 0.1 : (taxName === '軽減税率(8%)' ? 0.08 : 0);
    const zeikomi = rate > 0 ? Math.round(amt * (1 + rate)) : amt;
    const zei = rate > 0 ? Math.round(amt * rate) : 0;

    // ID生成 (slipId + index)
    const detailId = slipId + '-' + fileCount;
    details.push({
      id: detailId,
      売上伝票ID: slipId,
      明細タイトル: `${hinmoku} ${tireInfo.size || ''} ${tireInfo.brand || ''}`.trim().slice(0,200),
      商品コード: shohinCode,
      品目: hinmoku,
      タイヤサイズ: tireInfo.size,
      タイヤ銘柄: tireInfo.brand,
      数量: qty,
      単位: unit,
      単価: price,
      税区分: taxName,
      税額: zei,
      税込小計: zeikomi,
      車番: carNo,
      備考: hankanaToZen(shohinName).slice(0, 200),
      弥生備考: bikou.slice(0, 200),
      created_time: date + 'T00:00:00.000Z',
      last_edited_time: date + 'T00:00:00.000Z',
    });
    fileCount++;
  }
  console.log(`  ${file}: ${fileCount}明細`);
}
console.log(`\n✅ 全明細: ${details.length} / ❓ 親伝票なし: ${skipNoSlip}`);

// ID重複除去
const seen = new Set();
const unique = details.filter(d => {
  if (seen.has(d.id)) return false;
  seen.add(d.id); return true;
});
console.log(`ユニーク: ${unique.length}`);

// SQL 生成
function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const cols = ['id','売上伝票ID','明細タイトル','商品コード','品目','タイヤサイズ','タイヤ銘柄','数量','単位','単価','税区分','税額','税込小計','車番','備考','弥生備考','created_time','last_edited_time'];
const colList = cols.map(c => `"${c}"`).join(', ');
const BATCH = 50;
const statements = [];
for (let i = 0; i < unique.length; i += BATCH) {
  const batch = unique.slice(i, i + BATCH);
  const values = batch.map(r => '(' + cols.map(c => esc(r[c])).join(', ') + ')').join(',\n  ');
  statements.push(`INSERT INTO "売上明細" (${colList}) VALUES\n  ${values};`);
}
const sql = statements.join('\n');
fs.writeFileSync(path.join(SQL_DIR, '売上明細.sql'), sql);
console.log(`→ 売上明細.sql (${Math.round(sql.length/1024)}KB, ${statements.length}チャンク)`);
