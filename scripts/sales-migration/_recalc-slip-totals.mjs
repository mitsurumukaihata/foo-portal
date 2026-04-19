// 指定の弥生伝票番号(リスト)について、明細から税抜合計・消費税合計・税込合計を再計算
// 使い方: node _recalc-slip-totals.mjs --slips 00002167,00002628,00002602,00002713,00002829 --year-month-guess
import https from 'https';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const SLIPS = (getArg('slips') || '').split(',').filter(Boolean);
if (!SLIPS.length) { console.log('--slips 00002167,... 必須'); process.exit(1); }

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
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 各伝票を検索＆再計算
for (const slipNo of SLIPS) {
  console.log('\n===== 伝票' + slipNo + ' =====');
  // 備考で検索（DB全体から）
  let target = null;
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
    for (const s of r.results || []) {
      const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
      if (memo.includes('弥生伝票' + slipNo)) { target = s; break; }
    }
    if (target) break;
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  if (!target) { console.log('見つからず'); continue; }
  console.log('pageId:', target.id, ' 売上日:', target.properties['売上日']?.date?.start);
  console.log('現在: 税抜=' + target.properties['税抜合計']?.number + ' 消費税=' + target.properties['消費税合計']?.number + ' 税込=' + target.properties['税込合計']?.number);

  const details = [];
  let dcur = null;
  do {
    const body = { filter: { property: '売上伝票', relation: { contains: target.id } }, page_size: 100 };
    if (dcur) body.start_cursor = dcur;
    const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
    details.push(...r.results || []);
    dcur = r.has_more ? r.next_cursor : null;
  } while (dcur);

  let zeinuki = 0, zei = 0, zeikomi = 0;
  for (const d of details) {
    const qty = d.properties['数量']?.number || 0;
    const tanka = d.properties['単価']?.number || 0;
    const zeigaku = d.properties['税額']?.number || 0;
    const zk = d.properties['税込小計']?.number || 0;
    zeinuki += qty * tanka;
    zei += zeigaku;
    zeikomi += zk;
  }
  console.log('明細', details.length, '件 集計 税抜=' + zeinuki + ' 消費税=' + zei + ' 税込=' + zeikomi);

  const res = await nf('PATCH', '/pages/' + target.id, { properties: {
    '税抜合計': { number: zeinuki },
    '消費税合計': { number: zei },
    '税込合計': { number: zeikomi },
  }});
  console.log('更新:', res.object === 'page' ? 'OK' : ('ERROR: ' + res.message));
  await sleep(500);
}
