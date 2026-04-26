// カタログモーダルの画像取得状況を全パターンで監査
// 出力: pattern, http_status, og_image (有/無), tread_image (有/無), candidates, error
import fs from 'node:fs';

const PROXY = 'https://notion-proxy.33322666666mm.workers.dev/catalog-meta?url=';
const HTML = fs.readFileSync('tire-manager.html', 'utf8');

// DIRECT_CATALOG_URL ブロックを切り出してパース
const m = HTML.match(/const DIRECT_CATALOG_URL\s*=\s*\{([\s\S]*?)\n\};/);
if (!m) { console.error('DIRECT_CATALOG_URL not found'); process.exit(1); }
const block = m[1];
const entries = [];
const re = /'([^']+)':\s*'([^']+)'/g;
let mm;
while ((mm = re.exec(block)) !== null) {
  entries.push({ pattern: mm[1], url: mm[2] });
}
// 同URL重複は1回だけテスト
const seen = new Map();
for (const e of entries) {
  if (!seen.has(e.url)) seen.set(e.url, []);
  seen.get(e.url).push(e.pattern);
}
const uniqueUrls = [...seen.keys()];
console.log(`総エントリ: ${entries.length} / ユニークURL: ${uniqueUrls.length}\n`);

async function check(url) {
  try {
    const res = await fetch(PROXY + encodeURIComponent(url), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const j = await res.json();
    if (j.error) return { ok: false, error: j.error };
    return {
      ok: true,
      hasOg: !!j.image,
      hasTread: !!j.treadImage,
      candCount: (j.treadCandidates || []).length,
      title: j.title || '',
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 並列8本で実行
const results = [];
const queue = [...uniqueUrls];
async function worker() {
  while (queue.length > 0) {
    const url = queue.shift();
    const r = await check(url);
    results.push({ url, patterns: seen.get(url), ...r });
    process.stderr.write('.');
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
process.stderr.write('\n\n');

// 集計
const fail404 = results.filter(r => !r.ok);
const noOg = results.filter(r => r.ok && !r.hasOg);
const noTread = results.filter(r => r.ok && r.hasOg && !r.hasTread);
const both = results.filter(r => r.ok && r.hasOg && r.hasTread);

console.log(`■ 集計`);
console.log(`✅ 両方取得 (og + tread): ${both.length}`);
console.log(`⚠️  og のみ (溝画像なし): ${noTread.length}`);
console.log(`⚠️  画像ゼロ (og もなし): ${noOg.length}`);
console.log(`❌ 取得失敗 (404等): ${fail404.length}\n`);

if (fail404.length > 0) {
  console.log(`■ ❌ 取得失敗 URL (おそらく404 - URL要修正)`);
  for (const r of fail404) {
    console.log(`  ${r.error.padEnd(20)} ${r.patterns.join(',').padEnd(40)} ${r.url}`);
  }
  console.log();
}
if (noTread.length > 0) {
  console.log(`■ ⚠️ 溝画像が取れない URL (商品画像はOK)`);
  for (const r of noTread) {
    console.log(`  ${r.patterns.join(',').padEnd(40)} ${r.url}`);
  }
  console.log();
}
if (noOg.length > 0) {
  console.log(`■ ⚠️ 画像ゼロ URL (og:image すらなし)`);
  for (const r of noOg) {
    console.log(`  ${r.patterns.join(',').padEnd(40)} ${r.url}`);
  }
}
