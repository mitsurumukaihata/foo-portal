// 既存の伝票ページに欠落した明細を追加するパッチスクリプト
// 使い方: node _patch-missing-details.mjs --file "売上明細　2026.3.xlsx"

import https from 'https';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  return args[i + 1] || true;
}
const FILE_NAME = getArg('file', '売上明細　2026.3.xlsx');
// サブフォルダも試す
let FILE_PATH = path.join('C:/Users/Mitsuru Mukaihata/Desktop/売上明細', FILE_NAME);
if (!fs.existsSync(FILE_PATH)) {
  FILE_PATH = path.join('C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細', FILE_NAME);
}

const WORKER = 'notion-proxy.33322666666mm.workers.dev';
const SALES_DB  = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

function nf(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: WORKER, path: p, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let c = '';
      res.on('data', d => c += d);
      res.on('end', () => { try { resolve(JSON.parse(c)); } catch(e) { reject(new Error('Parse: ' + c.slice(0, 200))); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 半角カナ→全角カナ
const HAN_KANA_PAIR = ['ｶﾞ','ガ','ｷﾞ','ギ','ｸﾞ','グ','ｹﾞ','ゲ','ｺﾞ','ゴ','ｻﾞ','ザ','ｼﾞ','ジ','ｽﾞ','ズ','ｾﾞ','ゼ','ｿﾞ','ゾ','ﾀﾞ','ダ','ﾁﾞ','ヂ','ﾂﾞ','ヅ','ﾃﾞ','デ','ﾄﾞ','ド','ﾊﾞ','バ','ﾋﾞ','ビ','ﾌﾞ','ブ','ﾍﾞ','ベ','ﾎﾞ','ボ','ﾊﾟ','パ','ﾋﾟ','ピ','ﾌﾟ','プ','ﾍﾟ','ペ','ﾎﾟ','ポ','ｳﾞ','ヴ','ｱ','ア','ｲ','イ','ｳ','ウ','ｴ','エ','ｵ','オ','ｶ','カ','ｷ','キ','ｸ','ク','ｹ','ケ','ｺ','コ','ｻ','サ','ｼ','シ','ｽ','ス','ｾ','セ','ｿ','ソ','ﾀ','タ','ﾁ','チ','ﾂ','ツ','ﾃ','テ','ﾄ','ト','ﾅ','ナ','ﾆ','ニ','ﾇ','ヌ','ﾈ','ネ','ﾉ','ノ','ﾊ','ハ','ﾋ','ヒ','ﾌ','フ','ﾍ','ヘ','ﾎ','ホ','ﾏ','マ','ﾐ','ミ','ﾑ','ム','ﾒ','メ','ﾓ','モ','ﾔ','ヤ','ﾕ','ユ','ﾖ','ヨ','ﾗ','ラ','ﾘ','リ','ﾙ','ル','ﾚ','レ','ﾛ','ロ','ﾜ','ワ','ｦ','ヲ','ﾝ','ン','ｧ','ァ','ｨ','ィ','ｩ','ゥ','ｪ','ェ','ｫ','ォ','ｬ','ャ','ｭ','ュ','ｮ','ョ','ｯ','ッ','ｰ','ー','｡','。','､','、','｢','「','｣','」','･','・'];
function hankanaToZen(s) {
  if (!s) return s;
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.substr(i, 2); const one = s[i]; let replaced = false;
    for (let j = 0; j < HAN_KANA_PAIR.length; j += 2) {
      if (HAN_KANA_PAIR[j] === two) { r += HAN_KANA_PAIR[j+1]; i++; replaced = true; break; }
      if (HAN_KANA_PAIR[j] === one) { r += HAN_KANA_PAIR[j+1]; replaced = true; break; }
    }
    if (!replaced) r += one;
  }
  return r;
}

function mapHinmoku(code, name) {
  const c = (code || '').toUpperCase(); const n = name || '';
  if (/中古/.test(n) && /CH/.test(c)) return 'タイヤ販売(中古)';
  if (/更生|再生|ﾌﾞﾘﾁﾞｽﾄﾝ　再生|ﾌﾞﾘﾁﾞｽﾄﾝ　更生|RTM|RTW|RTG/.test(n)) return 'タイヤ販売(更生)';
  if (/廃タイヤ/.test(n)) return 'その他';
  if (/^LK01$/.test(c) || (c === 'LK01' && /組替/.test(n))) return '組替';
  if (/^LKL01$/.test(c)) return '組替';
  if (/^TK01$/.test(c)) return '組替';
  if (/^PK01$/.test(c)) return '組替';
  if (/^OR01$/.test(c)) return '組替';
  if (/^LK02$/.test(c) || (c === 'LK02' && /脱着/.test(n))) return '脱着';
  if (/^LKL02$/.test(c)) return '脱着';
  if (/^TK02$/.test(c)) return '脱着';
  if (/^PK02$/.test(c)) return '脱着';
  if (/^OR02$/.test(c)) return '脱着';
  if (/^PK03$/.test(c) || /ﾊﾞﾗﾝｽ|バランス/.test(n)) return 'バランス';
  if (/^PK04$/.test(c) || /Ｆﾊﾞﾗﾝｽ/.test(n)) return 'Fバランス';
  if (/^HT/.test(c)) return 'その他';
  if (/^FOO/.test(c)) return 'f.o.oパック';
  if (/^ST/i.test(c)) return 'その他';
  if (/^CH06/.test(c)) return 'ホイール';
  if (/^\d/.test(c) && /R\d/.test(n)) return 'タイヤ販売(新品)';
  if (/^CH0[1-5]$/.test(c)) return 'タイヤ販売(中古)';
  if (/^SH01$/.test(c)) return '出張(市内)';
  if (/^SH02$/.test(c)) return '出張(市外)';
  return 'その他';
}

function extractTireInfo(name) {
  const size = (name.match(/(\d{3}\/\d{2,3}R\d{2}\.?\d?|\d{2,3}R\d{2}\.?\d?\s*\d{1,2}P|\d\.\d{2}R\d{2}\s*\d{1,2}P)/)?.[1] || '').trim();
  const brand = (name.match(/([A-Z][A-Za-z0-9]{2,10})\s/)?.[1] || '').trim();
  return { size, brand };
}

function excelDateToISO(serial) {
  if (typeof serial === 'string') return serial;
  const d = new Date((serial - 25569) * 86400000);
  return d.toISOString().slice(0, 10);
}

console.log('=== 欠落明細パッチ ===');
console.log('ファイル:', FILE_PATH);

// 1. Excel読み込み
const wb = XLSX.readFile(FILE_PATH);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

// 2. Notionの既存伝票（2026/3）を取得して、明細0件のものを特定
console.log('Notion伝票を取得中...');
const slips = [];
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: '2026-03-01' } },
    { property: '売上日', date: { on_or_before: '2026-03-31' } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  slips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

// 伝票番号→Notion IDマップ
const slipIdMap = new Map();
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (m) slipIdMap.set(m[1], s.id);
}

// 明細が0件の伝票を特定
const emptySlips = new Set();
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  if (!m) continue;
  const num = m[1];
  const detailRes = await nf('POST', `/databases/${DETAIL_DB}/query`, {
    filter: { property: '売上伝票', relation: { contains: s.id } },
    page_size: 1,
  });
  await sleep(80);
  if ((detailRes.results || []).length === 0) {
    emptySlips.add(num);
  }
}
console.log('明細0件の伝票:', emptySlips.size, '件');

