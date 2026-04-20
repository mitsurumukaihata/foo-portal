#!/usr/bin/env node
// ムロオ4拠点のタイヤ管理表(Excel)をパースして車両マスタJSONを出力
// 使い方: node parse-muroo-tire-tables.mjs [--out vehicles.json]

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const BASE = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/タイヤ管理表';
const FILES = [
  { label: 'ムロオ広島北センター',        file: 'ムロオ北管理.xlsx' },
  { label: 'ムロオイオン',                  file: 'ムロオイオン.xlsx' },
  { label: 'ムロオ広島三井食品配送センター', file: 'ムロオ三井 (from mukaihatatire) (3).xlsx' },
  { label: 'ムロオ五日市配車センター',     file: 'ムロオ五日市配車センター (1).xlsx' },
];

function getArg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

// Excel シリアル → YYYY-MM-DD
function excelDate(serial) {
  if (!serial || typeof serial !== 'number' || serial < 30000) return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

// 管理番号パターン: 4桁数字 or "NNNN" 形式
function isManagementNumber(s) {
  if (s == null) return false;
  const str = String(s).trim();
  return /^\d{4}$/.test(str);
}

/**
 * 1シートから車両レコードを抽出
 * レコード構造:
 *   { mgmtNo: '1773', frSize: '275/70R22.5', frQty: 2,
 *     rrSize: '245/70R19.5', rrQty: 4, axleCount: 2(Fr+Rr1) or 3(Fr+Rr1+Rr2) }
 */
function parseSheet(rows, ctx) {
  const vehicles = [];
  let current = null;
  let rrRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const colA = r[0];  // 通番 (1,2,3...)
    const colB = r[1];  // 管理番号
    const colC = r[2];  // Fr/Rr
    const colD = r[3];  // サイズ
    const colE = r[4];  // 本数
    const colJ = r[9];  // ハイタイヤ/廃タイヤ列

    // ヘッダー行スキップ
    if (typeof colA === 'string' && /ノーマル|タイヤ管理|管理表|7ｔ|御中/.test(colA)) continue;
    if (typeof colD === 'string' && /タイヤサイズ/.test(colD)) continue;
    if (typeof colF === 'string' && /左外/.test(r[5] || '')) continue;

    const mgmtNum = isManagementNumber(colB) ? String(colB).trim() : null;
    const isFr = colC === 'Fr';
    const isRr = colC === 'Rr';

    if (mgmtNum && isFr) {
      // 新しい車両開始
      if (current) vehicles.push(current);
      // サイズ抽出 (例: "295/70R22.5 / 245/70R19.5" → [Fr, Rr] を分離)
      const sizeStr = (colD && typeof colD === 'string') ? colD : '';
      const sizeMatches = sizeStr.match(/\d{3}\/\d{2}R\d+(?:\.\d)?/g) || [];
      current = {
        mgmtNo: mgmtNum,
        location: ctx.location,
        ownerLabel: ctx.ownerLabel,
        frSize: sizeMatches[0] || '',
        frQty: Number(colE) || 0,
        rrSize: sizeMatches[1] || '',  // 複合記法の場合はここで2番目が入る
        rrQty: 0,
        rrAxles: 0,
        axleCount: 1,
        rawFrSizeCell: sizeStr,
        subMgmt: [],
        sourceSheet: ctx.sheetName,
        sourceRow: i + 1,
      };
      rrRows = 0;
    } else if (current && isRr) {
      rrRows++;
      current.rrAxles = rrRows;
      current.axleCount = 1 + rrRows;
      if (colD && typeof colD === 'string') {
        const m = colD.match(/\d{3}\/\d{2}R\d+(?:\.\d)?/);
        if (m && !current.rrSize) current.rrSize = m[0];
      }
      const qty = Number(colE) || 0;
      if (qty) current.rrQty += qty;
    } else if (current && colB && typeof colB === 'string' && colB.trim()) {
      // サブ管理番号（例: "21-46" 等、顧客内部の識別子）
      current.subMgmt.push(String(colB).trim());
    }
  }
  if (current) vehicles.push(current);
  return vehicles;
}

/**
 * 1ファイルから最新年度シートの車両リストを取得。
 * サイズ未設定の車両は過去シート（新しい順）から補完。
 */
