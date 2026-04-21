#!/usr/bin/env node
// ⚠️ バグ修正版: 旧 import-slips-and-details.mjs は r.id をチェックせず、
// Notion API がエラー応答を返しても成功カウントしていた問題を修正。
//
// - Notion応答の object==='error' or r.id未定義 を確実にエラー扱い
// - レート制限時は最大120秒バックオフ
// - 失敗した伝票番号を failed-slips.json に逐次記録
// - existing-keys.json (弥生伝票番号+日付) でスキップ

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SLIP_DB = '1587357d69e047699615b962c7dab6db';
const DETAIL_DB = '7a92c7ee74aa4edbb8f8fd78aca41952';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, 'import-v2.log');
const FAILED_FILE = path.join(SCRIPT_DIR, 'failed-slips.json');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function nf(method, p, body, retries = 8) {
  return new Promise((resolve) => {
    const tryFetch = (n, attempt = 1) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
      }, r => {
        let c = ''; r.on('data', x => c += x);
        r.on('end', () => {
          let pp;
          try { pp = JSON.parse(c); }
          catch(e) {
            if (n > 0) { setTimeout(() => tryFetch(n - 1, attempt+1), 5000); return; }
            return resolve({ object: 'error', code: 'parse_error', message: e.message });
          }
          if (pp && pp.object === 'error') {
            const retriable = ['rate_limited','internal_server_error','service_unavailable','conflict_error','bad_gateway'].includes(pp.code);
            if (retriable && n > 0) {
              // exponential backoff: 5s, 10s, 20s, 40s, 80s, 120s
              const wait = Math.min(120000, 5000 * Math.pow(2, attempt-1));
              setTimeout(() => tryFetch(n - 1, attempt+1), wait);
              return;
            }
          }
          resolve(pp);
        });
      });
      req.on('error', e => {
        if (n > 0) setTimeout(() => tryFetch(n - 1, attempt+1), 5000);
        else resolve({ object: 'error', code: 'network_error', message: e.message });
      });
      req.setTimeout(45000, () => req.destroy());
      if (d) req.write(d); req.end();
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
function extractSize(pn) { const m = (pn||'').match(/\d{3}\/\d{2}R\d+(?:\.\d)?/); return m ? m[0] : ''; }

// ─── データ読込
const allSlips = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'purchase-slips.json'), 'utf-8'));
const supplierMapping = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'supplier-id-mapping.json'), 'utf-8'));
const existingKeys = new Set(JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'existing-keys.json'), 'utf-8')));

// 既存 + 同一バッチ内重複を防ぐためのセット
const processedKeys = new Set(existingKeys);
const toImport = [];
for (const slip of allSlips) {
  const key = slip.slipNo + '|' + (slip.date || '');
  if (processedKeys.has(key)) continue;
  processedKeys.add(key);
  toImport.push(slip);
}

log(`━━━ import-slips-v2 開始 ━━━`);
log(`📊 全データ: ${allSlips.length}件 / 既存スキップ: ${existingKeys.size}件 / 今回対象: ${toImport.length}件`);

const failed = [];
let okSlip = 0, okDetail = 0, failSlip = 0, failDetail = 0;
const startTime = Date.now();

for (let i = 0; i < toImport.length; i++) {
  const slip = toImport[i];
  const supplierId = supplierMapping[slip.supplierName] || null;
  const subtotal = slip.subtotal || slip.details.reduce((s,d)=>s+(d.amount||0),0) - (slip.taxAmount||0);
  const grandTotal = slip.grandTotal || slip.details.reduce((s,d)=>s+(d.amount||0),0);

  let taxCredit = '適格100%';
  if (slip.taxCredit?.includes('80')) taxCredit = '経過措置80%';
  else if (slip.taxCredit?.includes('50')) taxCredit = '経過措置50%';
  else if (slip.taxCredit?.includes('控除不可') || slip.taxCredit?.includes('未登録')) taxCredit = '控除不可';

  const staffNorm = slip.staff ? slip.staff.replace('　', ' ') : null;

  const slipProps = {
    '伝票タイトル': { title: [{ text: { content: `${slip.date || '?'} ${slip.supplierName || '?'}`.slice(0, 200) } }] },
    '弥生伝票番号': { rich_text: [{ text: { content: slip.slipNo } }] },
    '税抜合計': { number: subtotal },
    '消費税合計': { number: slip.taxAmount || 0 },
    '税込合計': { number: grandTotal },
    '仕入税額控除': { select: { name: taxCredit } },
    'ステータス': { select: { name: '支払済' } },
    '備考': { rich_text: [{ text: { content: `弥生#${slip.slipNo} ${slip.taxKb || ''}` } }] },
  };
  if (slip.date) slipProps['仕入日'] = { date: { start: slip.date } };
  if (supplierId) slipProps['仕入先'] = { relation: [{ id: supplierId }] };
  if (staffNorm) slipProps['担当者'] = { select: { name: staffNorm } };

  const r = await nf('POST', '/pages', { parent: { database_id: SLIP_DB }, properties: slipProps });

  // ✅ 厳密チェック: r.id の存在で判定
  if (!r || r.object === 'error' || !r.id) {
    failSlip++;
    failed.push({ slipNo: slip.slipNo, date: slip.date, error: r?.message || r?.code || 'unknown' });
    fs.writeFileSync(FAILED_FILE, JSON.stringify(failed, null, 2));
    log(`  ❌ 伝票失敗 slipNo=${slip.slipNo} date=${slip.date} err=${r?.code}:${r?.message?.slice(0,80)}`);
    // エラー連続時は少し待つ
    if (failSlip % 5 === 0) await sleep(10000);
    continue;
  }
  const slipId = r.id;
  okSlip++;

  // 明細投入
  for (const d of slip.details) {
    const size = extractSize(d.productName);
    const maker = guessMaker(slip.supplierName, d.productName);
    let taxType = '外税';
    if (d.taxType?.includes('内税')) taxType = '内税';
    else if (d.taxType?.includes('非課税')) taxType = '非課税';
    else if (d.taxType?.includes('軽減')) taxType = '軽減税率';

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
      const uMap = { '本':'本','個':'個','セット':'セット' };
      dProps['単位'] = { select: { name: uMap[d.unit] || 'その他' } };
    }

    const rd = await nf('POST', '/pages', { parent: { database_id: DETAIL_DB }, properties: dProps });
    if (!rd || rd.object === 'error' || !rd.id) { failDetail++; }
    else okDetail++;
    await sleep(200);
  }
  await sleep(250);

  if ((i + 1) % 10 === 0) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const progress = Math.round(((i + 1) / toImport.length) * 100);
    const rate = okSlip / (elapsed || 1);
    const eta = Math.round((toImport.length - i - 1) / (rate || 0.1));
    log(`  📊 ${i+1}/${toImport.length} (${progress}%) ✅伝票${okSlip} ❌${failSlip} / ✅明細${okDetail} ❌${failDetail} / 経過${Math.floor(elapsed/60)}分 残${Math.floor(eta/60)}分`);
  }
}

const elapsed = Math.round((Date.now() - startTime) / 1000);
log(`━━━ 完了 ━━━`);
log(`✅ 伝票: ${okSlip}件作成 / ❌失敗 ${failSlip}件`);
log(`✅ 明細: ${okDetail}件作成 / ❌失敗 ${failDetail}件`);
log(`⏱  経過: ${Math.floor(elapsed/60)}分${elapsed%60}秒`);
if (failed.length) log(`→ 失敗詳細: failed-slips.json`);