// 3. Excelから該当伝票の明細を抽出して投入
let totalCreated = 0;
let errors = 0;
const header = data[4];

// 伝票ごとにグループ化
const slipGroups = new Map();
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  const num = String(row[2]).trim();
  const prodName = String(row[15] || '');
  if (prodName === '《消費税》') continue;
  if (!emptySlips.has(num)) continue;
  if (!slipGroups.has(num)) slipGroups.set(num, []);
  slipGroups.get(num).push(row);
}
console.log('パッチ対象:', slipGroups.size, '伝票');

for (const [num, rows] of slipGroups) {
  const slipPageId = slipIdMap.get(num);
  if (!slipPageId) { console.log('  ❌ 伝票' + num + ': Notionに見つからず'); continue; }

  const taxType = String(rows[0][7] || '');
  const isNaizei = taxType.includes('内税');

  for (const row of rows) {
    const shohinCode = String(row[14] || '').trim();
    const productName = String(row[15] || '').trim();
    const unit = String(row[16] || '').trim();
    const quantity = Number(row[21]) || 0;
    const unitPrice = Number(row[23]) || 0;
    const amount = Number(row[25]) || 0;
    const taxKubun = String(row[29] || '').trim();
    const bikou = String(row[30] || '').trim();

    const tireInfo = extractTireInfo(productName);
    const hinmoku = mapHinmoku(shohinCode, productName);

    // 税計算
    let taxRate = 0.1;
    if (taxKubun.includes('8')) taxRate = 0.08;
    let zeinuki = unitPrice;
    let zei = 0;
    let zeikomi = 0;
    if (isNaizei) {
      zeinuki = Math.round(unitPrice / (1 + taxRate));
      zei = Math.round(quantity * unitPrice - quantity * zeinuki);
      zeikomi = quantity * unitPrice;
    } else {
      zei = Math.round(quantity * unitPrice * taxRate);
      zeikomi = quantity * unitPrice + zei;
    }

    const detailTitle = `${hinmoku} ${tireInfo.size || ''} ${tireInfo.brand || ''}`.trim() || hankanaToZen(productName).slice(0, 40);
    const detailProps = {
      '明細タイトル': { title: [{ text: { content: detailTitle } }] },
      '売上伝票': { relation: [{ id: slipPageId }] },
      '商品コード': { rich_text: [{ text: { content: shohinCode } }] },
      '品目': { select: { name: hinmoku } },
      'タイヤサイズ': { rich_text: [{ text: { content: tireInfo.size } }] },
      'タイヤ銘柄': { rich_text: [{ text: { content: tireInfo.brand } }] },
      '数量': { number: quantity },
      '単価': { number: unitPrice },
      '税区分': { select: { name: taxKubun || '課税10.0%' } },
      '税額': { number: zei },
      '税込小計': { number: zeikomi },
      '備考': { rich_text: [{ text: { content: hankanaToZen(productName) } }] },
    };
    if (unit) detailProps['単位'] = { select: { name: unit } };
    if (bikou) detailProps['弥生備考'] = { rich_text: [{ text: { content: bikou } }] };

    try {
      const res = await nf('POST', '/pages', { parent: { database_id: DETAIL_DB }, properties: detailProps });
      if (res.object === 'error') throw new Error(res.message);
      totalCreated++;
      await sleep(300);
    } catch(e) {
      errors++;
      console.log('  ❌ 伝票' + num + ' 明細エラー:', e.message);
    }
  }
  console.log('  ✓ 伝票' + num + ' (' + rows.length + '明細)');
}

console.log();
console.log('===== 結果 =====');
console.log('明細作成:', totalCreated, '件');
console.log('エラー:', errors, '件');
