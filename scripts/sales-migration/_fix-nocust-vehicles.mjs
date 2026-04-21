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
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const CUST_DB = '1ca8d122be214e3892879932147143c9';

// ── 1. 顧客DB ──
console.log('顧客情報DBを取得中...');
const custs = [];
let cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${CUST_DB}/query`, body); custs.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);

function normCust(s) {
  return s.replace(/[\s　]/g,'').replace(/様$/,'').replace(/さん$/,'')
    .replace(/[(（][^)）]*[)）]/g,'')
    .replace(/株式会社|㈱/g,'').replace(/有限会社|㈲/g,'')
    .toLowerCase();
}
const custNameMap = new Map();
custs.forEach(c => {
  const name = c.properties['会社名']?.title?.[0]?.plain_text || '';
  const n = normCust(name);
  if (n.length > 1) custNameMap.set(n, { id: c.id, name });
});

const motoukeIds = new Set();
custs.forEach(c => {
  const name = c.properties['会社名']?.title?.[0]?.plain_text || '';
  if (/ﾄｰﾖｰﾀｲﾔ|トーヨータイヤ|TOYO/i.test(name) || /ふそう|三菱ふそう/.test(name) || /ブリヂストン|BRIDGESTONE/i.test(name) || /ダンロップ|DUNLOP/i.test(name) || /ミカミ/.test(name) || /いすゞ/.test(name)) {
    motoukeIds.add(c.id);
  }
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

// 弥生備考がユーザー名かどうか（厳密版）
function isUserName(bikou) {
  if (!bikou || bikou.length < 2) return false;
  if (/[ぁ-んァ-ヶー一-龥]{1,4}\d{3}[ぁ-んa-zA-Zァ-ヶ]/.test(bikou)) return false;
  if (/^\d{1,8}(km|㎞)?$/i.test(bikou)) return false;
  if (/^\d{1,5}(-\d{1,5})?$/.test(bikou)) return false;
  if (/^\d+\/\d+/.test(bikou)) return false;
  if (/\d{4,}km/i.test(bikou)) return false;
  if (/^[A-Z]{1,5}[\-]?\d{3,}/i.test(bikou)) return false;
  if (/^[A-Z]-\d{3,}/i.test(bikou)) return false;
  if (/^[￥¥]/.test(bikou)) return false;
  if (/^№/.test(bikou)) return false;
  if (/外し/.test(bikou)) return false;
  if (/^型式/.test(bikou)) return false;
  if (/^STL/.test(bikou)) return false;
  if (/^廃タイヤ/.test(bikou)) return false;
  if (/^(営業車|マイクロバス|ハイエース|トレーラー|3軸|4軸|増ｔ|[234]ｔ|トラック)/.test(bikou)) return false;
  if (/^(北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)(県|都|府)?$/.test(bikou)) return false;
  if (/^R[：:]/.test(bikou)) return false;
  if (/^fooパック$/i.test(bikou)) return false;
  if (/^\d+分$/.test(bikou)) return false;
  if (/^\d{5,}\//.test(bikou)) return false;
  if (/^作業車/.test(bikou)) return false;
  if (/^No\.\d/i.test(bikou)) return false;
  if (/^\d+台分/.test(bikou)) return false;
  if (/\d{4}\.\d{1,2}\.\d{1,2}作業/.test(bikou)) return false;
  if (/^[A-Z]{2,4}\d{2,}[A-Z]/.test(bikou)) return false;
  if (/^不明$/.test(bikou)) return false;
  if (/^廃車$/.test(bikou)) return false;
  if (/^SP/.test(bikou)) return false;
  if (/^Fホイール/.test(bikou)) return false;
  if (/^Fのみ/.test(bikou)) return false;
  if (/^ヤリス$/.test(bikou)) return false;
  if (/^ミラージュ$/.test(bikou)) return false;
  if (/^プリウス/.test(bikou)) return false;
  if (/承認番号/.test(bikou)) return false;
  if (/^保管料/.test(bikou)) return false;
  if (/^パンク修理/.test(bikou)) return false;
  if (/^次回/.test(bikou)) return false;
  if (/ﾎｲｰﾙ|ホイール/.test(bikou)) return false;
  if (/ｲﾝﾅｰﾅｯﾄ/.test(bikou)) return false;
  return true;
}

// ── 2. 車両マスタ（顧客なし+元請けあり） ──
console.log('車両マスタを取得中...');
const vehicles = [];
cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${VEHICLE_DB}/query`, body); vehicles.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);

const noCust = vehicles.filter(v => {
  const custId = v.properties['顧客']?.relation?.[0]?.id || '';
  const memo = v.properties['メモ']?.rich_text?.[0]?.plain_text || '';
  return !custId && memo.includes('元請け:');
});
console.log(`  顧客なし+元請け: ${noCust.length}台`);

