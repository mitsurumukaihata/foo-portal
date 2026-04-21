// SNAPSHOT_DB のスキーマを調査
import https from 'https';

const SNAPSHOT_DB = '1123c46301764238a511114ed59159bd';

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

console.log('=== SNAPSHOT_DB のスキーマ ===');
const db = await nf('GET', '/databases/' + SNAPSHOT_DB, null);
if (db.properties) {
  for (const [name, p] of Object.entries(db.properties)) {
    console.log('  ' + name + ': ' + p.type);
    if (p.type === 'select' && p.select?.options) {
      const opts = p.select.options.map(o => o.name).slice(0, 20);
      console.log('    options:', opts.join(', '));
    }
  }
}

// サンプル取得
console.log();
console.log('=== サンプルレコード ===');
const q = await nf('POST', '/databases/' + SNAPSHOT_DB + '/query', { page_size: 3 });
for (const p of (q.results || [])) {
  console.log();
  for (const [k, v] of Object.entries(p.properties)) {
    let val;
    if (v.type === 'title') val = v.title?.[0]?.plain_text;
    else if (v.type === 'select') val = v.select?.name;
    else if (v.type === 'number') val = v.number;
    else if (v.type === 'rich_text') val = v.rich_text?.[0]?.plain_text;
    else val = '(' + v.type + ')';
    console.log('  ' + k + ' = ' + val);
  }
}

// M170があるか
console.log();
console.log('=== M170 検索 ===');
const m = await nf('POST', '/databases/' + SNAPSHOT_DB + '/query', {
  filter: { property: 'パターン名', rich_text: { equals: 'M170' } },
  page_size: 10,
});
console.log('M170 件数:', (m.results || []).length);
for (const p of (m.results || [])) {
  console.log('  ', {
    id: p.id.slice(-12),
    カテゴリ: p.properties['カテゴリ']?.select?.name,
    パターン名: p.properties['パターン名']?.rich_text?.[0]?.plain_text,
    サイズコード: p.properties['サイズコード']?.rich_text?.[0]?.plain_text,
    倉庫: p.properties['倉庫']?.select?.name,
    しきい値: p.properties['しきい値']?.number,
  });
}