function parseFile(fileLabel, fileName) {
  const full = path.join(BASE, fileName);
  const wb = XLSX.readFile(full);
  // 最新→旧の順でスキャン
  const preferredOrder = ['2026', '2025 (2)', '2025', '2024 (3)', '2024 (2)', '2024', '2023冬', '2023春', '2022冬', '2022春'];
  const allAttempt = preferredOrder.filter(n => wb.SheetNames.includes(n));
  if (!allAttempt.length) allAttempt.push(wb.SheetNames[0]);
  const primary = allAttempt[0];
  const sh = wb.Sheets[primary];
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  const ctx = { location: fileLabel, ownerLabel: fileLabel, sheetName: primary };
  const vehicles = parseSheet(rows, ctx);

  // サイズが未設定の車両を過去シートから補完
  const needFill = vehicles.filter(v => !v.frSize || !v.rrSize);
  if (needFill.length > 0 && allAttempt.length > 1) {
    for (let k = 1; k < allAttempt.length && needFill.some(v => !v.frSize || !v.rrSize); k++) {
      const name = allAttempt[k];
      const rrows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
      const olderVehicles = parseSheet(rrows, { location: fileLabel, ownerLabel: fileLabel, sheetName: name });
      for (const nv of vehicles) {
        if (nv.frSize && nv.rrSize) continue;
        const oldMatch = olderVehicles.find(ov => ov.mgmtNo === nv.mgmtNo);
        if (!oldMatch) continue;
        if (!nv.frSize && oldMatch.frSize) nv.frSize = oldMatch.frSize + ' (過去: ' + name + ')';
        if (!nv.rrSize && oldMatch.rrSize) nv.rrSize = oldMatch.rrSize + ' (過去: ' + name + ')';
      }
    }
  }

  return { fileLabel, sheetName: primary, vehicles, sheets: wb.SheetNames };
}

// ========== 実行 ==========
const allResults = [];
for (const { label, file } of FILES) {
  try {
    const r = parseFile(label, file);
    allResults.push(r);
    console.log(`\n📁 ${label} (${r.sheetName})`);
    console.log(`   車両数: ${r.vehicles.length}`);
    console.log(`   サンプル(先頭3件):`);
    for (const v of r.vehicles.slice(0, 3)) {
      console.log(`     #${v.mgmtNo}  Fr=${v.frSize}(×${v.frQty})  Rr=${v.rrSize}(×${v.rrQty}, ${v.rrAxles}軸)`);
    }
  } catch (e) {
    console.error(`❌ ${label}: ${e.message}`);
  }
}

const total = allResults.reduce((s, r) => s + r.vehicles.length, 0);
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`🚚 合計車両数: ${total}`);
console.log(`   拠点別:`);
for (const r of allResults) console.log(`     ${r.fileLabel}: ${r.vehicles.length} 車両`);

// サイズ別集計
const sizeCount = new Map();
for (const r of allResults) {
  for (const v of r.vehicles) {
    [v.frSize, v.rrSize].forEach(sz => {
      if (!sz) return;
      sizeCount.set(sz, (sizeCount.get(sz) || 0) + 1);
    });
  }
}
console.log(`\n📐 使用サイズ種類: ${sizeCount.size}`);
const topSizes = [...sizeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [sz, n] of topSizes) console.log(`     ${n}台 - ${sz}`);

// 4t車(1Rr軸) vs 10t車(2Rr軸)
const byAxle = { 1: 0, 2: 0, 3: 0, other: 0 };
for (const r of allResults) for (const v of r.vehicles) {
  if (v.axleCount === 2) byAxle[2]++;
  else if (v.axleCount === 3) byAxle[3]++;
  else if (v.axleCount === 1) byAxle[1]++;
  else byAxle.other++;
}
console.log(`\n🚛 軸数別: ${byAxle[2]}台(Fr+1Rr=4t系)  ${byAxle[3]}台(Fr+2Rr=10t系)  ${byAxle.other}台(その他)`);

// JSON 出力
const scriptDir = path.dirname(decodeURI(new URL(import.meta.url).pathname.replace(/^\//, '')));
const OUT = getArg('out', path.join(scriptDir, 'muroo-vehicles.json'));
fs.writeFileSync(OUT, JSON.stringify(allResults.flatMap(r => r.vehicles), null, 2), 'utf-8');
console.log(`\n💾 JSON 出力: ${OUT}`);
console.log(`   → 後続 import-vehicles スクリプトの入力になる`);
