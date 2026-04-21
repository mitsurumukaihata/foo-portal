#!/usr/bin/env node
// 仕入伝票・仕入明細を purchase-slips.json (弥生発行CSV) から直接D1 SQL生成
// 2328件の弥生データが真実源

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(SCRIPT_DIR, 'sql');
const EXPORT_DIR = path.join(SCRIPT_DIR, 'export');
const SRC_PATH = path.resolve(SCRIPT_DIR, '..', 'scripts/purchase-migration/purchase-slips.json');

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

function guessMaker(name, productName) {
  const t = ((name||'') + ' ' + (productName||'')).toUpperCase();
  if (/ﾄｰﾖｰ|TOYO/i.test(t)) return 'TOYO';
  if (/ﾌﾞﾘﾁﾞｽﾄﾝ|ブリヂストン|BRIDGESTONE|BS/i.test(t)) return 'BRIDGESTONE';
  if (/ﾀﾞﾝﾛｯﾌﾟ|ダンロップ|DUNLOP|SP\b/.test(t)) return 'DUNLOP';
  if (/ﾐｼｭﾗﾝ|ミシュラン|MICHELIN|XJE|XDW/.test(t)) return 'MICHELIN';
  if (/ピレリ|PIRELLI/.test(t)) return 'PIRELLI';
  return 'その他';
}
function extractSize(pn) { const m = (pn||'').match(/\d{3}\/\d{2}R\d+(?:\.\d)?/); return m ? m[0] : ''; }

// 仕入先マスタ from Notion export
const supsJson = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, '仕入先マスタ.json'), 'utf-8'));
const supCodeToId = new Map();
const supNameToId = new Map();
for (const s of supsJson) {
  const code = s.properties['仕入先コード']?.rich_text?.[0]?.plain_text || '';
  const name = s.properties['仕入先名']?.title?.[0]?.plain_text || '';
  if (code) supCodeToId.set(code, s.id);
  if (name) supNameToId.set(name, s.id);
}
console.log('仕入先マップ: コード', supCodeToId.size, '/ 名前', supNameToId.size);

const slipsRaw = JSON.parse(fs.readFileSync(SRC_PATH, 'utf-8'));
const slipKeyToId = new Map();
const slipsOut = [];
const detailsOut = [];
let dupCount = 0;

for (const slip of slipsRaw) {
  const key = slip.slipNo + '|' + slip.date;
  if (slipKeyToId.has(key)) { dupCount++; continue; }
  const slipId = 'pslp-' + randomUUID();
  slipKeyToId.set(key, slipId);

  let taxCredit = '適格100%';
  if (slip.taxCredit?.includes('80')) taxCredit = '経過措置80%';
  else if (slip.taxCredit?.includes('50')) taxCredit = '経過措置50%';
  else if (slip.taxCredit?.includes('控除不可') || slip.taxCredit?.includes('未登録')) taxCredit = '控除不可';

  const subtotal = slip.details.reduce((s,d)=>s+(d.amount||0),0) - (slip.taxAmount||0);
  const grandTotal = slip.details.reduce((s,d)=>s+(d.amount||0),0);

  const supplierId = supCodeToId.get(slip.supplierCode) || supNameToId.get(slip.supplierName) || '';

  slipsOut.push({
    id: slipId,
    伝票タイトル: `${slip.date || '?'} ${slip.supplierName || '?'}`.slice(0, 200),
    仕入日: slip.date,
    入荷日: slip.date,
    弥生伝票番号: slip.slipNo,
    仕入先ID: supplierId,
    担当者: slip.staff ? slip.staff.replace('　', ' ') : null,
    税抜合計: subtotal,
    消費税合計: slip.taxAmount || 0,
    税込合計: grandTotal,
    仕入税額控除: taxCredit,
    ステータス: '支払済',
    発注番号: null,
    備考: `弥生#${slip.slipNo} ${slip.taxKb || ''}`,
    伝票番号: null,
    created_time: slip.date + 'T00:00:00.000Z',
    last_edited_time: slip.date + 'T00:00:00.000Z',
  });

  let di = 0;
  for (const d of slip.details) {
    const size = extractSize(d.productName);
    const maker = guessMaker(slip.supplierName, d.productName);
    let taxType = '外税';
    if (d.taxType?.includes('内税')) taxType = '内税';
    else if (d.taxType?.includes('非課税')) taxType = '非課税';
    else if (d.taxType?.includes('軽減')) taxType = '軽減税率';

    detailsOut.push({
      id: slipId + '-' + di,
      仕入伝票ID: slipId,
      明細タイトル: `${d.productCode || ''} ${d.productName || ''}`.slice(0, 200),
      商品コード: d.productCode || '',
      品名: (d.productName || '').slice(0, 200),
      タイヤサイズ: size,
      銘柄: '',
      メーカー: maker !== 'その他' ? maker : null,
      数量: d.qty || 0,
      単位: d.unit || null,
      単価: d.price || 0,
      税込小計: d.amount || 0,
      税額: 0,
      税区分: taxType,
      備考: (d.memo || '').slice(0, 200),
      created_time: slip.date + 'T00:00:00.000Z',
      last_edited_time: slip.date + 'T00:00:00.000Z',
    });
    di++;
  }
}

console.log(`伝票: ${slipsOut.length} / 明細: ${detailsOut.length} / dedup skip: ${dupCount}`);

const slipCols = ['id','伝票タイトル','仕入日','入荷日','弥生伝票番号','仕入先ID','担当者','税抜合計','消費税合計','税込合計','仕入税額控除','ステータス','発注番号','備考','伝票番号','created_time','last_edited_time'];
const detailCols = ['id','仕入伝票ID','明細タイトル','商品コード','品名','タイヤサイズ','銘柄','メーカー','数量','単位','単価','税込小計','税額','税区分','備考','created_time','last_edited_time'];

fs.writeFileSync(path.join(SQL_DIR, '仕入伝票.sql'), genSQL('仕入伝票', slipCols, slipsOut));
fs.writeFileSync(path.join(SQL_DIR, '仕入明細.sql'), genSQL('仕入明細', detailCols, detailsOut));
console.log('→ SQL出力完了');
