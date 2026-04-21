import https from 'https';
import fs from 'fs';

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
  if (!vehicleMap.has(car)) vehicleMap.set(car, { sizes: new Set(), custIds: new Set(), endUserNames: [], bikous: new Set(), latestDate: '' });
  return vehicleMap.get(car);
}

const carPatternRe = /^([ぁ-んァ-ヶー一-龥]{1,4}\d{3}[ぁ-んa-zA-Zァ-ヶ]\s?\d{1,4}(?:-\d{1,4})?)$/;

// 弥生備考がユーザー名かどうか判定
function isUserName(bikou) {
  if (!bikou || bikou.length < 2) return false;
  // 車番パターン
  if (/[ぁ-んァ-ヶー一-龥]{1,4}\d{3}[ぁ-んa-zA-Zァ-ヶ]/.test(bikou)) return false;
  // 数字のみ / km / 管理番号 / 数字+km混合
  if (/^\d{1,8}(km|㎞)?$/i.test(bikou)) return false;
  if (/^\d{1,5}(-\d{1,5})?$/.test(bikou)) return false;
  if (/^\d+\/\d+/.test(bikou)) return false;
  if (/\d{4,}km/i.test(bikou)) return false;
  // RGA/RGC/TTM/GA/TLB等の機械番号
  if (/^[A-Z]{1,5}\d{3,}/i.test(bikou)) return false;
  if (/^[A-Z]-\d{3,}/i.test(bikou)) return false;
  // ￥金額
  if (/^[￥¥]/.test(bikou)) return false;
  // №番号
  if (/^№/.test(bikou)) return false;
  // 外し / 外し含む
  if (/外し/.test(bikou)) return false;
  // 型式
  if (/^型式/.test(bikou)) return false;
  // STL
  if (/^STL/.test(bikou)) return false;
  // 廃タイヤ
  if (/^廃タイヤ/.test(bikou)) return false;
  // 営業車 / マイクロバス / ハイエース等の車種メモ
  if (/^(営業車|マイクロバス|ハイエース|トレーラー|3軸|4軸|増ｔ|[234]ｔ|トラック)/.test(bikou)) return false;
  // 都道府県名のみ（オークション）
  if (/^(北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)(県|都|府)?$/.test(bikou)) return false;
  // R：はきつぶし / fooパック等のメモ
  if (/^R[：:]/.test(bikou)) return false;
  if (/^fooパック$/i.test(bikou)) return false;
  // 「○○分」(数字+分)
  if (/^\d+分$/.test(bikou)) return false;
  // 数字6桁+/+外し等の複合パターン
  if (/^\d{5,}\//.test(bikou)) return false;
  // 作業メモ系
  if (/^作業車/.test(bikou)) return false;
  if (/^No\.\d/i.test(bikou)) return false;
  if (/^\d+台分/.test(bikou)) return false;
  if (/\d{4}\.\d{1,2}\.\d{1,2}作業/.test(bikou)) return false;
  // CYJ/FTR等の車体型式
  if (/^[A-Z]{2,4}\d{2,}[A-Z]/.test(bikou)) return false;
  return true;
}

let processed = 0;
let multiUserSlips = []; // 1伝票に複数ユーザー名がある場合

for (const slip of allSlips) {
  const mainCar = slip.properties['車番']?.rich_text?.[0]?.plain_text || '';
  const custId = slip.properties['顧客名']?.relation?.[0]?.id || '';
  const date = slip.properties['売上日']?.date?.start || '';
  const isMoto = motoukeIds.has(custId);
  const title = slip.properties['名前']?.title?.[0]?.plain_text || '';

  const detailRes = await nf('POST', `/databases/${DETAIL_DB}/query`, {
    filter: { property: '売上伝票', relation: { contains: slip.id } },
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    page_size: 50,
  });
  await sleep(100);

  const details = detailRes.results || [];

  // この伝票内のユーザー名と備考内車番を収集
  const slipUserNames = [];
  const slipSubCars = [];

  for (const d of details) {
    const dp = d.properties;
    const size = dp['タイヤサイズ']?.rich_text?.[0]?.plain_text || '';
    const bikou = dp['弥生備考']?.rich_text?.[0]?.plain_text || '';
    const hinmoku = dp['品目']?.select?.name || '';

    // メイン車番に情報追加
    if (mainCar) {
      const v = ensureVehicle(mainCar);
      if (size && (hinmoku.includes('タイヤ') || hinmoku === 'f.o.oパック' || hinmoku === '組替' || hinmoku === '脱着' || hinmoku === 'バランス')) {
        v.sizes.add(size);
      }
      if (custId) v.custIds.add(custId);
      if (date > v.latestDate) v.latestDate = date;
    }

    // 弥生備考の解析
    if (bikou) {
      // 車番パターンの場合 → 個別車両登録（後でエンドユーザー名を設定）
      const carMatch = bikou.match(/^([ぁ-んァ-ヶー一-龥]{1,4}\d{3}[ぁ-んa-zA-Zァ-ヶ]\s?\d{1,4}(?:-\d{1,4})?)$/);
      if (carMatch) {
        const bikouCar = carMatch[1].replace(/\s/g, '');
        if (bikouCar !== mainCar) {
          const bv = ensureVehicle(bikouCar);
          if (size) bv.sizes.add(size);
          if (custId) bv.custIds.add(custId);
          if (date > bv.latestDate) bv.latestDate = date;
          bv.bikous.add(mainCar + '伝票の備考');
          slipSubCars.push(bikouCar);
        }
      }
      // ユーザー名の場合 → 伝票のエンドユーザー
      else if (isUserName(bikou)) {
        const cleaned = bikou.replace(/様$/, '').trim();
        if (cleaned.length >= 2) {
          slipUserNames.push(cleaned);
        }
      }
    }
  }

  // この伝票のエンドユーザー名を、メイン車番＋備考内の全車番に設定
  const uniqueNames = [...new Set(slipUserNames)];
  if (uniqueNames.length > 0) {
    // メイン車番
    if (mainCar) {
      const mv = ensureVehicle(mainCar);
      uniqueNames.forEach(n => mv.endUserNames.push(n));
    }
    // 備考内の車番にも同じエンドユーザーを設定
    for (const subCar of slipSubCars) {
      const sv = ensureVehicle(subCar);
      uniqueNames.forEach(n => sv.endUserNames.push(n));
    }
  }

  // 1伝票に複数のユニークユーザー名がある場合を記録
  if (uniqueNames.length > 1) {
    multiUserSlips.push({ title, car: mainCar, cust: custIdToName.get(custId) || '', users: uniqueNames, subCars: slipSubCars });
  }

  processed++;
  if (processed % 300 === 0) console.log(`  ${processed}/${allSlips.length}`);
}
console.log(`  車両数: ${vehicleMap.size}台`);

// 複数ユーザー名がある伝票を報告
if (multiUserSlips.length > 0) {
  console.log();
  console.log(`⚠️ 1伝票に複数ユーザー名: ${multiUserSlips.length}件`);
  multiUserSlips.forEach(s => {
    console.log(`  ${s.title || s.car} | 顧客: ${s.cust} | ユーザー: ${s.users.join(' / ')}`);
  });
}

// ── 4. エンドユーザー特定 + 結果生成 ──
console.log();
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

function matchCustByName(name) {
  const nn = normCust(name);
  if (nn.length < 2) return null;
  if (custNameToId.has(nn)) return custNameToId.get(nn);
  for (const [cn, cid] of custNameToId) {
    if (cn.length > 2 && (nn.includes(cn) || cn.includes(nn))) return cid;
  }
  return null;
}

const results = [];
for (const [car, v] of vehicleMap) {
  // Step1: 伝票の顧客から元請け以外を探す
  let endUserId = null;
  let motoId = null;
  for (const cid of v.custIds) {
    if (motoukeIds.has(cid)) { motoId = cid; }
    else { endUserId = cid; }
  }

  // Step2: 弥生備考のエンドユーザー名からマッチ（最初のものを優先）
  let bikouMatchId = null;
  let bikouUserName = '';
  const uniqueEndUsers = [...new Set(v.endUserNames)];
  for (const name of uniqueEndUsers) {
    const mid = matchCustByName(name);
    if (mid && !motoukeIds.has(mid)) {
      bikouMatchId = mid;
      bikouUserName = name;
      break;
    }
  }

  // Step3: 最終顧客
  const finalCustId = endUserId || bikouMatchId || null;

  const sizes = [...v.sizes];
  const mainSize = sizes[0] || '';
  const guess = guessCategory(mainSize);

  // メモ構築
  const memoLines = [];
  if (uniqueEndUsers.length > 0) memoLines.push('エンドユーザー: ' + uniqueEndUsers.join(', '));
  if (sizes.length > 1) memoLines.push('サイズ: ' + sizes.join(', '));
  if (motoId) memoLines.push('元請け: ' + (custIdToName.get(motoId) || ''));
  const fromBikou = [...v.bikous].filter(b => b.includes('伝票の備考'));
  if (fromBikou.length > 0) memoLines.push('(' + fromBikou[0] + ')');

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
    endUserNames: uniqueEndUsers,
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
