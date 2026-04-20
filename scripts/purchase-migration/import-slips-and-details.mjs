#!/usr/bin/env node
// 仕入伝票＋仕入明細を Notion に一括投入
// 前提: import-suppliers.mjs 実行済み (supplier-id-mapping.json あり)

import https from 'https';
import fs from 'fs';
import path from 'path';

const SLIP_DB = '1587357d69e047699615b962c7dab6db';
const DETAIL_DB = '7a92c7ee74aa4edbb8f8fd78aca41952';

function nf(method, p, body, retries = 6) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
      }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const pp = JSON.parse(c);
            if (pp.object === 'error' && ['rate_limited','internal_server_error','service_unavailable','conflict_error'].includes(pp.code) && n > 0) {
              const wait = Math.min(30000, 2000 * Math.pow(2, 6 - n));
              setTimeout(() => tryFetch(n - 1), wait);
              return;
            }
            res(pp);
          } catch(e) { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n - 1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function guessMaker(name, productName) {
  const t = (name + ' ' + productName).toUpperCase();
  if (/ﾄｰﾖｰ|TOYO/i.test(t)) return 'TOYO';
  if (/ﾌﾞﾘﾁﾞｽﾄﾝ|ブリヂストン|BRIDGESTONE|BS/i.test(t)) return 'BRIDGESTONE';
  if (/ﾀﾞﾝﾛｯﾌﾟ|ダンロップ|DUNLOP|SP\b/.test(t)) return 'DUNLOP';
  if (/ﾐｼｭﾗﾝ|ミシュラン|MICHELIN|XJE|XDW/.test(t)) return 'MICHELIN';
  if (/ピレリ|PIRELLI/.test(t)) return 'PIRELLI';
  return 'その他';
}
function extractSizeFromProductName(pn) {
  if (!pn) return '';
  const m = pn.match(/\d{3}\/\d{2}R\d+(?:\.\d)?/);
  return m ? m[0] : '';
}

// ── 開始位置（途中再開用）
function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const START_FROM = parseInt(getArg('start', '0'));
const STOP_AT = parseInt(getArg('stop', '999999'));

const SCRIPT_DIR = path.dirname(decodeURI(new URL(import.meta.url).pathname.replace(/^\//, '')));
const slips = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'purchase-slips.json'), 'utf-8'));
const supplierMapping = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'supplier-id-mapping.json'), 'utf-8'));
console.log(`📥 ${slips.length} 伝票 / ${slips.reduce((s, x) => s + x.details.length, 0)} 明細`);
console.log(`▶ 開始位置: ${START_FROM} / 終了位置: ${STOP_AT}`);

// 既存伝票チェック（弥生伝票番号で）
console.log('🔍 既存仕入伝票を確認中...');
const existingSlips = new Map();
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SLIP_DB + '/query', body);
  for (const p of r.results || []) {
    const yno = p.properties['弥生伝票番号']?.rich_text?.[0]?.plain_text;
    if (yno) existingSlips.set(yno, p.id);
  }
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log(`   既存: ${existingSlips.size} 件`);

let okSlip = 0, okDetail = 0, skipSlip = 0, failSlip = 0, failDetail = 0;
const startTime = Date.now();

