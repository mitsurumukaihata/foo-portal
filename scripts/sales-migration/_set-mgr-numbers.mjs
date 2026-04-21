import https from 'https';

function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>{ try { res(JSON.parse(c)); } catch(e) { rej(new Error('Parse: ' + c.slice(0,100))); } }); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';

// 管理番号パターン: RGA, RGC, RHA, TTM, TLB, TBL, TTI, TT1, TT2, GA, NKE 等
const mgrPattern = /^([A-Z]{2,5}[\-]?\d{3,}[A-Z0-9]*)$/i;

// ── 1. 全伝票から車番→管理番号マップを構築 ──
console.log('売上伝票を取得中...');
const allSlips = [];
let cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${SALES_DB}/query`, body); allSlips.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);
console.log(`  伝票: ${allSlips.length}件`);

// 車番 → Set of 管理番号
const carMgrMap = new Map();

let processed = 0;
for (const slip of allSlips) {
  const mainCar = slip.properties['車番']?.rich_text?.[0]?.plain_text || '';
  if (!mainCar) { processed++; continue; }

  const detailRes = await nf('POST', `/databases/${DETAIL_DB}/query`, {
    filter: { property: '売上伝票', relation: { contains: slip.id } },
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    page_size: 50,
  });
  await sleep(100);

  for (const d of (detailRes.results || [])) {
    const bikou = d.properties['弥生備考']?.rich_text?.[0]?.plain_text || '';
    if (!bikou) continue;

    // 管理番号チェック（RGA03208, TTM-4216, TLB-5841, GA01587 等）
    // km付きも除去 (RGA02654 はOK, 204816km はNG)
    const cleaned = bikou.replace(/\/\d+(km)?$/i, '').trim();
    if (mgrPattern.test(cleaned)) {
      if (!carMgrMap.has(mainCar)) carMgrMap.set(mainCar, new Set());
      carMgrMap.get(mainCar).add(cleaned);
    }
  }

  processed++;
  if (processed % 500 === 0) console.log(`  ${processed}/${allSlips.length}`);
}

console.log(`  管理番号がある車番: ${carMgrMap.size}台`);

// サンプル表示
console.log();
console.log('--- 管理番号サンプル ---');
let shown = 0;
for (const [car, mgrs] of carMgrMap) {
  if (shown >= 30) break;
  console.log(`  ${car} → ${[...mgrs].join(', ')}`);
  shown++;
}

// ── 2. 車両マスタに管理番号を設定 ──
console.log();
console.log('車両マスタを取得中...');
const vehicles = [];
cursor = null;
do { const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor; const r = await nf('POST', `/databases/${VEHICLE_DB}/query`, body); vehicles.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : null; } while (cursor);

const carToVehicleId = new Map();
vehicles.forEach(v => {
  const car = v.properties['車番']?.title?.[0]?.plain_text || '';
  if (car) carToVehicleId.set(car, v.id);
});

console.log('車両マスタに管理番号を設定中...');
let updated = 0, notFound = 0;
for (const [car, mgrs] of carMgrMap) {
  const vid = carToVehicleId.get(car);
  if (!vid) { notFound++; continue; }

  const mgrStr = [...mgrs].join(', ');
  try {
    await nf('PATCH', '/pages/' + vid, {
      properties: { '管理番号': { rich_text: [{ text: { content: mgrStr } }] } }
    });
    updated++;
    if (updated % 50 === 0) console.log(`  ${updated}/${carMgrMap.size}`);
    await sleep(200);
  } catch(e) {
    console.log(`  ❌ ${car}: ${e.message}`);
  }
}

console.log();
console.log('===== 結果 =====');
console.log(`管理番号設定: ${updated}台`);
console.log(`車両マスタ未登録: ${notFound}台`);
