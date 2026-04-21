#!/usr/bin/env node
// 売上伝票・売上明細を弥生Excelから直接D1 SQL生成
// Notion側の汚染データを迂回し、弥生を真実源として扱う
// slipKey: 弥生伝票番号+売上日 でユニーク識別

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { randomUUID } from 'crypto';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = path.join(SCRIPT_DIR, 'export');
const SQL_DIR = path.join(SCRIPT_DIR, 'sql');
if (!fs.existsSync(SQL_DIR)) fs.mkdirSync(SQL_DIR);

const BASE_DIR = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細';
const ALL_FILES = [
  '売上明細　2023.4-2023.6.xlsx', '売上明細　2023.7-2023.9.xlsx', '売上明細　2023.10-2023.12.xlsx',
  '売上明細　2024.1-2024.3.xlsx', '売上明細　2024.4-2025.3.xlsx',
  '売上明細　2025.4.xlsx', '売上明細　2025.5.xlsx', '売上明細　2025.6.xlsx',
  '売上明細　2025.7.xlsx', '売上明細　2025.8.xlsx', '売上明細　2025.9.xlsx',
  '売上明細　2025.10.xlsx', '売上明細　2025.11.xlsx', '売上明細　2025.12.xlsx',
  '売上明細　2026.1.xlsx', '売上明細　2026.2.xlsx', '売上明細　2026.3.xlsx',
];

function excelDateToISO(serial) {
  const n = typeof serial === 'number' ? serial : parseFloat(serial);
  if (!n || isNaN(n)) return null;
  const d = new Date((n - 25569) * 86400 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

// 半角カナ→全角カナ変換テーブル
const HANKANA_MAP = {'ｶﾞ':'ガ','ｷﾞ':'ギ','ｸﾞ':'グ','ｹﾞ':'ゲ','ｺﾞ':'ゴ','ｻﾞ':'ザ','ｼﾞ':'ジ','ｽﾞ':'ズ','ｾﾞ':'ゼ','ｿﾞ':'ゾ','ﾀﾞ':'ダ','ﾁﾞ':'ヂ','ﾂﾞ':'ヅ','ﾃﾞ':'デ','ﾄﾞ':'ド','ﾊﾞ':'バ','ﾋﾞ':'ビ','ﾌﾞ':'ブ','ﾍﾞ':'ベ','ﾎﾞ':'ボ','ﾊﾟ':'パ','ﾋﾟ':'ピ','ﾌﾟ':'プ','ﾍﾟ':'ペ','ﾎﾟ':'ポ','ｳﾞ':'ヴ','ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ','ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ','ｺ':'コ','ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ','ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ','ﾄ':'ト','ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ','ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ','ﾎ':'ホ','ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ','ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ','ﾗ':'ラ','ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ','ﾜ':'ワ','ｦ':'ヲ','ﾝ':'ン','ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ','ｬ':'ャ','ｭ':'ュ','ｮ':'ョ','ｯ':'ッ','ｰ':'ー','｡':'。','､':'、','｢':'「','｣':'」','･':'・'};
function hankanaToZen(s) {
  if (!s) return '';
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.substr(i, 2);
    if (HANKANA_MAP[two]) { r += HANKANA_MAP[two]; i++; continue; }
    r += HANKANA_MAP[s[i]] || s[i];
  }
  return r;
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
  if (/^\d/.test(c)) return 'タイヤ販売(新品)';
  return 'その他';
}

function mapTax(s) {
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

const CAR_RE_G = /([\u4e00-\u9fff\u3040-\u309f]{1,4}\s*\d{2,4}\s*[\u3040-\u309f]\s*\d{1,4}-\d{1,4})/g;
function extractAllCars(s) {
  if (!s) return [];
  const matches = [...s.matchAll(CAR_RE_G)];
  return [...new Set(matches.map(m => m[1].replace(/\s/g, '')))];
}
function extractCar(s) { const a = extractAllCars(s); return a[0] || ''; }

// 得意先マスタから 得意先コード→ID マップを取得（'弥生'接頭辞なし）
const custsJson = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, '得意先マスタ.json'), 'utf-8'));
const custCodeToId = new Map();
const custNameToId = new Map();
for (const c of custsJson) {
  const code = c.properties['得意先コード']?.rich_text?.[0]?.plain_text || '';
  const name = c.properties['得意先名']?.title?.[0]?.plain_text || '';
  if (code) {
    code.split(',').map(x => x.trim()).forEach(x => { if (x) custCodeToId.set(x, c.id); });
  }
  if (name) custNameToId.set(name.trim(), c.id);
}
console.log('得意先コードマップ:', custCodeToId.size, '/ 名前マップ:', custNameToId.size);

