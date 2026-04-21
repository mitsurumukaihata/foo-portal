// M170 に関連する全在庫DBの今日(4/17)の入庫レコードを探す
import https from 'https';

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

const DBS = {
  'LTL TB ノーマル': '200a695f8e888018b5f5eac83fdad412',
  'LTL TB スタッドレス': '201a695f8e888171abb8e349ad4d055a',
  'LTS ノーマル': '201a695f8e8881adb144cd3a1639132d',
  'LTS スタッドレス': '201a695f8e8881a299e8fb57bad707f6',
  'RT 再生': '201a695f8e888104bb47c7103d5909dc',
  'T/T チューブ': '201a695f8e8881a6930fcf2bd752e676',
  'バン': '201a695f8e8881f3a958cead42156e07',
};

for (const [name, dbId] of Object.entries(DBS)) {
  console.log('=== ' + name + ' / 4/17に作成された M170関連 ===');
  const res = await nf('POST', '/databases/' + dbId + '/query', {
    filter: { and: [
      { property: 'パターン名', select: { equals: 'M170' } },
      { timestamp: 'created_time', created_time: { on_or_after: '2026-04-17T00:00:00.000Z' } },
    ]},
    page_size: 20,
  });
  const results = res.results || [];
  if (results.length === 0) { console.log('  (なし)'); continue; }
  for (const o of results) {
    const p = o.properties;
    const warehouseField = p['倉庫']?.select?.name || p['出庫倉庫']?.select?.name || '(不明)';
    console.log('  ', {
      created: o.created_time,
      タイトル: p['タイトル']?.title?.[0]?.plain_text,
      区分: p['区分']?.select?.name,
      数量: p['数量']?.number,
      倉庫: warehouseField,
      サイズ: p['サイズコード']?.select?.name,
    });
  }
  console.log();
}

// 発注管理DBで M170の志和の詳細
console.log('=== 発注管理DB: M170志和の詳細 ===');
const o = await nf('POST', '/pages/e9f85288-e18d-443d-b44f-87f05b09af73', null);
// ↑ 知らないから一旦以下でクエリ
const qres = await nf('POST', '/databases/202a695f8e8880aa92f6f38d9b47b537/query', {
  filter: { and: [
    { property: 'パターン', select: { equals: 'M170' } },
    { property: '納入予定場所', select: { equals: '志和' } },
  ]},
  page_size: 5,
});
for (const x of (qres.results || [])) {
  console.log(JSON.stringify(x.properties, null, 2).slice(0, 2000));
}