// ── 3. 伝票取得 ──
const slips = [];
cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${SALES_DB}/query`, body); slips.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);
const slipByCar = new Map();
slips.forEach(s => {
  const car = s.properties['車番']?.rich_text?.[0]?.plain_text || '';
  if (car) {
    if (!slipByCar.has(car)) slipByCar.set(car, []);
    slipByCar.get(car).push(s);
  }
});

// ── 4. 各車両の伝票を確認して、弥生備考からユーザー名を取得 ──
console.log('伝票の弥生備考を再チェック中...');
const toFix = [];
const toCreate = []; // 顧客DBに未登録のユーザー名
let processed = 0;

for (const v of noCust) {
  const car = v.properties['車番']?.title?.[0]?.plain_text || '';
  if (!car) continue;

  const mySlips = slipByCar.get(car) || [];
  if (!mySlips.length) continue;

  let bestUserName = '';
  let bestCustId = null;

  for (const slip of mySlips) {
    const detailRes = await nf('POST', `/databases/${DETAIL_DB}/query`, {
      filter: { property: '売上伝票', relation: { contains: slip.id } },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 50,
    });
    await sleep(150);

    // 全明細のユーザー名を収集
    for (const d of (detailRes.results || [])) {
      const bikou = d.properties['弥生備考']?.rich_text?.[0]?.plain_text || '';
      if (!bikou) continue;

      const cleaned = bikou.replace(/様$/, '').replace(/さん$/, '').trim();
      if (isUserName(bikou) && cleaned.length >= 2) {
        // 顧客DBとマッチ
        const cust = findCust(cleaned);
        if (cust && !motoukeIds.has(cust.id)) {
          bestUserName = cleaned;
          bestCustId = cust.id;
          break;
        }
        // マッチしなくてもユーザー名として記録
        if (!bestUserName) bestUserName = cleaned;
      }
    }
    if (bestCustId) break;
  }

  if (bestCustId) {
    toFix.push({ id: v.id, car, userName: bestUserName, custId: bestCustId });
  } else if (bestUserName) {
    toCreate.push({ id: v.id, car, userName: bestUserName });
  }

  processed++;
  if (processed % 30 === 0) console.log(`  ${processed}/${noCust.length}`);
}

console.log();
console.log(`マッチ成功: ${toFix.length}台`);
console.log(`新規作成必要: ${toCreate.length}台`);

// ── 5. マッチ成功分を更新 ──
console.log();
console.log('マッチ成功分を更新中...');
let updated = 0;
for (const f of toFix) {
  await nf('PATCH', '/pages/' + f.id, { properties: { '顧客': { relation: [{ id: f.custId }] } } });
  updated++;
  console.log(`  ✓ ${f.car} → ${f.userName}`);
  await sleep(150);
}

// ── 6. 新規作成必要分 → 顧客作成して車両更新 ──
console.log();
console.log('新規顧客を作成中...');
const motoSelectGuess = (memo) => {
  if (/ﾄｰﾖｰ|TOYO/i.test(memo)) return 'TOYO';
  if (/ふそう.*東/.test(memo)) return 'ふそう東';
  if (/ふそう.*西/.test(memo)) return 'ふそう西';
  if (/ブリヂストン/i.test(memo)) return 'BRIDGESTONE';
  return '';
};

let created = 0;
const createdMap = new Map(); // ユーザー名 → custId
for (const item of toCreate) {
  if (createdMap.has(item.userName)) {
    // 既に作成済み
    await nf('PATCH', '/pages/' + item.id, { properties: { '顧客': { relation: [{ id: createdMap.get(item.userName) }] } } });
    updated++;
    console.log(`  ✓ ${item.car} → ${item.userName} (既作成)`);
    await sleep(150);
    continue;
  }

  const v = vehicles.find(x => x.id === item.id);
  const memo = v?.properties['メモ']?.rich_text?.[0]?.plain_text || '';
  const motoSelect = motoSelectGuess(memo);

  const props = { '会社名': { title: [{ text: { content: item.userName } }] } };
  if (motoSelect) {
    try { props['中間管理会社'] = { select: { name: motoSelect } }; } catch(e) {}
  }

  try {
    const res = await nf('POST', '/pages', { parent: { database_id: CUST_DB }, properties: props });
    createdMap.set(item.userName, res.id);
    await nf('PATCH', '/pages/' + item.id, { properties: { '顧客': { relation: [{ id: res.id }] } } });
    created++;
    updated++;
    console.log(`  ✚ ${item.car} → ${item.userName} (新規作成, ${motoSelect})`);
    await sleep(300);
  } catch(e) {
    console.log(`  ❌ ${item.car} ${item.userName}: ${e.message}`);
  }
}

console.log();
console.log('===== 結果 =====');
console.log(`車両更新: ${updated}台`);
console.log(`顧客新規作成: ${created}件`);
console.log(`残り未修正: ${noCust.length - updated}台`);
