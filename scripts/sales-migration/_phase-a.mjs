// Phase A: 既移行12ヶ月（2025/4〜2026/3）の fix-totals + verify + per-code diff
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const months = [];
for (let y = 2025, m = 4; !(y === 2026 && m === 4); ) {
  months.push({ y, m });
  m++;
  if (m > 12) { m = 1; y++; }
}

const results = [];

for (const { y, m } of months) {
  console.log(`\n━━━ ${y}/${m} ━━━`);

  // 1) fix-slip-totals
  const r1 = spawnSync('node', ['scripts/sales-migration/_fix-slip-totals.mjs', '--year', String(y), '--month', String(m)], { encoding: 'utf8', timeout: 600000 });
  const fixLine = (r1.stdout || '').split('\n').find(l => l.includes('修正')) || '';
  const notionTotalLine = (r1.stdout || '').split('\n').find(l => l.includes('税抜合計')) || '';
  console.log('  fix:', fixLine.trim(), '|', notionTotalLine.trim());

  // 2) verify-month
  const r2 = spawnSync('node', ['scripts/sales-migration/_verify-month.mjs', '--year', String(y), '--month', String(m)], { encoding: 'utf8', timeout: 900000 });
  const lines2 = (r2.stdout || '').split('\n');
  const verifyRes = {
    yayoiSlips: null, yayoiDetails: null,
    notionSlips: null, notionDetails: null,
    notionTax: null,
    diffNet: null,
    diffSlips: null, diffDetails: null,
    matchStatus: '?',
    mismatches: [],
  };
  for (const line of lines2) {
    const mYS = line.match(/弥生 伝票: (\d+) \/ 明細: (\d+)/);
    if (mYS && !verifyRes.yayoiSlips) { verifyRes.yayoiSlips = Number(mYS[1]); verifyRes.yayoiDetails = Number(mYS[2]); }
    const mNS = line.match(/Notion 伝票: (\d+) \/ 明細: (\d+)/);
    if (mNS) { verifyRes.notionSlips = Number(mNS[1]); verifyRes.notionDetails = Number(mNS[2]); }
    const mNT = line.match(/Notion 伝票税抜合計: ([\d,]+)/);
    if (mNT) verifyRes.notionTax = Number(mNT[1].replace(/,/g, ''));
    const mDiff = line.match(/差額\(Notion - 弥生純売上\): (-?[\d,]+)/);
    if (mDiff) verifyRes.diffNet = Number(mDiff[1].replace(/,/g, ''));
    const mDS = line.match(/差分 伝票: (-?\d+)/);
    if (mDS) verifyRes.diffSlips = Number(mDS[1]);
    const mDD = line.match(/差分 明細: (-?\d+)/);
    if (mDD) verifyRes.diffDetails = Number(mDD[1]);
    if (line.includes('完全一致')) verifyRes.matchStatus = '完全一致';
    if (line.includes('不一致あり')) verifyRes.matchStatus = '不一致';
    const mMis = line.match(/\s*伝票(\d+): Notion(\d+) 弥生(\d+)/);
    if (mMis) verifyRes.mismatches.push({ slip: mMis[1], notion: Number(mMis[2]), yayoi: Number(mMis[3]) });
  }
  console.log(`  件数: N${verifyRes.notionSlips}/Y${verifyRes.yayoiSlips} 明細:N${verifyRes.notionDetails}/Y${verifyRes.yayoiDetails} 差額:${verifyRes.diffNet}円 [${verifyRes.matchStatus}]`);

  // 3) per-code diff (商品別日報と比較)
  const r3 = spawnSync('node', ['scripts/sales-migration/_analyze-diff-by-code.mjs', '--year', String(y), '--month', String(m)], { encoding: 'utf8', timeout: 120000 });
  const codeLines = (r3.stdout || '').split('\n');
  const codeDiffs = [];
  for (const line of codeLines) {
    const m4 = line.match(/^([A-Za-z0-9_]+)\s*\|\s*(.+?)\s*\|\s*([\-\d,]+)\s*\|\s*([\-\d,]+)\s*\|\s*([\-\d,]+)/);
    if (m4) {
      codeDiffs.push({ code: m4[1].trim(), name: m4[2].trim(), sales: Number(m4[3].replace(/,/g,'')), report: Number(m4[4].replace(/,/g,'')), diff: Number(m4[5].replace(/,/g,'')) });
    }
  }
  // 合計差額
  const diffTotalLine = codeLines.find(l => l.includes('差がある商品の合計')) || '';
  console.log('  code diff:', diffTotalLine.trim());

  results.push({ year: y, month: m, verify: verifyRes, codeDiffs, totalCodeDiffLine: diffTotalLine.trim() });
}

// ── レポート生成 ──
console.log('\n\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Phase A 完了レポート');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log();
console.log('年月    | 件数一致 | 差額(円)    | 最大差額商品 (diff円)');
console.log('─'.repeat(85));
for (const r of results) {
  const status = (r.verify.diffSlips === 0 && r.verify.diffDetails === 0) ? '✅' : '❌';
  const biggest = [...r.codeDiffs].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
  const bigStr = biggest ? `${biggest.code} ${biggest.name.slice(0,15)} (${biggest.diff}円)` : '-';
  console.log(`${r.year}/${String(r.month).padStart(2)} | ${status}      | ${String(r.verify.diffNet ?? '-').padStart(10)} | ${bigStr}`);
}

// JSON出力
fs.writeFileSync('_phase-a-results.json', JSON.stringify(results, null, 2));
console.log('\n結果を _phase-a-results.json に保存');
