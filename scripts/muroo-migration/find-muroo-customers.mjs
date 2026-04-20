#!/usr/bin/env node
// 顧客情報DB(1ca8d122)と得意先マスタ(f632f512)から「ムロオ」関連エントリを検索してIDリスト出力
// 夜の import-muroo-vehicles.mjs の --locations-json に使う

import https from 'https';

const CUSTOMER_DB = '1ca8d122be214e3892879932147143c9'; // 顧客情報DB（エンドユーザー）
const TOKUI_DB    = 'f632f512f12d49b2b11f2b3e45c70aec'; // 得意先マスタ（請求先）

function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev',
        path: p, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
      }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const pp = JSON.parse(c);
            if (pp.object === 'error' && ['rate_limited','internal_server_error','service_unavailable'].includes(pp.code) && n > 0) {
              setTimeout(() => tryFetch(n - 1), 3000 * (6 - n));
              return;
            }
            res(pp);
          } catch(e) { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}

async function scanDb(dbId, label) {
  console.log(`\n🔍 ${label} (${dbId})`);
  const all = []; let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + dbId + '/query', body);
    all.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  console.log(`   総件数: ${all.length}`);

  // タイトル（どのプロパティが title か自動検出）
  const mrooMatches = [];
  for (const p of all) {
    let title = '';
    for (const k in p.properties) {
      if (p.properties[k]?.type === 'title') {
        title = p.properties[k].title?.[0]?.plain_text || '';
        break;
      }
    }
    // 追加検索: 他のrich_textプロパティも含める
    const blob = title + ' ' + Object.values(p.properties).map(v => {
      if (v?.type === 'rich_text') return (v.rich_text?.[0]?.plain_text || '');
      if (v?.type === 'select') return (v.select?.name || '');
      return '';
    }).join(' ');
    if (/ムロオ|muroo|MUROO/i.test(blob)) {
      mrooMatches.push({ id: p.id, title, blob: blob.slice(0, 120) });
    }
  }
  console.log(`   ムロオ関連: ${mrooMatches.length} 件`);
  for (const m of mrooMatches) console.log(`     ${m.id.slice(0,8)}...  ${m.title}`);
  return mrooMatches;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('ムロオ関連エントリ検索');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const custMatches = await scanDb(CUSTOMER_DB, '顧客情報DB (エンドユーザー)');
const tokuiMatches = await scanDb(TOKUI_DB, '得意先マスタ (請求先)');

// 推奨 mapping を出力
console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎯 推奨 locations-json');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const mapping = {};
const labels = ['北', 'イオン', '三井', '五日市'];
for (const lbl of labels) {
  const match = custMatches.find(m => m.title.includes(lbl) || m.blob.includes(lbl));
  const key = { '北': 'ムロオ広島北センター', 'イオン': 'ムロオイオン', '三井': 'ムロオ広島三井食品配送センター', '五日市': 'ムロオ五日市配車センター' }[lbl];
  if (match) {
    console.log(`  "${key}" → ${match.id}  (${match.title})`);
    mapping[key] = match.id;
  } else {
    console.log(`  "${key}" → ❌ 見つからず`);
  }
}
console.log('\n使い方:');
console.log('  node import-muroo-vehicles.mjs --locations-json \'' + JSON.stringify(mapping) + '\' --dry-run');