// 伝票のUUID生成（slipKey→新ID）
const slipKeyToId = new Map();
const slipsOut = [];
const detailsOut = [];

for (const file of ALL_FILES) {
  const fp = path.join(BASE_DIR, file);
  if (!fs.existsSync(fp)) continue;
  const wb = XLSX.readFile(fp);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  let fc = 0;
  // 一旦伝票単位にまとめる
  const fileSlips = new Map();
  for (let i = 5; i < rows.length - 1; i++) {
    const row = rows[i];
    const denpyoNo = String(row[2] || '').trim();
    if (!denpyoNo) continue;
    const date = excelDateToISO(row[1]);
    if (!date) continue;
    const shohinName = String(row[15] || '').trim();
    const key = denpyoNo + '|' + date;

    // slip header
    if (!fileSlips.has(key)) {
      fileSlips.set(key, {
        denpyoNo, date,
        torihikiKubun: String(row[3]||'').trim(),
        zeiTenka: String(row[7]||'').trim(),
        custCode: String(row[5]||'').trim(),
        custName: hankanaToZen(String(row[6]||'').trim()),
        staffName: hankanaToZen(String(row[11]||'').trim()),
        soukoName: String(row[20]||'').trim(),
        details: [],
        yayoiTax: 0,
      });
    }
    const slip = fileSlips.get(key);

    if (shohinName === '《消費税》') {
      slip.yayoiTax += parseFloat(row[25]||0);
      continue;
    }
    slip.details.push({
      shohinCode: String(row[14]||'').trim(),
      productName: shohinName,
      unit: String(row[16]||'').trim(),
      qty: parseFloat(row[21]||0),
      price: parseFloat(row[23]||0),
      amount: parseFloat(row[25]||0),
      zeiKubun: String(row[29]||'').trim(),
      bikou: String(row[30]||'').trim(),
    });
    fc++;
  }

  // ファイル内 slips をoutputに追加
  for (const [key, slip] of fileSlips) {
    let slipId = slipKeyToId.get(key);
    if (!slipId) {
      slipId = 'slp-' + randomUUID();
      slipKeyToId.set(key, slipId);
    } else {
      // 既に同じ slipKey が他のファイルから追加済み → 追加しない（dedup）
      continue;
    }

    // 合計計算
    const isInclusive = /内税/.test(slip.zeiTenka);
    let zeinukiSum = 0, zeiSum = 0;
    const detailsFinal = [];
    let detailIdx = 0;
    for (const d of slip.details) {
      const taxName = mapTax(d.zeiKubun);
      const rate = taxName === '課税(10%)' ? 0.1 : (taxName === '軽減税率(8%)' ? 0.08 : 0);
      let zeinuki, zei, zeikomi;
      if (isInclusive) { zeikomi = d.amount; zeinuki = rate > 0 ? Math.round(d.amount/(1+rate)) : d.amount; zei = zeikomi - zeinuki; }
      else { zeinuki = d.amount; zei = Math.round(d.amount * rate); zeikomi = zeinuki + zei; }
      zeinukiSum += zeinuki; zeiSum += zei;
      detailsFinal.push({ ...d, taxName, zeinuki, zei, zeikomi });
    }
    const zeikomiSum = zeinukiSum + zeiSum;
    const yayoiTax = slip.yayoiTax;
    const finalZei = yayoiTax !== 0 ? yayoiTax : zeiSum;
    const finalZeikomi = yayoiTax !== 0 ? zeinukiSum + yayoiTax : zeikomiSum;

    // 全明細と備考から車番抽出
    const allBikou = detailsFinal.map(d => d.bikou).join(' ');
    const cars = extractAllCars(allBikou);
    const carStr = cars.join(', ');
    const mainCar = cars[0] || '';

    let title = `${slip.date.replace(/-/g, '/')} ${slip.custName}`;
    if (cars.length === 1) title += ` ${mainCar}`;
    else if (cars.length > 1) title += ` (${cars.length}台)`;

    // コード優先、ダメなら名前で fallback
    const custId = custCodeToId.get(slip.custCode) || custNameToId.get(slip.custName) || '';

    slipsOut.push({
      id: slipId,
      伝票タイトル: title.slice(0, 200),
      売上日: slip.date,
      請求先ID: custId,
      顧客名ID: '',
      伝票種類: '納品書',
      作業区分: '来店',
      担当者: slip.staffName,
      支払い方法: /現/.test(slip.torihikiKubun) ? '現金' : '売掛',
      宛先敬称: '御中',
      車番: carStr,
      管理番号: '',
      税抜合計: zeinukiSum,
      消費税合計: finalZei,
      税込合計: finalZeikomi,
      ステータス: '請求済',
      備考: `弥生伝票${slip.denpyoNo} 倉庫:${slip.soukoName}`,
      件名: '',
      要確認: 0,
      確認項目: '',
      伝票番号: null,
      created_time: slip.date + 'T00:00:00.000Z',
      last_edited_time: slip.date + 'T00:00:00.000Z',
    });

    for (const d of detailsFinal) {
      const tireInfo = extractTireInfo(d.productName);
      const hinmoku = mapHinmoku(d.shohinCode, d.productName);
      const detailCar = extractCar(d.bikou) || (cars.length === 1 ? mainCar : '');
      detailsOut.push({
        id: slipId + '-' + detailIdx,
        売上伝票ID: slipId,
        明細タイトル: `${hinmoku} ${tireInfo.size||''} ${tireInfo.brand||''}`.trim().slice(0,200),
        商品コード: d.shohinCode,
        品目: hinmoku,
        タイヤサイズ: tireInfo.size,
        タイヤ銘柄: tireInfo.brand,
        数量: d.qty,
        単位: d.unit,
        単価: d.price,
        税区分: d.taxName,
        税額: d.zei,
        税込小計: d.zeikomi,
        車番: detailCar,
        備考: hankanaToZen(d.productName).slice(0,200),
        弥生備考: d.bikou.slice(0,200),
        created_time: slip.date + 'T00:00:00.000Z',
        last_edited_time: slip.date + 'T00:00:00.000Z',
      });
      detailIdx++;
    }
  }
  console.log(`  ${file}: slips ${fileSlips.size}, details ${fc}`);
}

