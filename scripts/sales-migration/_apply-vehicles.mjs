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
const VEHICLE_DB = '16f9f0df45e942069e032715fb2d37b2';

// 1. 既存車両マスタ取得
console.log('既存車両マスタを取得中...');
const existing = new Map(); // 車番 → pageId
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${VEHICLE_DB}/query`, body);
  (r.results || []).forEach(p => {
    const car = p.properties['車番']?.title?.[0]?.plain_text || '';
    if (car) existing.set(car, p.id);
  });
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log(`  既存: ${existing.size}台`);

// 2. 車両データ読み込み
const data = JSON.parse(fs.readFileSync('_vehicle-rebuild.json', 'utf8'));
console.log(`  投入データ: ${data.length}台`);

// 3. 登録/更新
let created = 0, updated = 0, errors = 0;
for (let i = 0; i < data.length; i++) {
  const v = data[i];
  const props = {
    '車番': { title: [{ text: { content: v.car } }] },
  };
  if (v.mainSize) props['前輪サイズ'] = { rich_text: [{ text: { content: v.mainSize } }] };
  if (v.cat) {
    try { props['タイヤカテゴリ'] = { select: { name: v.cat } }; } catch(e) {}
  }
  if (v.type) {
    try { props['車種'] = { select: { name: v.type } }; } catch(e) {}
  }
  // エンドユーザーのみ（元請けは入れない）
  if (v.custId) {
    props['顧客'] = { relation: [{ id: v.custId }] };
  } else {
    // 元請けのみの場合は顧客を空にする（既存の元請けリレーションを解除）
    props['顧客'] = { relation: [] };
  }
  if (v.memo) {
    props['メモ'] = { rich_text: [{ text: { content: v.memo.slice(0, 2000) } }] };
  }

  try {
    if (existing.has(v.car)) {
      // 更新
      await nf('PATCH', `/pages/${existing.get(v.car)}`, { properties: props });
      updated++;
    } else {
      // 新規
      await nf('POST', '/pages', { parent: { database_id: VEHICLE_DB }, properties: props });
      created++;
    }
    if ((created + updated) % 50 === 0) console.log(`  ${created + updated}/${data.length} (新規:${created} 更新:${updated})`);
    await sleep(200);
  } catch(e) {
    errors++;
    console.log(`  ❌ ${v.car}: ${e.message}`);
  }
}

console.log();
console.log('===== 結果 =====');
console.log(`新規作成: ${created}台`);
console.log(`更新: ${updated}台`);
console.log(`エラー: ${errors}件`);
