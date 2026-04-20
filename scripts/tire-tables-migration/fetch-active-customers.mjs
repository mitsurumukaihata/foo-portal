#!/usr/bin/env node
// 得意先マスタ(f632f512)と顧客情報DB(1ca8d122)から「有効」または取引中のエントリを取得
// 出力: active-customers.json { tokuiMap: name→id, endUserMap: name→id }

import https from 'https';
import fs from 'fs';
import path from 'path';

const TOKUI_DB   = 'f632f512f12d49b2b11f2b3e45c70aec';
const ENDUSER_DB = '1ca8d122be214e3892879932147143c9';

function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
      }, r => {
        let c = ''; r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const pp = JSON.parse(c);
            if (pp.object === 'error' && ['rate_limited','internal_server_error','service_unavailable'].includes(pp.code) && n > 0) {
              setTimeout(() => tryFetch(n - 1), Math.min(30000, 2000 * Math.pow(2, 5 - n))); return;
            }
            res(pp);
          } catch(e) { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d); req.end();
    };
    tryFetch(retries);
  });
}

async function fetchAll(db) {
  const all = []; let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + db + '/query', body);
    all.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return all;
}

function findTitle(p) {
  for (const k in p.properties) {
    if (p.properties[k]?.type === 'title') return p.properties[k].title?.[0]?.plain_text || '';
  }
  return '';
}

// 正規化: 株式会社/有限会社/()等を削除し小文字化
function normalize(s) {
  return (s || '').replace(/(有限会社|株式会社|\(株\)|\(有\)|㈱|㈲|（株）|（有）|\s|　|・|-|ー|（|）|\(|\))/g, '').toLowerCase();
}

const SCRIPT_DIR = path.dirname(decodeURI(new URL(import.meta.url).pathname.replace(/^\//, '')));

console.log('🔍 得意先マスタ取得中...');
const tokuiPages = await fetchAll(TOKUI_DB);
const tokuiActive = tokuiPages.filter(p => p.properties['有効']?.checkbox === true);
console.log(`   全${tokuiPages.length}件 / 有効${tokuiActive.length}件`);

console.log('🔍 顧客情報DB取得中...');
const endUserPages = await fetchAll(ENDUSER_DB);
console.log(`   全${endUserPages.length}件`);

// マップ構築: 正規化した名前→{id, originalName, type}
// 同じ正規化名で得意先と顧客情報両方にあれば得意先優先
const byNorm = new Map();
// まず顧客情報DBから（後で得意先で上書き）
for (const p of endUserPages) {
  const name = findTitle(p);
  if (!name) continue;
  const key = normalize(name);
  if (!key) continue;
  byNorm.set(key, { id: p.id, name, type: 'enduser' });
}
// 得意先マスタで上書き（有効のみ）
for (const p of tokuiActive) {
  const name = findTitle(p);
  if (!name) continue;
  const key = normalize(name);
  if (!key) continue;
  byNorm.set(key, { id: p.id, name, type: 'tokui' });
}

const output = {
  tokuiCount: tokuiActive.length,
  endUserCount: endUserPages.length,
  byNorm: Object.fromEntries(byNorm),
  tokuiActive: tokuiActive.map(p => ({ id: p.id, name: findTitle(p), code: p.properties['得意先コード']?.rich_text?.[0]?.plain_text || '' })),
  allEndUsers: endUserPages.map(p => ({ id: p.id, name: findTitle(p) })),
};

fs.writeFileSync(path.join(SCRIPT_DIR, 'active-customers.json'), JSON.stringify(output, null, 2));
console.log(`\n💾 active-customers.json (${byNorm.size} 正規化エントリ)`);
console.log(`   得意先(有効): ${tokuiActive.length}, エンドユーザー: ${endUserPages.length}`);
