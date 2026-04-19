// 単体パッチ: 税抜合計を指定値に設定してレスポンスを確認
// 使い方: node _patch-single.mjs --page <pageId> --zeinuki <number>
import https from 'https';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const PAGE = getArg('page');
const ZEINUKI = parseFloat(getArg('zeinuki'));
if (!PAGE || isNaN(ZEINUKI)) { console.log('--page --zeinuki required'); process.exit(1); }

function nf(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
      let c = '';
      r.on('data', x => c += x);
      r.on('end', () => { try { res({ status: r.statusCode, data: JSON.parse(c) }); } catch(e) { rej(new Error(c.slice(0, 300))); } });
    });
    req.on('error', rej);
    if (d) req.write(d);
    req.end();
  });
}

// 現在値取得
const before = await nf('GET', '/pages/' + PAGE);
console.log('Before 税抜合計:', before.data.properties?.['税抜合計']?.number);
console.log('Before 税込合計:', before.data.properties?.['税込合計']?.number);

// PATCH
const r = await nf('PATCH', '/pages/' + PAGE, { properties: { '税抜合計': { number: ZEINUKI } } });
console.log('PATCH status:', r.status);
console.log('PATCH response 税抜合計:', r.data.properties?.['税抜合計']?.number);
if (r.data.object === 'error') console.log('ERROR:', r.data.message);

// 再取得
await new Promise(r => setTimeout(r, 1000));
const after = await nf('GET', '/pages/' + PAGE);
console.log('After 税抜合計:', after.data.properties?.['税抜合計']?.number);