console.log(`\n✅ 総伝票: ${slipsOut.length}`);
console.log(`✅ 総明細: ${detailsOut.length}`);

function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function genSQL(tableName, cols, rows) {
  const colList = cols.map(c => `"${c}"`).join(', ');
  const BATCH = 50;
  const statements = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch.map(r => '(' + cols.map(c => esc(r[c])).join(', ') + ')').join(',\n  ');
    statements.push(`INSERT INTO "${tableName}" (${colList}) VALUES\n  ${values};`);
  }
  return statements.join('\n');
}

const slipCols = ['id','伝票タイトル','売上日','請求先ID','顧客名ID','伝票種類','作業区分','担当者','支払い方法','宛先敬称','車番','管理番号','税抜合計','消費税合計','税込合計','ステータス','備考','件名','要確認','確認項目','伝票番号','created_time','last_edited_time'];
const detailCols = ['id','売上伝票ID','明細タイトル','商品コード','品目','タイヤサイズ','タイヤ銘柄','数量','単位','単価','税区分','税額','税込小計','車番','備考','弥生備考','created_time','last_edited_time'];

fs.writeFileSync(path.join(SQL_DIR, '売上伝票.sql'), genSQL('売上伝票', slipCols, slipsOut));
fs.writeFileSync(path.join(SQL_DIR, '売上明細.sql'), genSQL('売上明細', detailCols, detailsOut));
console.log('→ SQL出力完了');

// slipKeyToId を保存（他スクリプトから参照用）
fs.writeFileSync(path.join(EXPORT_DIR, '_slipKeyMap.json'), JSON.stringify([...slipKeyToId.entries()], null, 2));
