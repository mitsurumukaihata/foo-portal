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

// 修正対象の顧客ID
const MIKAMI_ID = '33fa695f-8e88-8108-8d45-d7fd03437206';
const HIROSHIMA_IC_ID = '327a695f-8e88-8169-81e2-f6d97722e4cd';
const NISHIMATSU_ACTIO_ID = '327a695f-8e88-8184-a98b-e827fdb12b23';
const ACTIO_HIROSHIMA_ID = '340a695f-8e88-81cd-bea4-fb902753107b';
const ACTIO_HATSUKAICHI_ID = '340a695f-8e88-8164-aeab-e8ec188053cc';
const MIZUTANI_ID = (() => { /* 水谷建設のIDを後で取得 */ return null; })();
const TAIYOKENKI_IWAKUNI_ID = '340a695f-8e88-81f0-9e04-c8c5133e5fc4';
const TAIYOKENKI_ITSUKAICHI_ID = '327a695f-8e88-81f0-a9a6-ec9dad7baa64';
const WILLER_ID = '327a695f-8e88-8114-972f-fa3da68fd41e';
const WILLAA_ID = '340a695f-8e88-81c3-979b-f5f907370b1a'; // ウィラー

// 全車両取得
console.log('車両マスタを取得中...');
const vehicles = [];
let cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${VEHICLE_DB}/query`, body); vehicles.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);
console.log(`  ${vehicles.length}台`);

// 顧客DBから水谷建設のIDを取得
const CUST_DB = '1ca8d122be214e3892879932147143c9';
const allCusts = [];
cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${CUST_DB}/query`, body); allCusts.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);
const mizutaniCust = allCusts.find(c => (c.properties['会社名']?.title?.[0]?.plain_text || '').includes('水谷建設'));
const MIZUTANI_REAL_ID = mizutaniCust?.id;
console.log('水谷建設ID:', MIZUTANI_REAL_ID);

let updated = 0;

for (const v of vehicles) {
  const custId = v.properties['顧客']?.relation?.[0]?.id || '';
  const memo = v.properties['メモ']?.rich_text?.[0]?.plain_text || '';
  const car = v.properties['車番']?.title?.[0]?.plain_text || '';
  let newCustId = null;
  let reason = '';

  // 1. タイヤショップミカミ → 広島IC
  if (custId === MIKAMI_ID) {
    newCustId = HIROSHIMA_IC_ID;
    reason = 'ミカミ→広島IC';
  }

  // 2. 西松建設/アクティオ依頼 → アクティオ（廿日市をデフォルト）
  if (custId === NISHIMATSU_ACTIO_ID) {
    // メモから廿日市/広島西を判別
    if (memo.includes('広島西')) newCustId = ACTIO_HIROSHIMA_ID;
    else newCustId = ACTIO_HATSUKAICHI_ID;
    reason = 'アクティオ依頼→アクティオ';
  }

  // 3. 水谷建設 → アクティオ廿日市
  if (MIZUTANI_REAL_ID && custId === MIZUTANI_REAL_ID) {
    newCustId = ACTIO_HATSUKAICHI_ID;
    reason = '水谷建設→アクティオ';
  }

  // 4. ウィラー → WILLER EXPRESS
  if (custId === WILLAA_ID) {
    newCustId = WILLER_ID;
    reason = 'ウィラー→WILLER';
  }

  // 5. 太陽建機岩国 → メモの内容で正しい拠点に振り分け
  if (custId === TAIYOKENKI_IWAKUNI_ID) {
    // デフォルトは五日市（岩国は数件のはず）
    if (memo.includes('岩国')) {
      // 本当に岩国ならそのまま
    } else {
      newCustId = TAIYOKENKI_ITSUKAICHI_ID;
      reason = '太陽建機岩国→五日市';
    }
  }

  if (newCustId) {
    try {
      await nf('PATCH', '/pages/' + v.id, { properties: { '顧客': { relation: [{ id: newCustId }] } } });
      updated++;
      if (updated % 20 === 0) console.log(`  ${updated}台修正...`);
      await sleep(150);
    } catch(e) {
      console.log(`  ❌ ${car}: ${e.message}`);
    }
  }
}

console.log();
console.log('===== 修正完了 =====');
console.log(`修正: ${updated}台`);

// いすゞを元請けとして処理（いすゞ経由の車両のエンドユーザーを探す）は別途
// 山田商事・カンサイが少ない原因も別途調査
