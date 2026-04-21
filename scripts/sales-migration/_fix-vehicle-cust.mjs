import https from 'https';

function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>{ try { res(JSON.parse(c)); } catch(e) { rej(new Error('Parse: ' + c.slice(0,100))); } }); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';
const CUST_DB = '1ca8d122be214e3892879932147143c9';

// 除外リスト（ユーザー名ではないもの）
const excludeNames = new Set([
  '広島34Aぬ3', 'ふそう西', 'ふそう東', 'ふそう東香川',
  '2本：一時預かり', '廃車', 'SP用', '1本：現地保管',
  '左右ｲﾝﾅｰﾅｯﾄ：要交換（38*20）', '迫井部長', '姫路11く15-07',
  'ヤリス', 'ミラージュ', 'AC',
]);

// ── 1. 顧客情報DB取得 ──
console.log('顧客情報DBを取得中...');
const custs = [];
let cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${CUST_DB}/query`, body); custs.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);

function normCust(s) {
  return s.replace(/[\s　]/g,'').replace(/様$/,'')
    .replace(/[(（][^)）]*[)）]/g, '') // (TOYO) (BS) (ふそう東) 等を除去
    .replace(/株式会社|㈱/g,'').replace(/有限会社|㈲/g,'')
    .toLowerCase();
}

const custNameMap = new Map(); // normName → { id, name }
custs.forEach(c => {
  const name = c.properties['会社名']?.title?.[0]?.plain_text || '';
  const n = normCust(name);
  if (n.length > 1) custNameMap.set(n, { id: c.id, name });
});
console.log(`  顧客: ${custs.length}件`);

function findCust(userName) {
  const un = normCust(userName);
  if (un.length < 2) return null;
  // 完全一致
  if (custNameMap.has(un)) return custNameMap.get(un);
  // 部分一致
  for (const [cn, cust] of custNameMap) {
    if (cn.length > 2 && (un.includes(cn) || cn.includes(un))) return cust;
  }
  return null;
}

// ── 2. 車両マスタ取得 ──
console.log('車両マスタを取得中...');
const vehicles = [];
cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${VEHICLE_DB}/query`, body); vehicles.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);

// 顧客空+エンドユーザー名あり
const needFix = [];
for (const v of vehicles) {
  const custId = v.properties['顧客']?.relation?.[0]?.id || '';
  const memo = v.properties['メモ']?.rich_text?.[0]?.plain_text || '';
  const car = v.properties['車番']?.title?.[0]?.plain_text || '';
  if (!custId && memo.includes('エンドユーザー:')) {
    const m = memo.match(/エンドユーザー: ([^/]+)/);
    if (m) {
      const names = m[1].trim().split(', ').map(n => n.trim()).filter(n => !excludeNames.has(n));
      if (names.length > 0) needFix.push({ id: v.id, car, name: names[0], memo });
    }
  }
}
console.log(`  顧客空+ユーザー名あり: ${needFix.length}台`);

// ── 3. マッチ & 新規作成 ──
const unmatched = new Map(); // ユーザー名 → count
let matched = 0;

// まずマッチを試す
for (const v of needFix) {
  const cust = findCust(v.name);
  if (cust) {
    v.custId = cust.id;
    matched++;
  } else {
    unmatched.set(v.name, (unmatched.get(v.name) || 0) + 1);
  }
}
console.log(`  マッチ成功: ${matched}台`);
console.log(`  未マッチ: ${unmatched.size}件のユニーク名`);

// 未マッチのユーザー名を新規作成
console.log();
console.log('未マッチのユーザーを新規作成中...');
let created = 0;
for (const [name, count] of unmatched) {
  // 元請け情報をメモから取得
  const sample = needFix.find(v => v.name === name);
  const motoMatch = sample?.memo.match(/元請け: (.+?)$/);
  const motoName = motoMatch ? motoMatch[1] : '';
  let motoSelect = '';
  if (/ﾄｰﾖｰ|TOYO/i.test(motoName)) motoSelect = 'TOYO';
  else if (/ふそう.*東/.test(motoName)) motoSelect = 'ふそう東';
  else if (/ふそう.*西/.test(motoName)) motoSelect = 'ふそう西';
  else if (/ブリヂストン|BRIDGESTONE/i.test(motoName)) motoSelect = 'BRIDGESTONE';
  else if (/ダンロップ|DUNLOP/i.test(motoName)) motoSelect = 'DUNLOP';

  const props = {
    '会社名': { title: [{ text: { content: name } }] },
  };
  if (motoSelect) {
    try { props['中間管理会社'] = { select: { name: motoSelect } }; } catch(e) {}
  }

  try {
    const res = await nf('POST', '/pages', { parent: { database_id: CUST_DB }, properties: props });
    const newId = res.id;
    // needFixの該当車両にIDをセット
    for (const v of needFix) {
      if (v.name === name && !v.custId) v.custId = newId;
    }
    created++;
    console.log(`  ✚ ${name} (${count}台, ${motoSelect || '元請け不明'})`);
    await sleep(300);
  } catch(e) {
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}
console.log(`  新規作成: ${created}件`);

// ── 4. 車両マスタの顧客リレーション更新 ──
console.log();
console.log('車両マスタの顧客を更新中...');
let updated = 0, errors = 0;
for (const v of needFix) {
  if (!v.custId) continue;
  try {
    await nf('PATCH', '/pages/' + v.id, {
      properties: { '顧客': { relation: [{ id: v.custId }] } }
    });
    updated++;
    if (updated % 50 === 0) console.log(`  ${updated}/${needFix.length}`);
    await sleep(200);
  } catch(e) {
    errors++;
    console.log(`  ❌ ${v.car}: ${e.message}`);
  }
}

console.log();
console.log('===== 結果 =====');
console.log(`顧客マッチ成功: ${matched}台`);
console.log(`顧客新規作成: ${created}件`);
console.log(`車両マスタ更新: ${updated}台`);
console.log(`エラー: ${errors}件`);
