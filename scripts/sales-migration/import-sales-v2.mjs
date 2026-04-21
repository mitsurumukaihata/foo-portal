#!/usr/bin/env node
// ⚠️ 売上再インポートv2: 全15ヶ月分Excelを順次処理、既存スキップ、厳密エラー判定
// 使い方: node import-sales-v2.mjs
//   オプション: --files "2023.4-2023.6.xlsx,2024.1-2024.3.xlsx" (カンマ区切り指定)

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const CUST_DB = '1ca8d122be214e3892879932147143c9';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, 'import-v2.log');
const FAILED_FILE = path.join(SCRIPT_DIR, 'failed-sales.json');

const BASE_DIR = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細';

// 未インポートファイルリスト（2025/4-12は済み、それ以外全部）
const ALL_FILES = [
  // 2023
  { file: '売上明細　2023.4-2023.6.xlsx', filter: null },
  { file: '売上明細　2023.7-2023.9.xlsx', filter: null },
  { file: '売上明細　2023.10-2023.12.xlsx', filter: null },
  { file: '売上明細　2024.1-2024.3.xlsx', filter: null },
  // 2024/4-2025/3 はバンドル: 月別にフィルタして処理
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 4 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 5 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 6 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 7 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 8 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 9 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 10 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 11 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2024, month: 12 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2025, month: 1 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2025, month: 2 } },
  { file: '売上明細　2024.4-2025.3.xlsx', filter: { year: 2025, month: 3 } },
  // 2026
  { file: '売上明細　2026.1.xlsx', filter: null },
  { file: '売上明細　2026.2.xlsx', filter: null },
  { file: '売上明細　2026.3.xlsx', filter: null },
];

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
            if (n > 0) { setTimeout(() => tryFetch(n-1, attempt+1), 5000); return; }
            return resolve({ object:'error', code:'parse_error', message:e.message });
          }
          if (pp && pp.object === 'error') {
            const retriable = ['rate_limited','internal_server_error','service_unavailable','conflict_error','bad_gateway'].includes(pp.code);
            if (retriable && n > 0) {
              const wait = Math.min(120000, 5000 * Math.pow(2, attempt-1));
              setTimeout(() => tryFetch(n-1, attempt+1), wait);
              return;
            }
          }
          resolve(pp);
        });
      });
      req.on('error', e => {
        if (n > 0) setTimeout(() => tryFetch(n-1, attempt+1), 5000);
        else resolve({ object:'error', code:'network_error', message:e.message });
      });
      req.setTimeout(45000, () => req.destroy());
      if (d) req.write(d); req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 半角カナ → 全角カナ (migrate-sales.mjs より) ─────────
