// 志和 M170 225/80R17.5 6本の入庫レコードをLTL TBノーマルDBに追加し、
// 発注管理DB志和レコードに納品日を設定
import https from 'https';

const ORDER_DB = '202a695f8e8880aa92f6f38d9b47b537';
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

// ① LTL TBノーマルDBに入庫レコード作成
console.log('① 在庫DB (LTL TBノーマル) に志和の入庫レコードを作成');
const stockRes = await nf('POST', '/pages', {
  parent: { database_id: LTL_NORMAL_DB },
  properties: {
    'タイトル': { title: [{ text: { content: '225/80R17.5 M170 入庫 志和倉庫' } }] },
    '区分': { select: { name: '入庫' } },
    '数量': { number: 6 },
    '倉庫': { select: { name: '志和倉庫' } },
    'サイズコード': { select: { name: '225/80R17.5' } },
    'パターン名': { select: { name: 'M170' } },
    '作成者': { select: { name: '向畑充' } },
  },
});
if (stockRes.object === 'error') { console.log('❌', stockRes.message); process.exit(1); }
console.log('✓ 入庫レコード作成:', stockRes.id);

// ② 発注管理DBの志和レコード（e9f85288-e18d-...）に納品日を設定
console.log();
console.log('② 発注管理DBの志和レコードを検索');
const findRes = await nf('POST', '/databases/' + ORDER_DB + '/query', {
  filter: { and: [
    { property: 'パターン', select: { equals: 'M170' } },
    { property: '納入予定場所', select: { equals: '志和' } },
    { property: 'ステータス', select: { equals: '納入済' } },
  ]},
  page_size: 5,
});

for (const o of (findRes.results || [])) {
  const p = o.properties;
  const nohinbi = p['納品日']?.date?.start;
  if (nohinbi) { console.log('  スキップ (納品日既設定):', o.id.slice(-12), nohinbi); continue; }
  console.log('  更新:', o.id.slice(-12), '→ 納品日=2026-04-17');
  const patchRes = await nf('PATCH', '/pages/' + o.id, {
    properties: {
      '納品日': { date: { start: '2026-04-17' } },
    },
  });
  if (patchRes.object === 'error') { console.log('  ❌', patchRes.message); }
  else console.log('  ✓ 更新成功');
}

console.log();
console.log('=== 完了 ===');
