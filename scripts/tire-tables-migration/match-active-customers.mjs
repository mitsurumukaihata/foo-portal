#!/usr/bin/env node
/**
 * 有効得意先 ↔ タイヤ管理表Excel マッチング報告
 * - 得意先マスタ.有効=true の顧客を取得
 * - 顧客管理/顧客管理/{あ〜や}行/*.xlsx をスキャン
 * - 名前マッチで候補ファイルを提示
 * - 出力: matching-report.json + console
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const EXCEL_ROOT = 'C:\\Users\\Mitsuru Mukaihata\\Desktop\\売上明細\\顧客管理\\顧客管理';
const OUT_JSON = path.join(import.meta.dirname, 'matching-report.json');

function sql(query, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ sql: query, params });
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev',
      path: '/d1/sql', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 全 .xlsx を列挙
function listAllExcel(root) {
  const files = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('~$')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.toLowerCase().endsWith('.xlsx')) files.push(full);
    }
  }
  walk(root);
  return files;
}

// 顧客名を正規化 (株式会社・(株)・空白・敬称除去)
function normalize(s) {
  return String(s || '')
    .replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)|（株）|（有）/g, '')
    .replace(/[\s　]+/g, '')
    .toLowerCase();
}

async function main() {
  console.log('🔍 有効得意先取得中...');
  const r = await sql(`SELECT id, 得意先名, ふりがな FROM 得意先マスタ WHERE 有効 = 1 ORDER BY 得意先名`);
  const customers = r.results || [];
  console.log(`  ${customers.length}件の有効得意先`);

  console.log('\n📂 Excel スキャン中...');
  const files = listAllExcel(EXCEL_ROOT);
  console.log(`  ${files.length}ファイル検出`);

  // 各顧客のマッチ候補を探す
  const report = [];
  let matched = 0, unmatched = 0, multi = 0;
  for (const c of customers) {
    const norm = normalize(c.得意先名);
    if (!norm) continue;
    const candidates = files.filter(f => {
      const stem = path.basename(f, path.extname(f));
      const fnorm = normalize(stem);
      // 完全一致 / 含む / 含まれる の3パターン
      return fnorm === norm || fnorm.includes(norm) || norm.includes(fnorm);
    });
    const entry = { customerId: c.id, customerName: c.得意先名, candidates };
    report.push(entry);
    if (candidates.length === 0) unmatched++;
    else if (candidates.length === 1) matched++;
    else multi++;
  }

  // 結果サマリ
  console.log(`\n=== マッチング結果 ===`);
  console.log(`  ✅ 1ファイル単独マッチ: ${matched}件`);
  console.log(`  ⚠️ 候補複数: ${multi}件`);
  console.log(`  ❌ ファイルなし: ${unmatched}件`);

  console.log(`\n--- 候補複数のサンプル (上位10件) ---`);
  report.filter(e => e.candidates.length > 1).slice(0, 10).forEach(e => {
    console.log(`  ${e.customerName}`);
    e.candidates.forEach(f => console.log(`    → ${path.basename(f)}`));
  });

  console.log(`\n--- ファイルなし のサンプル (上位15件) ---`);
  report.filter(e => e.candidates.length === 0).slice(0, 15).forEach(e => {
    console.log(`  ${e.customerName}`);
  });

  // JSON 出力
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n💾 詳細を ${OUT_JSON} に出力`);
}

main().catch(e => { console.error(e); process.exit(1); });
