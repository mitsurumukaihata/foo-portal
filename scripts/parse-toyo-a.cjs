// TOYO PCR A表 (2026年1月1日付) パーサー
// 出力: TOYO_A.json (D1 A表テーブル投入用)
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/タイヤメーカー価格表/PCR夏 システム価格表 (2026年1月1日付) -5.xlsx';
const OUT = path.join(__dirname, 'toyo-a-parsed.json');

const wb = XLSX.readFile(SRC);

// シート → カテゴリ・カテゴリ詳細
const SHEET_MAP = {
  '【A表】R22-20': { cat: 'PC', detail: 'R22-20' },
  '【A表】R19':    { cat: 'PC', detail: 'R19' },
  '【A表】R18-17': { cat: 'PC', detail: 'R18-17' },
  '【A表】R16-15': { cat: 'PC', detail: 'R16-15' },
  '【A表】R14-13・オールシーズン': { cat: 'PC', detail: 'R14-13/AS' },
  '【A表】モータースポーツ': { cat: 'PC', detail: 'モータースポーツ' },
  '【A表】SUV R20-17': { cat: 'PC', detail: 'SUV R20-17' },
  '【A表】SUV R16-12': { cat: 'PC', detail: 'SUV R16-12' },
  '【A表】VAN・TAXI': { cat: 'バン', detail: 'VAN/TAXI' },
  '【A表】LTR':       { cat: 'LTS', detail: 'LTR小型' },
};

// 銘柄名のクリーン化 (改行・余分な空白除去、シンプル化)
function cleanBrand(s) {
  if (!s) return null;
  return String(s)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 速度記号を綺麗に
function cleanSpeed(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, '').trim();
}

// 注意マーク (XL/▼/◇/◆/②/WL等)
function cleanMark(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, '').trim();
}

const all = [];
const stats = {};

for (const [sheetName, meta] of Object.entries(SHEET_MAP)) {
  const sh = wb.Sheets[sheetName];
  if (!sh) { console.log('  ⚠ 未存在:', sheetName); continue; }
  const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  // ヘッダ探索: 「リム径」「サイズ」を含む行
  let headerRow = -1;
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i] || [];
    const txt = row.map(x => String(x||'')).join('|');
    if (txt.includes('リム径') || /\d+-\d+インチ|インチ/.test(txt)) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) { console.log('  ⚠ ヘッダ未検出:', sheetName); continue; }
  const header = data[headerRow] || [];
  // 銘柄列の位置を特定: 銘柄テキストは "サイズ" 列の右隣 + 3列ごとにある可能性
  // サイズ列を探す
  let sizeCol = -1;
  for (let c = 0; c < header.length; c++) {
    const v = String(header[c]||'');
    if (/インチ$/.test(v) || /\d+-\d+インチ/.test(v)) { sizeCol = c; break; }
  }
  if (sizeCol < 0) {
    // フォールバック: "サイズ"を含む列
    for (let c = 0; c < header.length; c++) {
      if (String(header[c]||'').includes('サイズ')) { sizeCol = c; break; }
    }
  }
  if (sizeCol < 0) { console.log('  ⚠ サイズ列未検出:', sheetName); continue; }

  // 銘柄列: sizeCol+1 から3列ずつ
  const brands = [];
  for (let c = sizeCol + 1; c < header.length; c += 3) {
    const brandName = cleanBrand(header[c]);
    if (brandName) brands.push({ col: c, name: brandName });
  }
  console.log(`━━ ${sheetName} (sizeCol=${sizeCol}, 銘柄${brands.length}個):`);
  brands.forEach(b => console.log(`    [${b.col}] ${b.name}`));

  // データ行: ヘッダ+2行目以降から
  let count = 0;
  let lastSize = null;
  for (let r = headerRow + 2; r < data.length; r++) {
    const row = data[r] || [];
    let size = String(row[sizeCol]||'').trim();
    if (!size && lastSize && row[sizeCol-1] === '') size = lastSize; // 結合セルフォロー
    if (!size || size === '') continue;
    // サイズらしい? (例: 265/35 R22, LT265/50R20 110/107Q)
    if (!/\d+\/\d+\s*R\d/.test(size) && !/\d+R\d/.test(size) && !/\d+\.\d+-\d+/.test(size)) continue;
    lastSize = size;
    // 各銘柄列を読む
    for (const b of brands) {
      const speed = cleanSpeed(row[b.col]);
      const mark = cleanMark(row[b.col + 1]);
      const price = row[b.col + 2];
      // 価格があるエントリのみ採用
      const numPrice = (typeof price === 'number') ? price : (price && !isNaN(parseInt(String(price).replace(/[,円]/g,''))) ? parseInt(String(price).replace(/[,円]/g,'')) : null);
      if (!numPrice || numPrice <= 0) continue;
      // サイズ正規化 (空白除去)
      const sizeNorm = size.replace(/\s+/g, '');
      all.push({
        カテゴリ: meta.cat,
        メーカー: 'TOYO',
        ブランド: b.name.split(' ')[0], // PROXES / OPEN / TRANPATH 等
        パターン: b.name,
        サイズ: sizeNorm,
        加重指数: speed || null,
        注意: mark || null,
        価格: numPrice,
        カテゴリ詳細: meta.detail,
        source: 'TOYO_A_2026-01-01',
        最終更新日: '2026-01-01',
      });
      count++;
    }
  }
  stats[sheetName] = count;
  console.log(`    → ${count}エントリ抽出`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━');
console.log('全体抽出件数:', all.length);
console.log('シート別:', JSON.stringify(stats, null, 2));

// ブランド別集計
const byBrand = {};
all.forEach(x => { byBrand[x.ブランド] = (byBrand[x.ブランド]||0) + 1; });
console.log('\nブランド別件数:', byBrand);

// パターン別ユニーク数
const patterns = new Set(all.map(x => x.パターン));
console.log('\nユニークパターン数:', patterns.size);
console.log('パターン例:', [...patterns].slice(0, 30));

fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
console.log('\n💾 保存:', OUT);
