import https from 'https';

function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev', path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>res(JSON.parse(c))); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

// 1. 車番がある全伝票を取得
console.log('売上伝票を取得中...');
const allSlips = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  allSlips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

// 車番がある伝票を抽出
const slipsWithCar = allSlips.filter(s => {
  const car = s.properties['車番']?.rich_text?.[0]?.plain_text || '';
  return car.length > 0;
});
console.log('全伝票:', allSlips.length, '/ 車番あり:', slipsWithCar.length);

// 2. 各伝票の明細からタイヤサイズを取得
console.log('明細からタイヤサイズを抽出中...');
const vehicleMap = new Map(); // 車番 → { sizes: Set, customers: Set, qty: number }

for (const slip of slipsWithCar) {
  const car = slip.properties['車番']?.rich_text?.[0]?.plain_text || '';
  const custId = slip.properties['顧客名']?.relation?.[0]?.id || '';

  // 明細を取得
  const detailRes = await nf('POST', `/databases/${DETAIL_DB}/query`, {
    filter: { property: '売上伝票', relation: { contains: slip.id } },
    page_size: 50,
  });
  await sleep(200);

  const details = detailRes.results || [];
  for (const d of details) {
    const dp = d.properties;
    const size = dp['タイヤサイズ']?.rich_text?.[0]?.plain_text || '';
    const hinmoku = dp['品目']?.select?.name || '';
    const qty = dp['数量']?.number || 0;

    // タイヤ販売の明細のみ（組替/脱着/出張等は除外）
    if (!size) continue;
    if (!hinmoku.includes('タイヤ') && hinmoku !== 'f.o.oパック') continue;

    if (!vehicleMap.has(car)) vehicleMap.set(car, { sizes: new Set(), customers: new Set(), maxQty: 0 });
    const v = vehicleMap.get(car);
    v.sizes.add(size);
    if (custId) v.customers.add(custId);
    if (qty > v.maxQty) v.maxQty = qty;
  }
}

console.log('ユニーク車番（タイヤサイズ判明）:', vehicleMap.size);
console.log();

// 3. 結果を表示
const sorted = [...vehicleMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
sorted.forEach(([car, v]) => {
  const sizes = [...v.sizes].join(', ');
  console.log(car.padEnd(22) + ' | サイズ: ' + sizes.padEnd(30) + ' | 最大本数: ' + v.maxQty);
});

console.log();
console.log('合計:', vehicleMap.size, '台');
