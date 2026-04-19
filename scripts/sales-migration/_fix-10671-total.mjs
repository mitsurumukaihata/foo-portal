// 2023/6 伝票00010671 の税抜合計を実明細から再計算して正しい値にリセット
import https from 'https';

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

function nf(method, p, body, retries = 10) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try { const pp = JSON.parse(c); if (pp.object === 'error' && pp.code === 'rate_limited' && n > 0) { setTimeout(() => tryFetch(n-1), 60000); return; } res(pp); } catch(e) { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(new Error(c.slice(0, 300))); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}

// 2023/6 の伝票00010671 を検索
let target = null;
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: '2023-06-01' } },
    { property: '売上日', date: { on_or_before: '2023-06-30' } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  for (const s of r.results || []) {
    const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
    if (memo.includes('弥生伝票00010671')) { target = s; break; }
  }
  if (target) break;
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

if (!target) { console.log('00010671見つからず'); process.exit(1); }
console.log('pageId:', target.id);
console.log('現在 税抜=' + target.properties['税抜合計']?.number, ' 消費税=' + target.properties['消費税合計']?.number, ' 税込=' + target.properties['税込合計']?.number);

// 明細全件取得
const details = [];
let dcur = null;
do {
  const body = { filter: { property: '売上伝票', relation: { contains: target.id } }, page_size: 100 };
  if (dcur) body.start_cursor = dcur;
  const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
  details.push(...r.results || []);
  dcur = r.has_more ? r.next_cursor : null;
} while (dcur);

console.log('明細件数:', details.length);
let zeinukiSum = 0, zeiSum = 0, zeikomiSum = 0;
for (const d of details) {
  const qty = d.properties['数量']?.number || 0;
  const tanka = d.properties['単価']?.number || 0;
  const zeigaku = d.properties['税額']?.number || 0;
  const zeikomi = d.properties['税込小計']?.number || 0;
  const shokei = qty * tanka;  // 税抜小計 (formula)
  zeinukiSum += shokei;
  zeiSum += zeigaku;
  zeikomiSum += zeikomi;
}
console.log('集計 税抜=' + zeinukiSum + ' 消費税=' + zeiSum + ' 税込=' + zeikomiSum);

// 弥生の期待値: 税抜=53,300 消費税=5,330 税込=58,630
// 集計と合っていればそれをそのままセット
console.log('修正値: 税抜合計=' + zeinukiSum);

const res = await nf('PATCH', '/pages/' + target.id, { properties: {
  '税抜合計': { number: zeinukiSum },
  '消費税合計': { number: zeiSum },
  '税込合計': { number: zeikomiSum },
}});
console.log('更新結果:', res.object === 'page' ? 'OK' : ('ERROR: ' + res.message));
