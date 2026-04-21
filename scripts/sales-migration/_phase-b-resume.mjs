// Phase B 再開: 2024/11-2025/3 の5ヶ月
// 2024/10 は verify 未了なので一緒にチェック
import { spawnSync } from 'child_process';
import https from 'https';
import fs from 'fs';

const file = '売上明細　2024.4-2025.3.xlsx';
const months = [
  { y: 2024, m: 10 },  // 既に投入済み→ fix+verifyのみ
  { y: 2024, m: 11 }, { y: 2024, m: 12 },
  { y: 2025, m: 1 }, { y: 2025, m: 2 }, { y: 2025, m: 3 },
];

const WORKER = 'notion-proxy.33322666666mm.workers.dev';
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: WORKER, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(e); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(e); });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
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

for (const { y, m } of months) {
  console.log(`\n━━━ Phase B resume: ${y}/${m} ━━━`);
  const existing = await countNotionSlips(y, m);
  console.log('  Notion既存:', existing);

  if (existing === 0) {
    // 未着手 → migration
    const r1 = spawnSync('node', [
      'scripts/sales-migration/migrate-sales.mjs',
      '--file', file, '--target-year', String(y), '--target-month', String(m),
    ], { encoding: 'utf8', timeout: 3600000, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 50 * 1024 * 1024 });
    const out = r1.stdout || '';
    const sm = out.match(/✅ 成功: (\d+) 伝票/);
    const fm = out.match(/❌ 失敗: (\d+) 伝票/);
    console.log(`  → 成功 ${sm ? sm[1] : '?'} / 失敗 ${fm ? fm[1] : '?'}`);
  } else {
    console.log('  既に投入済み → fix+verifyのみ');
  }

  const r2 = spawnSync('node', ['scripts/sales-migration/_fix-slip-totals.mjs', '--year', String(y), '--month', String(m)], { encoding: 'utf8', timeout: 1200000 });
  const fixMatch = (r2.stdout || '').match(/修正: (\d+) 件/);
  console.log('  fix:', fixMatch ? `${fixMatch[1]}件` : '-');

  const r3 = spawnSync('node', ['scripts/sales-migration/_verify-month.mjs', '--year', String(y), '--month', String(m)], { encoding: 'utf8', timeout: 1500000 });
  const vOut = r3.stdout || '';
  const dm = vOut.match(/差額\(Notion - 弥生純売上\): (-?[\d,]+)/);
  const dsm = vOut.match(/差分 伝票: (-?\d+)/);
  const ddm = vOut.match(/差分 明細: (-?\d+)/);
  const ok = vOut.includes('完全一致') ? '✅' : '❌';
  console.log(`  verify: ${ok} 差額${dm ? dm[1] : '-'}円 伝票差${dsm ? dsm[1] : '-'} 明細差${ddm ? ddm[1] : '-'}`);
}

console.log('\n━━━ Phase B 完了 ━━━');