for (let i = START_FROM; i < Math.min(slips.length, STOP_AT); i++) {
  const slip = slips[i];
  if (existingSlips.has(slip.slipNo)) { skipSlip++; continue; }

  const subtotal = slip.details.reduce((s, d) => s + d.amount, 0);
  const grandTotal = subtotal + slip.taxAmount;
  const supplierId = supplierMapping[slip.supplierCode];

  // 税額控除区分
  let taxCredit = '適格100%';
  if (slip.taxCredit.includes('80')) taxCredit = '経過措置80%';
  else if (slip.taxCredit.includes('50')) taxCredit = '経過措置50%';
  else if (slip.taxCredit.includes('控除不可') || slip.taxCredit.includes('未登録')) taxCredit = '控除不可';

  // 担当者normalization
  const staffMap = { '向畑 充': '向畑 充', '矢島 明和': '矢島 明和', '大田 健': '大田 健', '中川 颯': '中川 颯', '平野 春之': '平野 春之', '山根 祐司': '山根 祐司', '村田 良典': '村田 良典', '岡崎 由美': '岡崎 由美', '藤井 真理亜': '藤井 真理亜' };
  const staffNorm = slip.staff ? (staffMap[slip.staff.replace('　', ' ')] || null) : null;

  const slipProps = {
    '伝票タイトル': { title: [{ text: { content: `${slip.date || '?'} ${slip.supplierName || '?'}`.slice(0, 200) } }] },
    '弥生伝票番号': { rich_text: [{ text: { content: slip.slipNo } }] },
    '税抜合計': { number: subtotal },
    '消費税合計': { number: slip.taxAmount },
    '税込合計': { number: grandTotal },
    '仕入税額控除': { select: { name: taxCredit } },
    'ステータス': { select: { name: '支払済' } },
    '備考': { rich_text: [{ text: { content: `弥生#${slip.slipNo} ${slip.taxKb || ''}` } }] },
  };
  if (slip.date) slipProps['仕入日'] = { date: { start: slip.date } };
  if (supplierId) slipProps['仕入先'] = { relation: [{ id: supplierId }] };
  if (staffNorm) slipProps['担当者'] = { select: { name: staffNorm } };

  let slipId = null;
  try {
    const r = await nf('POST', '/pages', { parent: { database_id: SLIP_DB }, properties: slipProps });
    slipId = r.id;
    okSlip++;
  } catch(e) { console.error(`  伝票失敗 ${slip.slipNo}`, e.message); failSlip++; continue; }

  // 明細投入
  for (const d of slip.details) {
    const size = extractSizeFromProductName(d.productName);
    const maker = guessMaker(slip.supplierName, d.productName);
    let taxType = '外税';
    if (d.taxType && d.taxType.includes('内税')) taxType = '内税';
    else if (d.taxType && d.taxType.includes('非課税')) taxType = '非課税';
    else if (d.taxType && d.taxType.includes('軽減')) taxType = '軽減税率';

    const dProps = {
      '明細タイトル': { title: [{ text: { content: `${d.productCode || ''} ${d.productName || ''}`.slice(0, 200) } }] },
      '仕入伝票': { relation: [{ id: slipId }] },
      '商品コード': { rich_text: [{ text: { content: d.productCode || '' } }] },
      '品名': { rich_text: [{ text: { content: (d.productName || '').slice(0, 200) } }] },
      '数量': { number: d.qty || 0 },
      '単価': { number: d.price || 0 },
      '税込小計': { number: d.amount || 0 },
      '税区分': { select: { name: taxType } },
      '備考': { rich_text: [{ text: { content: (d.memo || '').slice(0, 200) } }] },
    };
    if (size) dProps['タイヤサイズ'] = { rich_text: [{ text: { content: size } }] };
    if (maker && maker !== 'その他') dProps['メーカー'] = { select: { name: maker } };
    if (d.unit) {
      const uMap = { '本': '本', '個': '個', 'セット': 'セット', 'ペア': 'その他', '件': 'その他', '式': 'その他', '回': 'その他', '枚': 'その他', '台': 'その他' };
      dProps['単位'] = { select: { name: uMap[d.unit] || 'その他' } };
    }

    try {
      await nf('POST', '/pages', { parent: { database_id: DETAIL_DB }, properties: dProps });
      okDetail++;
    } catch(e) { console.error(`  明細失敗`, e.message); failDetail++; }
    await sleep(250);
  }
  await sleep(300);

  if ((okSlip + skipSlip) % 20 === 0) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const progress = Math.round(((i - START_FROM + 1) / (Math.min(slips.length, STOP_AT) - START_FROM)) * 100);
    console.log(`  進捗 ${i+1}/${slips.length} (${progress}%) 伝票:${okSlip}作成 ${skipSlip}スキップ / 明細:${okDetail}件 / 経過 ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
  }
}

const elapsed = Math.round((Date.now() - startTime) / 1000);
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ 伝票新規作成: ${okSlip}件  ⏭️ スキップ: ${skipSlip}件  ❌ 失敗: ${failSlip}件`);
console.log(`✅ 明細作成: ${okDetail}件  ❌ 失敗: ${failDetail}件`);
console.log(`⏱  経過時間: ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