const HAN_KANA_PAIR = ['ｶﾞ','ガ','ｷﾞ','ギ','ｸﾞ','グ','ｹﾞ','ゲ','ｺﾞ','ゴ','ｻﾞ','ザ','ｼﾞ','ジ','ｽﾞ','ズ','ｾﾞ','ゼ','ｿﾞ','ゾ','ﾀﾞ','ダ','ﾁﾞ','ヂ','ﾂﾞ','ヅ','ﾃﾞ','デ','ﾄﾞ','ド','ﾊﾞ','バ','ﾋﾞ','ビ','ﾌﾞ','ブ','ﾍﾞ','ベ','ﾎﾞ','ボ','ﾊﾟ','パ','ﾋﾟ','ピ','ﾌﾟ','プ','ﾍﾟ','ペ','ﾎﾟ','ポ','ｳﾞ','ヴ','ｱ','ア','ｲ','イ','ｳ','ウ','ｴ','エ','ｵ','オ','ｶ','カ','ｷ','キ','ｸ','ク','ｹ','ケ','ｺ','コ','ｻ','サ','ｼ','シ','ｽ','ス','ｾ','セ','ｿ','ソ','ﾀ','タ','ﾁ','チ','ﾂ','ツ','ﾃ','テ','ﾄ','ト','ﾅ','ナ','ﾆ','ニ','ﾇ','ヌ','ﾈ','ネ','ﾉ','ノ','ﾊ','ハ','ﾋ','ヒ','ﾌ','フ','ﾍ','ヘ','ﾎ','ホ','ﾏ','マ','ﾐ','ミ','ﾑ','ム','ﾒ','メ','ﾓ','モ','ﾔ','ヤ','ﾕ','ユ','ﾖ','ヨ','ﾗ','ラ','ﾘ','リ','ﾙ','ル','ﾚ','レ','ﾛ','ロ','ﾜ','ワ','ｦ','ヲ','ﾝ','ン','ｧ','ァ','ｨ','ィ','ｩ','ゥ','ｪ','ェ','ｫ','ォ','ｬ','ャ','ｭ','ュ','ｮ','ョ','ｯ','ッ','ｰ','ー'];
function hankanaToZen(s) {
  if (!s) return s;
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.substr(i, 2), one = s[i]; let rep = false;
    for (let j = 0; j < HAN_KANA_PAIR.length; j += 2) if (HAN_KANA_PAIR[j] === two) { r += HAN_KANA_PAIR[j+1]; i++; rep = true; break; }
    if (rep) continue;
    for (let j = 0; j < HAN_KANA_PAIR.length; j += 2) if (HAN_KANA_PAIR[j] === one) { r += HAN_KANA_PAIR[j+1]; rep = true; break; }
    if (!rep) r += one;
  }
  return r;
}
function excelDateToISO(serial) {
  const n = typeof serial === 'number' ? serial : parseFloat(serial);
  if (!n || isNaN(n)) return null;
  const d = new Date((n - 25569) * 86400 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function mapHinmoku(code, name) {
  const c = (code||'').toUpperCase(), n = name||'';
  if (/廃タイヤ/.test(n)) return '廃タイヤ';
  if (/中古ホイール/.test(n)) return 'ホイール';
  if (/再生|更生/.test(n)) return 'タイヤ販売(更生)';
  if (/中古/.test(n)) return 'タイヤ販売(中古)';
  if (/Fバランス/.test(n)) return 'Fバランス';
  if (/^SH01/.test(c) || /市内出張/.test(n)) return '出張(市内)';
  if (/^SH02/.test(c) || /市外出張/.test(n)) return '出張(市外)';
  const wm = c.match(/^(LKL|LK|TK|PK|OR|TPPTK)(\d+)/);
  if (wm) { const num = wm[2]; if (num === '01') return '組替'; if (num === '02' || num === '05') return '脱着'; if (num === '03') return 'バランス'; }
  if (/組替/.test(n)) return '組替';
  if (/脱着/.test(n)) return '脱着';
  if (/バランス/.test(n)) return 'バランス';
  if (/^HT/.test(c)) return 'その他';
  if (/^FOO/.test(c)) return 'f.o.oパック';
  if (/^ST/i.test(c)) return 'その他';
  if (/^CH06/.test(c)) return 'ホイール';
  if (/^\d/.test(c)) return 'タイヤ販売(新品)';
  return 'その他';
}
function mapTaxKubun(s) {
  if (!s) return '課税(10%)';
  if (/10\.0%|10%|課税/.test(s)) return '課税(10%)';
  if (/8\.0%|8%|軽減/.test(s)) return '軽減税率(8%)';
  if (/非課税/.test(s)) return '非課税';
  return '課税(10%)';
}
function extractTireInfo(productName) {
  const n = hankanaToZen(productName || '');
  const sizeMatch = n.match(/(\d{2,3}(?:\/\d{2,3})?R\d{1,3}(?:\.\d)?)/);
  const size = sizeMatch ? sizeMatch[1] : '';
  const beforeSize = sizeMatch ? n.slice(0, sizeMatch.index).trim() : n;
  const brandMatch = beforeSize.match(/([MRWVGXDSP][A-Z0-9a-z]*\d+[a-zA-Z]*)/);
  return { size, brand: brandMatch ? brandMatch[1] : '' };
}
function guessWorkType(details) {
  for (const d of details) if (/市(内|外)出張/.test(d.productName||'')) return '出張作業';
  return '来店';
}
function mapPayment(k) {
  if (!k) return '売掛';
  if (/掛/.test(k)) return '売掛';
  if (/現/.test(k)) return '現金';
  if (/カード/.test(k)) return 'クレジットカード';
  return '売掛';
}
const CAR_NUMBER_RE = /([\u4e00-\u9fff\u3040-\u309f]{1,4}\s*\d{2,4}\s*[\u3040-\u309f]\s*\d{1,4}-\d{1,4})/;
function extractCarNumber(bikou) { if (!bikou) return ''; const m = bikou.match(CAR_NUMBER_RE); return m ? m[1].replace(/\s/g,'') : ''; }

// 顧客マップ取得
async function buildCustomerMap() {
  const all=[]; let cursor=null;
  do { const body={page_size:100}; if(cursor) body.start_cursor=cursor;
    const r = await nf('POST', '/databases/'+CUST_DB+'/query', body);
    all.push(...(r.results||[])); cursor=r.has_more?r.next_cursor:null;
  } while(cursor);
  const map = new Map();
  for (const p of all) {
    const code = p.properties['弥生得意先コード']?.rich_text?.[0]?.plain_text || '';
    if (code) code.split(',').map(c=>c.trim()).forEach(c=>map.set(c, p.id));
  }
  return map;
}

// Excel解析
function parseFile(filePath, filter) {
  if (!fs.existsSync(filePath)) { log(`⚠️ ファイルなし: ${filePath}`); return []; }
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const slips = new Map();
  for (let i = 5; i < rows.length - 1; i++) {
    const row = rows[i];
    const denpyoNo = String(row[2] || '').trim();
    if (!denpyoNo) continue;
    const dateSerial = row[1];
    const salesDate = excelDateToISO(dateSerial);
    if (filter) {
      if (!salesDate) continue;
      const [y,m] = salesDate.split('-').map(Number);
      if (y !== filter.year || m !== filter.month) continue;
    }
    const shohinName = String(row[15] || '').trim();
    if (shohinName === '《消費税》') {
      if (slips.has(denpyoNo)) { const s = slips.get(denpyoNo); s.yayoiTax = (s.yayoiTax||0) + parseFloat(row[25]||0); }
      continue;
    }
    if (!slips.has(denpyoNo)) {
      slips.set(denpyoNo, {
        denpyoNo, salesDate,
        torihikiKubun: String(row[3]||'').trim(),
        zeiTenka: String(row[7]||'').trim(),
        custCode: String(row[5]||'').trim(),
        custName: String(row[6]||'').trim(),
        staffName: hankanaToZen(String(row[11]||'').trim()),
        soukoName: String(row[20]||'').trim(),
        details: [], bikouList: [],
      });
    }
    const slip = slips.get(denpyoNo);
    slip.details.push({
      shohinCode: String(row[14]||'').trim(),
      productName: shohinName,
      unit: String(row[16]||'').trim(),
      quantity: parseFloat(row[21]||0),
      unitPrice: parseFloat(row[23]||0),
      amount: parseFloat(row[25]||0),
      zeiKubun: String(row[29]||'').trim(),
      bikou: String(row[30]||'').trim(),
    });
    if (row[30]) slip.bikouList.push(String(row[30]));
  }
  return [...slips.values()];
}

function calcSlipTotals(slip) {
  const isInclusive = /内税/.test(slip.zeiTenka);
  let zeinukiSum=0, zeiSum=0;
  const detailResults = slip.details.map(d => {
    const taxName = mapTaxKubun(d.zeiKubun);
    const rate = taxName === '課税(10%)' ? 0.1 : (taxName === '軽減税率(8%)' ? 0.08 : 0);
    let zeinuki, zei, zeikomi;
    if (isInclusive) { zeikomi = d.amount; zeinuki = rate > 0 ? Math.round(d.amount/(1+rate)) : d.amount; zei = zeikomi - zeinuki; }
    else { zeinuki = d.amount; zei = Math.round(d.amount * rate); zeikomi = zeinuki + zei; }
    zeinukiSum += zeinuki; zeiSum += zei;
    return { ...d, taxName, zeinuki, zei, zeikomi };
  });
  return { zeinukiSum, zeiSum, zeikomiSum: zeinukiSum + zeiSum, detailResults };
}

// ─── メイン ─────
log('━━━ import-sales-v2 開始 ━━━');

// 引数パース
const args = process.argv.slice(2);
const fileFilter = args.indexOf('--files');
const fileFilterSet = fileFilter >= 0 ? new Set(args[fileFilter+1].split(',').map(s=>s.trim())) : null;

// 300件キャップ回避: 既存チェックはper-slip filter で都度実施（existing-keysは不要）
const existingKeys = new Set(); // runtime cache of confirmed-existing keys within this run
log(`📊 既存チェック: per-slip filter方式（Notion API 300件キャップ回避）`);

async function slipAlreadyExists(denpyoNo, salesDate) {
  const key = denpyoNo + '|' + salesDate;
  if (existingKeys.has(key)) return true;
  const body = {
    page_size: 1,
    filter: {
      and: [
        { property: '備考', rich_text: { contains: '弥生伝票' + denpyoNo } },
        { property: '売上日', date: { equals: salesDate } },
      ]
    }
  };
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  if ((r?.results || []).length > 0) {
    existingKeys.add(key);
    return true;
  }
  return false;
}

log('📥 顧客マップ取得中...');
const custMap = await buildCustomerMap();
log(`   顧客マップ: ${custMap.size}件`);

const failed = [];
let totalOk = 0, totalFail = 0, totalSkip = 0, totalDetailOk = 0, totalDetailFail = 0;
const startTime = Date.now();

for (const fileSpec of ALL_FILES) {
  if (fileFilterSet && !fileFilterSet.has(fileSpec.file)) continue;
  const label = fileSpec.filter ? `${fileSpec.file} (${fileSpec.filter.year}/${fileSpec.filter.month})` : fileSpec.file;
  log(`━━ ${label} ━━`);
  const filePath = path.join(BASE_DIR, fileSpec.file);
  const slips = parseFile(filePath, fileSpec.filter);
  log(`   解析: ${slips.length}伝票`);
  if (!slips.length) continue;

  let fileOk = 0, fileFail = 0, fileSkip = 0;
  for (let i = 0; i < slips.length; i++) {
    const slip = slips[i];
    const key = slip.denpyoNo + '|' + (slip.salesDate || '');
    if (await slipAlreadyExists(slip.denpyoNo, slip.salesDate)) { fileSkip++; totalSkip++; continue; }

    const totals = calcSlipTotals(slip);
    const carNumber = extractCarNumber(slip.bikouList.join(' '));
    const workType = guessWorkType(slip.details);
    const custId = custMap.get(slip.custCode);
    let title = `${slip.salesDate.replace(/-/g, '/')} ${hankanaToZen(slip.custName)}`;
    if (carNumber) title += ` ${carNumber}`;

    const slipProps = {
      '伝票タイトル': { title: [{ text: { content: title.slice(0, 200) } }] },
      '伝票種類': { select: { name: '納品書' } },
      '売上日': { date: { start: slip.salesDate } },
      '車番': { rich_text: [{ text: { content: carNumber } }] },
      '作業区分': { select: { name: workType } },
      '支払い方法': { select: { name: mapPayment(slip.torihikiKubun) } },
      '宛先敬称': { select: { name: '御中' } },
      'ステータス': { select: { name: '請求済' } },
      '備考': { rich_text: [{ text: { content: `弥生伝票${slip.denpyoNo} 倉庫:${slip.soukoName}` } }] },
      '税抜合計': { number: totals.zeinukiSum },
      '消費税合計': { number: slip.yayoiTax != null ? slip.yayoiTax : totals.zeiSum },
      '税込合計': { number: slip.yayoiTax != null ? totals.zeinukiSum + slip.yayoiTax : totals.zeikomiSum },
    };
    if (slip.staffName) slipProps['担当者'] = { select: { name: slip.staffName } };
    if (custId) slipProps['顧客名'] = { relation: [{ id: custId }] };

    const r = await nf('POST', '/pages', { parent: { database_id: SALES_DB }, properties: slipProps });

    // ✅ 厳密チェック
    if (!r || r.object === 'error' || !r.id) {
      fileFail++; totalFail++;
      failed.push({ denpyoNo: slip.denpyoNo, date: slip.salesDate, error: r?.code + ':' + (r?.message?.slice(0,80) || 'unknown') });
      fs.writeFileSync(FAILED_FILE, JSON.stringify(failed, null, 2));
      if (totalFail % 5 === 0) await sleep(10000);
      continue;
    }
    existingKeys.add(key); // 以降の同一ファイル重複対応
    fileOk++; totalOk++;
    const slipId = r.id;

    // 明細投入
    for (const d of totals.detailResults) {
      const tireInfo = extractTireInfo(d.productName);
      const hinmoku = mapHinmoku(d.shohinCode, d.productName);
      const detailTitle = (`${hinmoku} ${tireInfo.size||''} ${tireInfo.brand||''}`.trim() || d.productName.slice(0,40)).slice(0,200);
      const dProps = {
        '明細タイトル': { title: [{ text: { content: detailTitle } }] },
        '売上伝票': { relation: [{ id: slipId }] },
        '商品コード': { rich_text: [{ text: { content: d.shohinCode } }] },
        '品目': { select: { name: hinmoku } },
        'タイヤサイズ': { rich_text: [{ text: { content: tireInfo.size } }] },
        'タイヤ銘柄': { rich_text: [{ text: { content: tireInfo.brand } }] },
        '数量': { number: d.quantity || 0 },
        '単価': { number: d.unitPrice || 0 },
        '税区分': { select: { name: d.taxName } },
        '税額': { number: d.zei || 0 },
        '税込小計': { number: d.zeikomi || 0 },
        '備考': { rich_text: [{ text: { content: hankanaToZen(d.productName).slice(0,200) } }] },
      };
      if (d.unit) dProps['単位'] = { select: { name: d.unit } };
      if (d.bikou) dProps['弥生備考'] = { rich_text: [{ text: { content: d.bikou.slice(0,200) } }] };
      const rd = await nf('POST', '/pages', { parent: { database_id: DETAIL_DB }, properties: dProps });
      if (!rd || rd.object === 'error' || !rd.id) totalDetailFail++;
      else totalDetailOk++;
      await sleep(250);
    }
    await sleep(300);

    if ((i+1) % 10 === 0) {
      const el = Math.round((Date.now()-startTime)/1000);
      log(`    ${i+1}/${slips.length} ✅${fileOk} ⏭${fileSkip} ❌${fileFail} / 経過${Math.floor(el/60)}分`);
    }
  }
  log(`  ⓘ ${label}: ✅${fileOk} ⏭${fileSkip} ❌${fileFail}`);
}

const el = Math.round((Date.now()-startTime)/1000);
log('━━━ 完了 ━━━');
log(`✅ 伝票: ${totalOk}件 ⏭ ${totalSkip}スキップ ❌ ${totalFail}失敗`);
log(`✅ 明細: ${totalDetailOk}件 ❌ ${totalDetailFail}失敗`);
log(`⏱  経過: ${Math.floor(el/60)}分${el%60}秒`);
if (failed.length) log(`→ 失敗詳細: failed-sales.json`);
