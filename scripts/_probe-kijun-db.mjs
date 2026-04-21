// しきい値DBのプロパティ構造を調査
import https from 'https';

const KIJUN_DB = '520fe8fa034543428c0e9fff3c5cb511'; // LTL TB ノーマルのkijunId

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

console.log('=== しきい値DB (LTL TBノーマル) のスキーマ ===');
const db = await nf('GET', '/databases/' + KIJUN_DB, null);
if (db.properties) {
  for (const [name, p] of Object.entries(db.properties)) {
    console.log('  ' + name + ': ' + p.type);
    if (p.type === 'select' && p.select?.options) {
      const opts = p.select.options.map(o => o.name).slice(0, 20);
      console.log('    options:', opts.join(', '));
    }
  }
}

// サンプルレコードも取得
console.log();
console.log('=== サンプルレコード（先頭3件） ===');
const q = await nf('POST', '/databases/' + KIJUN_DB + '/query', { page_size: 3 });
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

// 特定のM170レコードがあるかも見る
console.log();
console.log('=== M170 検索 ===');
const m170 = await nf('POST', '/databases/' + KIJUN_DB + '/query', {
  filter: { property: 'パターン名', select: { equals: 'M170' } },
  page_size: 10,
});
console.log('M170 レコード数:', (m170.results || []).length);
if (m170.object === 'error') console.log('ERROR:', m170.message);
