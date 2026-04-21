import https from 'https';
import fs from 'fs';

function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>res(JSON.parse(c))); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const CUST_DB = '1ca8d122be214e3892879932147143c9';
const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';

// ── 1. 顧客情報DB ──
console.log('顧客情報DBを取得中...');
const custs = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${CUST_DB}/query`, body);
  custs.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

const custIdToName = new Map();
const custNameToId = new Map();
const motoukeIds = new Set();

function normCust(s) {
  return s.replace(/[\s　]/g,'').replace(/様$/,'').replace(/[(（]株[)）]|株式会社|㈱/g,'').replace(/[(（]有[)）]|有限会社|㈲/g,'').toLowerCase();
}

custs.forEach(c => {
  const name = c.properties['会社名']?.title?.[0]?.plain_text || '';
  custIdToName.set(c.id, name);
  const n = normCust(name);
  if (n.length > 1) custNameToId.set(n, c.id);
  if (/ﾄｰﾖｰﾀｲﾔ|トーヨータイヤ|TOYO/i.test(name) || /ふそう|三菱ふそう/.test(name) || /ブリヂストン|BRIDGESTONE/i.test(name) || /ダンロップ|DUNLOP/i.test(name)) {
    motoukeIds.add(c.id);
  }
});
console.log(`  顧客: ${custs.length}件, 元請け: ${motoukeIds.size}件`);

// ── 2. 全売上伝票取得 ──
console.log('売上伝票を取得中...');
const allSlips = [];
cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  allSlips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log(`  伝票: ${allSlips.length}件`);

// ── 3. 車番ごとの情報を収集 ──
console.log('車両情報を収集中...');
const vehicleMap = new Map();

function ensureVehicle(car) {
  if (!vehicleMap.has(car)) vehicleMap.set(car, { sizes: new Set(), custIds: new Set(), bikous: new Set(), latestDate: '' });
  return vehicleMap.get(car);
}

// 車番パターン
const carPatternRe = /([ぁ-んァ-ヶー一-龥]{1,4}\d{3}[ぁ-んa-zA-Zァ-ヶ]\s?\d{1,4}(?:-\d{1,4})?)/;

let processed = 0;
for (const slip of allSlips) {
  const mainCar = slip.properties['車番']?.rich_text?.[0]?.plain_text || '';
  const custId = slip.properties['顧客名']?.relation?.[0]?.id || '';
  const date = slip.properties['売上日']?.date?.start || '';

  const detailRes = await nf('POST', `/databases/${DETAIL_DB}/query`, {
    filter: { property: '売上伝票', relation: { contains: slip.id } },
    page_size: 50,
  });
  await sleep(100);

  for (const d of (detailRes.results || [])) {
    const dp = d.properties;
    const size = dp['タイヤサイズ']?.rich_text?.[0]?.plain_text || '';
    const bikou = dp['弥生備考']?.rich_text?.[0]?.plain_text || '';
    const hinmoku = dp['品目']?.select?.name || '';

    if (mainCar) {
      const v = ensureVehicle(mainCar);
      if (size && (hinmoku.includes('タイヤ') || hinmoku === 'f.o.oパック' || hinmoku === '組替' || hinmoku === '脱着' || hinmoku === 'バランス')) {
        v.sizes.add(size);
      }
      if (custId) v.custIds.add(custId);
      if (date > v.latestDate) v.latestDate = date;
    }

    if (bikou) {
      const carMatch = bikou.match(carPatternRe);
      if (carMatch) {
        const bikouCar = carMatch[1].replace(/\s/g, '');
        if (bikouCar !== mainCar) {
          const bv = ensureVehicle(bikouCar);
          if (size) bv.sizes.add(size);
          if (custId) bv.custIds.add(custId);
          if (date > bv.latestDate) bv.latestDate = date;
          bv.bikous.add(mainCar + '伝票の備考から取得');
        }
      }
      if (mainCar && !carMatch) {
        const cleaned = bikou.replace(/^\d{4,}(km)?$/i, '').replace(/^[A-Z]{2,5}\d{4,}.*$/i, '').replace(/^[￥¥]\d+.*$/, '').replace(/^№\d+$/, '').replace(/^外し.*$/, '').trim();
        if (cleaned && !/^\d{1,5}(-\d{1,5})?$/.test(cleaned)) {
          ensureVehicle(mainCar).bikous.add(cleaned);
        }
      }
    }
  }

  processed++;
  if (processed % 300 === 0) console.log(`  ${processed}/${allSlips.length}`);
}
console.log(`  車両数: ${vehicleMap.size}台`);

// ── 4. エンドユーザー特定 + 結果生成 ──
console.log('エンドユーザーを特定中...');

function guessCategory(size) {
  if (!size) return { cat: null, type: null };
  if (/R22\.5|R19\.5/.test(size)) return { cat: 'LTL TB ノーマル', type: '大型' };
  if (/R17\.5|205\/85R16|195\/85R16|215\/85R16|225\/85R16|195\/85R15|205\/80R15|185\/85R16/.test(size)) return { cat: 'LTS', type: '中型' };
  if (/195\/75R15|205\/75R16|205\/70R16|185\/75R15|195\/80R15|205\/70R17\.5|225\/70R16|175\/75R15/.test(size)) return { cat: 'LTS', type: '小型' };
  if (/145\/80R12|145R12|165R1[34]|155\/80R14|165\/80R1[34]|175\/80R14/.test(size)) return { cat: 'バン', type: 'バン' };
  if (/R1[3-8]/.test(size) && !/R17\.5/.test(size)) return { cat: null, type: 'その他' };
  if (/700R16/.test(size)) return { cat: 'T-T', type: 'その他' };
  return { cat: null, type: null };
}

const results = [];
for (const [car, v] of vehicleMap) {
  let endUserId = null;
  let motoId = null;
  for (const cid of v.custIds) {
    if (motoukeIds.has(cid)) { motoId = cid; }
    else { endUserId = cid; }
  }

  // 弥生備考からエンドユーザーマッチ
  let bikouMatchId = null;
  let bikouUserName = '';
  for (const b of v.bikous) {
    if (b.includes('伝票の備考から取得')) continue;
    const bn = normCust(b);
    if (bn.length < 2) continue;
    if (custNameToId.has(bn)) { bikouMatchId = custNameToId.get(bn); bikouUserName = b; break; }
    for (const [cn, cid] of custNameToId) {
      if (cn.length > 3 && (bn.includes(cn) || cn.includes(bn))) { bikouMatchId = cid; bikouUserName = b; break; }
    }
    if (bikouMatchId) break;
  }

  const finalCustId = endUserId || bikouMatchId || null;

  const sizes = [...v.sizes];
  const mainSize = sizes[0] || '';
  const guess = guessCategory(mainSize);

  const bikouArr = [...v.bikous].filter(b => !b.includes('伝票の備考から取得'));
  const memoLines = [];
  if (bikouArr.length > 0) memoLines.push('弥生備考: ' + bikouArr.join(', '));
  if (sizes.length > 1) memoLines.push('サイズ: ' + sizes.join(', '));
  if (motoId) memoLines.push('元請け: ' + (custIdToName.get(motoId) || ''));

  results.push({
    car,
    custId: finalCustId,
    custName: finalCustId ? (custIdToName.get(finalCustId) || '') : '',
    motoId,
    motoName: motoId ? (custIdToName.get(motoId) || '') : '',
    mainSize,
    sizes,
    cat: guess.cat,
    type: guess.type,
    memo: memoLines.join(' / '),
  });
}

let withEnd = results.filter(r => r.custId).length;
let motoOnly = results.filter(r => !r.custId && r.motoId).length;
let neither = results.filter(r => !r.custId && !r.motoId).length;
console.log(`  エンドユーザー特定: ${withEnd}台`);
console.log(`  元請けのみ(顧客空): ${motoOnly}台`);
console.log(`  顧客なし: ${neither}台`);
console.log(`  合計: ${results.length}台`);

fs.writeFileSync('_vehicle-rebuild.json', JSON.stringify(results, null, 2));
console.log('_vehicle-rebuild.json に保存');
