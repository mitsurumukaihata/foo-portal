#!/usr/bin/env node
// 150社分のタイヤ管理表(Excel)をユニバーサルにパースして車両マスタJSONを出力
// active-customers.json と突き合わせて「有効」顧客のみ対象にする

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const BASE = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/顧客管理/顧客管理';
const SCRIPT_DIR = path.dirname(decodeURI(new URL(import.meta.url).pathname.replace(/^\//, '')));

function normalize(s) {
  return (s || '').replace(/(有限会社|株式会社|\(株\)|\(有\)|㈱|㈲|（株）|（有）|\s|　|・|-|ー|（|）|\(|\))/g, '').toLowerCase();
}

// 正規表現パターン
const REG_SIZE = /\d{3}\/\d{2}R\d+(?:\.\d)?/g;
// 車番の地域部分（広島/福山/岡山/山口/下関/香川/愛媛/島根/鳥取/大阪/兵庫/神戸/京都/奈良/和歌山/徳島/高知/松山）
const CAR_REGIONS = ['広島','福山','岡山','山口','下関','香川','愛媛','松山','島根','鳥取','大阪','兵庫','神戸','京都','奈良','和歌山','徳島','高知','習志野','品川','練馬','足立','横浜','川崎','湘南','相模','千葉','袖ヶ浦','水戸','土浦','宇都宮','前橋','高崎','熊谷','大宮','春日部','所沢','川越','野田','柏','成田','山梨','富士山','長野','松本','諏訪','新潟','長岡','富山','金沢','福井','名古屋','尾張','豊橋','豊田','三河','岐阜','飛騨','静岡','浜松','沼津','三重','鈴鹿','滋賀','神戸','姫路','奈良','和歌山','徳島','香川','愛媛','高知','福岡','北九州','筑豊','久留米','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄','札幌','函館','旭川','室蘭','釧路','帯広','北見','青森','八戸','岩手','盛岡','宮城','仙台','秋田','山形','福島','会津','郡山','いわき'];
const CAR_PATTERN = new RegExp('(?:' + CAR_REGIONS.join('|') + ')\\s*\\d{2,3}\\s*[あ-んア-ン]{0,2}\\s*\\d{2,3}[-ー‐\\s]?\\d{2,3}');
const CAR_LAST4 = /^\d{2,3}[-ー‐]?\d{2,3}$/;
const MGMT_NO = /^\d{3,5}$/; // 3-5桁数字

function extractSizes(str) {
  if (!str || typeof str !== 'string') return [];
  return (str.match(REG_SIZE) || []);
}

function looksLikeCarNo(s) {
  if (!s) return false;
  const str = String(s).trim();
  return CAR_PATTERN.test(str) || CAR_LAST4.test(str);
}
function looksLikeMgmtNo(s) {
  if (!s) return false;
  const str = String(s).trim();
  return /^\d{3,5}$/.test(str);
}

// 1ファイル 1シート をパース → 車両配列
function parseSheet(rows, ctx) {
  const vehicles = [];
  // カラムインデックスを見つける: "タイヤサイズ" "F左" "本数" "作業日" "備考" 等
  let headerIdx = -1, colSize = -1, colQty = -1, colFL = -1, colMemo = -1, colDate = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i] || [];
    for (let c = 0; c < r.length; c++) {
      const v = String(r[c] || '').replace(/\s/g, '');
      if (v === 'タイヤサイズ') { colSize = c; headerIdx = i; }
      else if (v === '本数') colQty = c;
      else if (v === 'F左' || v === 'F  左') colFL = c;
      else if (v === '備考' || v === '備    考') colMemo = c;
      else if (v === '作業日') colDate = c;
    }
    if (headerIdx !== -1) break;
  }
  if (headerIdx === -1) return vehicles;

  let current = null;
  let rrRows = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    // No列(0), 管理番号列(1 or 2), 車番列(2 or null), Fr/Rr列 は後の列, サイズ列 は colSize
    // 共通パターン: colA=通番, colB=管理番号 or 地域, colC=車番番号 or Fr/Rr, colD=Fr/Rr or サイズ
    // 複数バリエーションに対応

    // 新しい車両行を検出: Fr かつサイズあり
    let isFrRow = false;
    for (let c = 0; c < Math.min(colSize + 1, r.length); c++) {
      if (r[c] === 'Fr') { isFrRow = true; break; }
    }
    const sizeCell = r[colSize];
    const qty = Number(r[colQty]) || 0;

    if (isFrRow) {
      if (current) vehicles.push(current);
      // 車番/管理番号を周辺セルから探す
      let carNo = '', mgmtNo = '';
      // 管理番号（colB または colBC）
      for (let c = 0; c <= 3; c++) {
        const v = r[c];
        if (!v) continue;
        const vs = String(v).trim();
        if (looksLikeMgmtNo(vs) && !mgmtNo) mgmtNo = vs;
        else if (looksLikeCarNo(vs) && !carNo) carNo = vs;
      }
      // 地域+番号の組み立て(例: B="広島100せ" C="34-15" → 広島100せ34-15)
      if (!carNo && r[1] && typeof r[1] === 'string' && /^(?:広島|福山|岡山|山口|下関|[一-龠]{2,})/.test(r[1])) {
        if (r[2] && typeof r[2] === 'string' && CAR_LAST4.test(String(r[2]).trim())) {
          carNo = (r[1] + r[2]).trim();
        } else if (r[2] && typeof r[2] === 'number') {
          // 数字だけのケース
          carNo = (r[1] + '-' + r[2]).trim();
        }
      }
      const sizes = extractSizes(String(sizeCell || ''));
      current = {
        mgmtNo: mgmtNo || '',
        carNo: carNo || '',
        frSize: sizes[0] || (typeof sizeCell === 'string' ? sizeCell.trim() : ''),
        frQty: qty,
        rrSize: sizes[1] || '',
        rrQty: 0,
        rrAxles: 0,
        axleCount: 1,
        memo: String(r[colMemo] || '').trim(),
        sourceSheet: ctx.sheetName,
        sourceRow: i + 1,
      };
      rrRows = 0;
    } else {
      // Rr 行の検出
      let isRrRow = false;
      for (let c = 0; c < Math.min(colSize + 1, r.length); c++) {
        if (r[c] === 'Rr') { isRrRow = true; break; }
      }
      if (isRrRow && current) {
        rrRows++;
        current.rrAxles = rrRows;
        current.axleCount = 1 + rrRows;
        if (sizeCell && typeof sizeCell === 'string') {
          const sm = sizeCell.match(REG_SIZE);
          if (sm && sm.length && !current.rrSize) current.rrSize = sm[0];
        }
        if (qty) current.rrQty += qty;
      }
    }
  }
  if (current) vehicles.push(current);
  return vehicles;
}

