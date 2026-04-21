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
const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';

// タイヤサイズからカテゴリ・車種を推定
function guessCategory(size) {
  if (!size) return { cat: null, type: null };
  // TB (大型): 275/80R22.5, 295/80R22.5, 11R22.5, 245/70R19.5, 265/70R19.5 等
  if (/R22\.5|R19\.5/.test(size)) return { cat: 'LTL TB ノーマル', type: '大型' };
  // LTS (中型): 225/80R17.5, 225/90R17.5, 205/85R16, 195/85R16, 215/70R17.5 等
  if (/R17\.5|205\/85R16|195\/85R16|215\/85R16|225\/85R16|195\/85R15|205\/80R15|185\/85R16/.test(size)) return { cat: 'LTS', type: '中型' };
  // LTS小型: 195/75R15, 205/75R16, 205/70R16, 185/75R15, 195/80R15, 205/70R17.5 等
  if (/195\/75R15|205\/75R16|205\/70R16|185\/75R15|195\/80R15|205\/70R17\.5|225\/70R16|175\/75R15/.test(size)) return { cat: 'LTS', type: '小型' };
  // バン: 145/80R12, 145R12, 165R13, 165R14, 155/80R14, 165/80R13, 165/80R14
  if (/145\/80R12|145R12|165R1[34]|155\/80R14|165\/80R1[34]|175\/80R14/.test(size)) return { cat: 'バン', type: 'バン' };
  // 乗用車: 上記以外の小さいサイズ
  if (/R1[3-8]/.test(size) && !/R17\.5/.test(size)) return { cat: null, type: 'その他' };
  // 700R16 = リフト系
  if (/700R16/.test(size)) return { cat: 'T-T', type: 'その他' };
  return { cat: null, type: null };
}

// 1. 売上データから車両情報を抽出
console.log('売上データから車両情報を抽出中...');
const allSlips = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  allSlips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

const vehicleMap = new Map();
for (const slip of allSlips) {
  const car = slip.properties['車番']?.rich_text?.[0]?.plain_text || '';
  if (!car) continue;
  const custId = slip.properties['顧客名']?.relation?.[0]?.id || '';

  const detailRes = await nf('POST', `/databases/${DETAIL_DB}/query`, {
    filter: { property: '売上伝票', relation: { contains: slip.id } },
    page_size: 50,
  });
  await sleep(200);

  for (const d of (detailRes.results || [])) {
    const dp = d.properties;
    const size = dp['タイヤサイズ']?.rich_text?.[0]?.plain_text || '';
    const hinmoku = dp['品目']?.select?.name || '';
    if (!size) continue;
    if (!hinmoku.includes('タイヤ') && hinmoku !== 'f.o.oパック') continue;
    if (!vehicleMap.has(car)) vehicleMap.set(car, { sizes: new Set(), custId: '', maxQty: 0 });
    const v = vehicleMap.get(car);
    v.sizes.add(size);
    if (custId) v.custId = custId;
  }
}
console.log('車両数:', vehicleMap.size);

// 2. 既存の車両マスタをチェック（重複防止）
console.log('既存の車両マスタを確認中...');
const existing = new Set();
cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${VEHICLE_DB}/query`, body);
  (r.results || []).forEach(p => {
    const car = p.properties['車番']?.title?.[0]?.plain_text || '';
    if (car) existing.add(car);
  });
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('既存登録:', existing.size, '台');

// 3. 新規のみ登録
let created = 0, skipped = 0;
for (const [car, v] of vehicleMap) {
  if (existing.has(car)) { skipped++; continue; }

  const sizes = [...v.sizes];
  const mainSize = sizes[0]; // 最初に出てきたサイズを前輪に
  const guess = guessCategory(mainSize);

  const props = {
    '車番': { title: [{ text: { content: car } }] },
    '前輪サイズ': { rich_text: [{ text: { content: mainSize } }] },
  };
  if (sizes.length > 1) {
    // 複数サイズがある場合はメモに記録
    props['メモ'] = { rich_text: [{ text: { content: '売上データから取得。サイズ: ' + sizes.join(', ') } }] };
  }
  if (guess.cat) {
    try { props['タイヤカテゴリ'] = { select: { name: guess.cat } }; } catch(e) {}
  }
  if (guess.type) {
    try { props['車種'] = { select: { name: guess.type } }; } catch(e) {}
  }
  if (v.custId) {
    props['顧客'] = { relation: [{ id: v.custId }] };
  }

  try {
    await nf('POST', '/pages', { parent: { database_id: VEHICLE_DB }, properties: props });
    created++;
    if (created % 20 === 0) console.log('  ' + created + '台登録...');
    await sleep(350);
  } catch(e) {
    console.log('  ❌ ' + car + ': ' + e.message);
  }
}

console.log();
console.log('=== 結果 ===');
console.log('新規登録:', created, '台');
console.log('スキップ（既存）:', skipped, '台');
