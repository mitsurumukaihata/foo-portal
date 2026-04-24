#!/usr/bin/env node
/**
 * タイヤメーカー公式サイトのカタログインデックスをクロールして
 * パターン名 → 公式URL のマップを生成する。
 *
 * 出力: console.log で JSON を出す (手動で tire-manager.html にコピペ想定)
 */

import https from 'node:https';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      // 3xx の Location フォロー
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const next = r.headers.location.startsWith('http') ? r.headers.location : new URL(r.headers.location, url).toString();
        return get(next).then(resolve, reject);
      }
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    }).on('error', reject);
  });
}

async function crawlBridgestone() {
  const base = 'https://tire.bridgestone.co.jp';
  const map = {};
  const idx = await get(base + '/');
  // ブランドリンク: /regno/, /potenza/, /ecopia/, /newno/, /playz/, /dueler/, /blizzak/
  const brands = ['regno','potenza','ecopia','newno','playz','dueler','blizzak'];
  for (const b of brands) {
    const r = await get(base + '/' + b + '/');
    if (r.status !== 200) continue;
    // 各モデルのリンク抽出
    const re = new RegExp(`href=["'](/${b}/[^"'/]+/)["']`, 'g');
    let m;
    const models = new Set();
    while ((m = re.exec(r.body))) models.add(m[1]);
    for (const m of models) {
      const sub = await get(base + m);
      if (sub.status !== 200) continue;
      // og:title
      const tm = sub.body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      if (tm) {
        const title = tm[1].replace(/ - .+$/,'').trim();
        map[title] = base + m;
      }
    }
  }
  return { 'BRIDGESTONE': map };
}

async function main() {
  const results = await crawlBridgestone();
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