function parseFile(filePath) {
  const wb = XLSX.readFile(filePath);
  // 最新年度シート優先
  const sheetOrder = ['2026', '2025 (2)', '2025', '2024 (3)', '2024 (2)', '2024', '2023冬', '2023春', '2022冬', '2022春'];
  const primary = sheetOrder.find(n => wb.SheetNames.includes(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[primary], { header: 1, defval: null });
  const ctx = { sheetName: primary };
  let vehicles = parseSheet(rows, ctx);

  // サイズ空の場合、旧シートから補完
  const needFill = vehicles.filter(v => v.mgmtNo && (!v.frSize || !v.rrSize));
  if (needFill.length > 0) {
    for (const sn of sheetOrder) {
      if (sn === primary || !wb.SheetNames.includes(sn)) continue;
      const oldRows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null });
      const oldVehicles = parseSheet(oldRows, { sheetName: sn });
      for (const v of vehicles) {
        if (v.frSize && v.rrSize) continue;
        const match = oldVehicles.find(o => (v.mgmtNo && o.mgmtNo === v.mgmtNo) || (v.carNo && o.carNo === v.carNo));
        if (!match) continue;
        if (!v.frSize && match.frSize) v.frSize = match.frSize;
        if (!v.rrSize && match.rrSize) v.rrSize = match.rrSize;
      }
      if (!vehicles.some(v => !v.frSize || !v.rrSize)) break;
    }
  }
  return { primary, vehicles };
}

// ファイル名から顧客名を推定: 末尾の "(1)" 等を除去し、".xlsx" 削除
function fileToCustomerName(filename) {
  return filename.replace(/\s*\(\d+\)\s*$/, '').replace(/\.xlsx?$/i, '').replace(/　/g, ' ').trim();
}

// ========== 実行 ==========
const activeCustomers = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'active-customers.json'), 'utf-8'));
const byNorm = activeCustomers.byNorm;

const groups = fs.readdirSync(BASE).filter(f => fs.statSync(path.join(BASE, f)).isDirectory());
const allVehicles = [];
const stats = { totalFiles: 0, matchedFiles: 0, unmatchedFiles: 0, totalVehicles: 0, matchedVehicles: 0 };
const unmatched = [];

for (const group of groups) {
  const groupDir = path.join(BASE, group);
  const files = fs.readdirSync(groupDir).filter(f => /\.xlsx?$/i.test(f) && !f.startsWith('~$'));
  for (const f of files) {
    stats.totalFiles++;
    const custName = fileToCustomerName(f);
    const norm = normalize(custName);
    const customerMatch = byNorm[norm];

    let matched = !!customerMatch;
    // 部分一致フォールバック
    if (!matched) {
      for (const [k, v] of Object.entries(byNorm)) {
        if (k.length > 3 && (norm.includes(k) || k.includes(norm))) { matched = true; break; }
      }
    }

    if (!matched) {
      unmatched.push({ file: f, group, custName, norm });
      stats.unmatchedFiles++;
      continue;
    }
    stats.matchedFiles++;

    try {
      const { primary, vehicles } = parseFile(path.join(groupDir, f));
      for (const v of vehicles) {
        if (!v.mgmtNo && !v.carNo) continue;  // 空はスキップ
        allVehicles.push({
          ...v,
          customerFile: f,
          customerName: customerMatch?.name || custName,
          customerId: customerMatch?.id || null,
          customerType: customerMatch?.type || 'unknown',
          sourceFile: f,
          sourceGroup: group,
          sourceSheet: primary,
        });
        stats.totalVehicles++;
        if (customerMatch?.id) stats.matchedVehicles++;
      }
    } catch(e) {
      console.error(`❌ ${f}: ${e.message}`);
    }
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📁 ファイル: 全${stats.totalFiles} / マッチ${stats.matchedFiles} / 未マッチ${stats.unmatchedFiles}`);
console.log(`🚚 車両: 全${stats.totalVehicles} / ID紐付き${stats.matchedVehicles}`);
console.log(`\n❓ 未マッチ上位:`);
unmatched.slice(0, 15).forEach(u => console.log(`  [${u.group}] ${u.file}`));

fs.writeFileSync(path.join(SCRIPT_DIR, 'all-vehicles.json'), JSON.stringify(allVehicles, null, 1));
fs.writeFileSync(path.join(SCRIPT_DIR, 'unmatched-files.json'), JSON.stringify(unmatched, null, 2));
console.log(`\n💾 all-vehicles.json (${allVehicles.length} 車両)`);
console.log(`💾 unmatched-files.json (${unmatched.length} 未マッチ)`);
