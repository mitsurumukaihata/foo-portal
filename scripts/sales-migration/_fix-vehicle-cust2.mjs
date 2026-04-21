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

// ── 1. 顧客DB取得 ──
console.log('顧客情報DBを取得中...');
const custs = [];
let cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${CUST_DB}/query`, body); custs.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);

function normCust(s) {
  return s.replace(/[\s　]/g,'').replace(/様$/,'')
    .replace(/[(（][^)）]*[)）]/g, '')
    .replace(/株式会社|㈱/g,'').replace(/有限会社|㈲/g,'')
    .toLowerCase();
}
const custNameMap = new Map();
custs.forEach(c => {
  const name = c.properties['会社名']?.title?.[0]?.plain_text || '';
  const n = normCust(name);
  if (n.length > 1) custNameMap.set(n, { id: c.id, name });
});

function findCust(userName) {
  const un = normCust(userName);
  if (un.length < 2) return null;
  if (custNameMap.has(un)) return custNameMap.get(un);
  for (const [cn, cust] of custNameMap) {
    if (cn.length > 2 && (un.includes(cn) || cn.includes(un))) return cust;
  }
  return null;
}

// 元請けID→中間管理会社select値
const motoSelectMap = {
  'TOYO': 'TOYO', 'ﾄｰﾖｰ': 'TOYO',
  'ふそう東': 'ふそう東', 'ふそう西': 'ふそう西',
  'ブリヂストン': 'BRIDGESTONE', 'ダンロップ': 'DUNLOP',
};

function getMotoSelect(motoName) {
  if (/ﾄｰﾖｰ|TOYO/i.test(motoName)) return 'TOYO';
  if (/ふそう.*東/.test(motoName)) return 'ふそう東';
  if (/ふそう.*西/.test(motoName)) return 'ふそう西';
  if (/ブリヂストン|BRIDGESTONE/i.test(motoName)) return 'BRIDGESTONE';
  if (/ダンロップ|DUNLOP/i.test(motoName)) return 'DUNLOP';
  return '';
}

// ── 2. 車両マスタ取得 ──
console.log('車両マスタを取得中...');
const vehicles = [];
cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${VEHICLE_DB}/query`, body); vehicles.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);

const noCust = vehicles.filter(v => !(v.properties['顧客']?.relation?.[0]?.id));
console.log(`  顧客なし: ${noCust.length}台`);

// ── 3. ユーザー名を抽出 ──
const needFix = [];
for (const v of noCust) {
  const memo = v.properties['メモ']?.rich_text?.[0]?.plain_text || '';
  const car = v.properties['車番']?.title?.[0]?.plain_text || '';
  let userName = '';

  // パターン1: 「エンドユーザー: ふそう西/クリケン」→ スラッシュの後ろ
  const euMatch = memo.match(/エンドユーザー: ([^/]+)\/([^,/]+)/);
  if (euMatch) {
    const first = euMatch[1].trim();
    const second = euMatch[2].trim();
    // ふそう東/西は中間なので、後ろの名前がエンドユーザー
    if (/^ふそう[東西]$/.test(first)) {
      userName = second;
    } else {
      userName = first; // 最初がエンドユーザー
    }
  }

  // パターン2: 「エンドユーザー: ユーザー名」（スラッシュなし）
  if (!userName) {
    const euSimple = memo.match(/エンドユーザー: ([^,/]+)/);
    if (euSimple) userName = euSimple[1].trim();
  }

  // パターン3: 「弥生備考: サカイ広島支社」
  if (!userName) {
    const bkMatch = memo.match(/弥生備考: ([^,/]+)/);
    if (bkMatch) {
      const name = bkMatch[1].trim();
      // 車番や数字でない場合
      if (!/\d{3}[ぁ-ん]/.test(name) && !/^\d+$/.test(name) && name.length >= 2) {
        userName = name;
      }
    }
  }

  if (userName) {
    // 元請け情報
    const motoMatch = memo.match(/元請け: (.+?)$/);
    const motoName = motoMatch ? motoMatch[1] : '';
    needFix.push({ id: v.id, car, userName, motoName, memo });
  }
}
console.log(`  ユーザー名抽出: ${needFix.length}台`);

// ── 4. マッチ & 新規作成 ──
const unmatched = new Map();
let matched = 0;
for (const v of needFix) {
  const cust = findCust(v.userName);
  if (cust) {
    v.custId = cust.id;
    matched++;
  } else {
    unmatched.set(v.userName, (unmatched.get(v.userName) || 0) + 1);
    if (!unmatched.has(v.userName + '_moto')) unmatched.set(v.userName + '_moto', v.motoName);
  }
}
console.log(`  マッチ成功: ${matched}台`);
console.log(`  未マッチ: ${unmatched.size / 2}件`);

// 未マッチを新規作成
let created = 0;
for (const [name, count] of unmatched) {
  if (name.endsWith('_moto')) continue;
  const motoName = unmatched.get(name + '_moto') || '';
  const motoSelect = getMotoSelect(motoName);

  const props = { '会社名': { title: [{ text: { content: name } }] } };
  if (motoSelect) {
    try { props['中間管理会社'] = { select: { name: motoSelect } }; } catch(e) {}
  }

  try {
    const res = await nf('POST', '/pages', { parent: { database_id: CUST_DB }, properties: props });
    for (const v of needFix) {
      if (v.userName === name && !v.custId) v.custId = res.id;
    }
    created++;
    console.log(`  ✚ ${name} (${count}台, ${motoSelect || '?'})`);
    await sleep(300);
  } catch(e) {
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

// ── 5. 車両マスタ更新 ──
console.log();
console.log('車両マスタ更新中...');
let updated = 0;
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
    console.log(`  ❌ ${v.car}: ${e.message}`);
  }
}

console.log();
console.log('===== 結果 =====');
console.log(`マッチ: ${matched}台 / 新規作成: ${created}件 / 更新: ${updated}台`);
