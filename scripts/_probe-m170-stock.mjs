// LTL TBノーマルDBで M170 225/80R17.5 の全レコードを確認
import https from 'https';

const LTL_NORMAL_DB = '200a695f8e888018b5f5eac83fdad412';

function nf(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
      let c = '';
      r.on('data', x => c += x);
      r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { rej(new Error(c.slice(0, 500))); } });
    });
    req.on('error', rej);
    if (d) req.write(d);
    req.end();
  });
}

// パターン名=M170 のすべて（サイズ問わず）
console.log('=== LTL TBノーマルDB: M170 全サイズ ===');
let all = [];
let cursor = null;
do {
  const body = {
    filter: { property: 'パターン名', select: { equals: 'M170' } },
    page_size: 100,
  };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + LTL_NORMAL_DB + '/query', body);
  all.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('件数:', all.length);
for (const o of all) {
  const p = o.properties;
  console.log({
    id: o.id.slice(-12),
    created: o.created_time?.slice(0,16),
    タイトル: p['タイトル']?.title?.[0]?.plain_text,
    区分: p['区分']?.select?.name,
    数量: p['数量']?.number,
    倉庫: p['倉庫']?.select?.name,
    サイズコード: p['サイズコード']?.select?.name,
    パターン名: p['パターン名']?.select?.name,
    archived: o.archived,
  });
}

console.log();
console.log('=== サイズコード="225/80R17.5" でフィルタ ===');
const sized = all.filter(o => o.properties['サイズコード']?.select?.name === '225/80R17.5');
console.log('件数:', sized.length);

// 倉庫ごと区分ごとの集計
const agg = {};
for (const o of sized) {
  const p = o.properties;
  const wh = p['倉庫']?.select?.name || '(空)';
  const kb = p['区分']?.select?.name || '(空)';
  const qty = p['数量']?.number || 0;
  if (!agg[wh]) agg[wh] = {};
  if (!agg[wh][kb]) agg[wh][kb] = 0;
  // 区分の符号（入庫: +, 出庫: -, 繰越: +, 準備: -, 発注中: 無視）
  const sign = (kb === '入庫' || kb === '繰越') ? 1 : (kb === '出庫' || kb === '準備' ? -1 : 0);
  agg[wh][kb] += qty;
}
console.log('倉庫×区分別 合計:');
for (const [wh, kbs] of Object.entries(agg)) {
  console.log('  ' + wh + ':', kbs);
}

// 在庫計算
console.log();
console.log('=== 在庫数計算 ===');
for (const [wh, kbs] of Object.entries(agg)) {
  let stock = 0;
  for (const [kb, qty] of Object.entries(kbs)) {
    if (kb === '入庫' || kb === '繰越') stock += qty;
    else if (kb === '出庫' || kb === '準備') stock -= qty;
  }
  console.log('  ' + wh + ' 在庫:', stock, '本');
}
