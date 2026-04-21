// Phase B/C: バンドルファイルから月ごとに移行+照合
// Phase B: 2024/4-2025/3 (年単位ファイル)
// Phase C: 2023/4-2024/3 (四半期ファイル)
import { spawnSync } from 'child_process';
import https from 'https';
import fs from 'fs';

const args = process.argv.slice(2);
const PHASE = args.includes('--phase-b') ? 'B' : (args.includes('--phase-c') ? 'C' : null);
if (!PHASE) { console.log('使い方: --phase-b or --phase-c'); process.exit(1); }

const months = [];
if (PHASE === 'B') {
  // 2024/4 - 2025/3
  for (let m = 4; m <= 12; m++) months.push({ y: 2024, m, file: '売上明細　2024.4-2025.3.xlsx' });
  for (let m = 1; m <= 3; m++) months.push({ y: 2025, m, file: '売上明細　2024.4-2025.3.xlsx' });
} else {
  // 2023/4 - 2024/3 (四半期バンドル)
  for (let m = 4; m <= 6; m++) months.push({ y: 2023, m, file: '売上明細　2023.4-2023.6.xlsx' });
  for (let m = 7; m <= 9; m++) months.push({ y: 2023, m, file: '売上明細　2023.7-2023.9.xlsx' });
  for (let m = 10; m <= 12; m++) months.push({ y: 2023, m, file: '売上明細　2023.10-2023.12.xlsx' });
  for (let m = 1; m <= 3; m++) months.push({ y: 2024, m, file: '売上明細　2024.1-2024.3.xlsx' });
}

// Notion 既存伝票をチェックして、既に投入済みならスキップ
const WORKER = 'notion-proxy.33322666666mm.workers.dev';
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: WORKER, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(new Error(c.slice(0,200))); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(e); });
      req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}

async function countNotionSlips(y, m) {
  const mm = String(m).padStart(2, '0');
  const lastD = new Date(y, m, 0).getDate();
  const from = `${y}-${mm}-01`;
  const to = `${y}-${mm}-${String(lastD).padStart(2,'0')}`;
  let count = 0;
  let cursor = null;
  do {
    const body = { filter: { and: [
      { property: '売上日', date: { on_or_after: from } },
      { property: '売上日', date: { on_or_before: to } },
    ]}, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
    count += (r.results || []).length;
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return count;
}

const results = [];
for (const { y, m, file } of months) {
  console.log(`\n━━━ Phase ${PHASE}: ${y}/${m} ━━━`);
  console.log('  ファイル:', file);

  // Notion 既存件数
  const existingCount = await countNotionSlips(y, m);
  console.log('  Notion既存伝票:', existingCount);

  if (existingCount > 0) {
    console.log('  ⚠️  既に投入済みのためスキップ（リセットが必要なら手動で）');
    results.push({ year: y, month: m, status: 'skipped-existing', existingCount });
    continue;
  }

  // 移行実行
  const r1 = spawnSync('node', [
    'scripts/sales-migration/migrate-sales.mjs',
    '--file', file,
    '--target-year', String(y),
    '--target-month', String(m),
  ], { encoding: 'utf8', timeout: 3600000, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 50 * 1024 * 1024 });

  const out = r1.stdout || '';
  const successMatch = out.match(/✅ 成功: (\d+) 伝票/);
  const failMatch = out.match(/❌ 失敗: (\d+) 伝票/);
  const nSuccess = successMatch ? Number(successMatch[1]) : 0;
  const nFail = failMatch ? Number(failMatch[1]) : 0;
  console.log(`  → 成功 ${nSuccess} / 失敗 ${nFail}`);

  // fix-slip-totals
  const r2 = spawnSync('node', ['scripts/sales-migration/_fix-slip-totals.mjs', '--year', String(y), '--month', String(m)], { encoding: 'utf8', timeout: 900000 });
  const fixMatch = (r2.stdout || '').match(/修正: (\d+) 件/);
  console.log('  fix:', fixMatch ? `${fixMatch[1]}件修正` : '-');

  // verify-month
  const r3 = spawnSync('node', ['scripts/sales-migration/_verify-month.mjs', '--year', String(y), '--month', String(m)], { encoding: 'utf8', timeout: 1200000 });
  const vOut = r3.stdout || '';
  const diffNetMatch = vOut.match(/差額\(Notion - 弥生純売上\): (-?[\d,]+)/);
  const diffSlipsMatch = vOut.match(/差分 伝票: (-?\d+)/);
  const diffDetailsMatch = vOut.match(/差分 明細: (-?\d+)/);
  const matchStatus = vOut.includes('完全一致') ? '✅' : '❌';
  const diffNet = diffNetMatch ? Number(diffNetMatch[1].replace(/,/g, '')) : null;
  const diffSlips = diffSlipsMatch ? Number(diffSlipsMatch[1]) : null;
  const diffDetails = diffDetailsMatch ? Number(diffDetailsMatch[1]) : null;
  console.log(`  verify: ${matchStatus} 差額${diffNet}円 差分伝票${diffSlips} 明細${diffDetails}`);

  results.push({
    year: y, month: m, status: matchStatus === '✅' ? 'ok' : 'ng',
    nSuccess, nFail, diffNet, diffSlips, diffDetails,
  });
}

// レポート
console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Phase ${PHASE} 完了レポート`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const r of results) {
  console.log(`${r.year}/${String(r.month).padStart(2)}: ${r.status} 成功${r.nSuccess||0} 失敗${r.nFail||0} 差額${r.diffNet||'-'}円`);
}

fs.writeFileSync(`_phase-${PHASE.toLowerCase()}-results.json`, JSON.stringify(results, null, 2));
console.log(`\n→ _phase-${PHASE.toLowerCase()}-results.json`);
