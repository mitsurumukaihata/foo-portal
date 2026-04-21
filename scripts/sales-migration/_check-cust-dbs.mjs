// 顧客情報DBと得意先マスタの両方でFOOパック得意先を検索
import https from 'https';

const CUST_INFO = '1ca8d122be214e3892879932147143c9'; // 顧客情報DB
const TOKUI_MASTER = 'f632f512f12d49b2b11f2b3e45c70aec'; // 得意先マスタ

function nf(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
      let c = '';
      r.on('data', x => c += x);
      r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { rej(new Error(c.slice(0,200))); } });
    });
    req.on('error', rej);
    if (d) req.write(d);
    req.end();
  });
}

const names = ['CLO', 'K&M', 'アオイ', 'シンヨー', 'テイクス', 'ヨシダ', 'よしだ', '建機', '彩希'];

for (const db of [
  { id: CUST_INFO, name: '顧客情報DB (1ca8d122)' },
  { id: TOKUI_MASTER, name: '得意先マスタ (f632f512)' },
]) {
  console.log('━━━', db.name, '━━━');
  // まずプロパティを確認するために1件取得
  const schema = await nf('POST', '/databases/' + db.id + '/query', { page_size: 3 });
  if (schema.results && schema.results[0]) {
    console.log('  プロパティ:', Object.keys(schema.results[0].properties).join(', '));
    // titleプロパティを探す
    let titleProp = null;
    for (const [k, v] of Object.entries(schema.results[0].properties)) {
      if (v.type === 'title') { titleProp = k; break; }
    }
    console.log('  titleプロパティ:', titleProp);
    for (const n of names) {
      const r = await nf('POST', '/databases/' + db.id + '/query', {
        filter: { property: titleProp, title: { contains: n } },
        page_size: 3,
      });
      const hits = (r.results || []).map(p => p.properties[titleProp]?.title?.[0]?.plain_text || '(no title)');
      console.log(`  "${n}":`, hits.length, '件', hits.length ? '→ ' + hits.join(' / ') : '');
    }
  } else {
    console.log('  DB取得エラー or 空');
  }
  console.log();
}
