// FOOパック契約DBの得意先リレーションを正しく再設定
// - 検索先: 得意先マスタ (f632f512) の「得意先名」title
// - K&Mは未登録なのでスキップ（後でユーザーが得意先マスタに追加）
import https from 'https';

const FOO_DB = '8f7b92b3be4a4ac0832de8b53190c6b5';
const TOKUI_MASTER = 'f632f512f12d49b2b11f2b3e45c70aec';

function nf(method, p, body, retries = 3) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 2000); else rej(new Error(c.slice(0, 200))); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 2000); else rej(e); });
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 得意先マスタ全件を取得して名前 → page_id マップを作成
async function buildTokuiMap() {
  const map = new Map();
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + TOKUI_MASTER + '/query', body);
    for (const p of (r.results || [])) {
      const title = p.properties['得意先名']?.title?.[0]?.plain_text || '';
      if (title) map.set(title, p.id);
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return map;
}

// 得意先名から最適マッチを見つける（正規化後に部分一致）
function normalizeName(s) {
  return s
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/株式会社|㈱|\(株\)|（株）|有限会社|㈲|\(有\)|（有）|会社/g, '')
    .replace(/\s+/g, '')
    .replace(/本社|営業所|支店/g, '')
    .replace(/＆/g, '&')  // 全角→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))  // 英数字全角→半角
    .toLowerCase();
}

function findBestMatch(targetName, tokuiMap) {
  const normalized = normalizeName(targetName);
  if (!normalized) return null;
  // 完全一致優先
  for (const [name, id] of tokuiMap) {
    if (normalizeName(name) === normalized) return { id, name };
  }
  // 部分一致
  for (const [name, id] of tokuiMap) {
    const n = normalizeName(name);
    if (n.includes(normalized) || normalized.includes(n)) return { id, name };
  }
  return null;
}

console.log('=== FOOパック契約 得意先リレーション再設定 ===');
console.log();
console.log('得意先マスタ全件取得中...');
const tokuiMap = await buildTokuiMap();
console.log('  件数:', tokuiMap.size);

// FOOパック契約を全件取得
const contracts = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + FOO_DB + '/query', body);
  contracts.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('  FOO契約件数:', contracts.length);
console.log();

// 得意先名ごとにマッチング結果を計算
const custMatches = new Map();
for (const c of contracts) {
  const custName = c.properties['得意先名']?.rich_text?.[0]?.plain_text || '';
  if (!custName) continue;
  if (custMatches.has(custName)) continue;
  const match = findBestMatch(custName, tokuiMap);
  custMatches.set(custName, match);
}

console.log('得意先マッチング結果:');
for (const [cust, match] of custMatches) {
  console.log(`  ${cust.padEnd(25)} → ${match ? '✓ ' + match.name : '❌ 未登録'}`);
}
console.log();

// 各契約を更新
let updated = 0, skipped = 0, unmatched = 0;
for (const c of contracts) {
  const custName = c.properties['得意先名']?.rich_text?.[0]?.plain_text || '';
  const match = custMatches.get(custName);
  if (!match) { unmatched++; continue; }

  // 既に同じrelationが設定されているかチェック
  const currentRel = c.properties['得意先']?.relation?.[0]?.id;
  if (currentRel === match.id) { skipped++; continue; }

  try {
    await nf('PATCH', '/pages/' + c.id, {
      properties: {
        '得意先': { relation: [{ id: match.id }] },
      }
    });
    updated++;
  } catch(e) {
    console.log('  ❌', custName, ':', e.message);
  }
  await sleep(180);
}

console.log();
console.log(`更新: ${updated}件 / スキップ: ${skipped}件 / 未マッチ: ${unmatched}件`);
