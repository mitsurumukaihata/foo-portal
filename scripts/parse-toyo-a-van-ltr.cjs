// TOYO VAN/LTR シート専用パーサー (構造が独特なので別ファイル)
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/タイヤメーカー価格表/PCR夏 システム価格表 (2026年1月1日付) -5.xlsx';
const wb = XLSX.readFile(SRC);

const all = [];

// ─── VAN・TAXI ───
// 左側: サイズ(列0)/加重(列1) + V-03e(2-3)/H30(4-5)/A06(6-7)
// 銘柄列+1 が価格、銘柄列 が記号 (の場合と逆の場合あり、両方探す)
function parseVan() {
  const sh = wb.Sheets['【A表】VAN・TAXI'];
  const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  // 銘柄定義 (左側のみ。右側=フォークリフトは特殊用途で対象外)
  const brandCols = [
    { name: 'DELVEX V-03e', brand: 'DELVEX', symCol: 2, priceCol: 3 },
    { name: 'H30',          brand: null,     symCol: 4, priceCol: 5 },
    { name: 'TOYO i A06',   brand: null,     symCol: 6, priceCol: 7 },
  ];
  let count = 0;
  for (let r = 7; r < data.length; r++) {
    const row = data[r] || [];
    const size = String(row[0]||'').trim();
    if (!size) continue;
    if (!/R\d|\d-\d/.test(size)) continue; // サイズらしいもの
    if (size.length > 30) continue; // 凡例文等
    const lwi = String(row[1]||'').trim(); // 加重指数
    for (const b of brandCols) {
      const sym = String(row[b.symCol]||'').trim();
      const price = row[b.priceCol];
      const numPrice = (typeof price === 'number') ? price :
                       (price && !isNaN(parseInt(String(price).replace(/[,円]/g,''))) ? parseInt(String(price).replace(/[,円]/g,'')) : null);
      if (!numPrice || numPrice <= 0) continue;
      all.push({
        カテゴリ: 'バン', メーカー: 'TOYO', ブランド: b.brand, パターン: b.name,
        サイズ: size.replace(/\s+/g,''), 加重指数: lwi || null,
        注意: sym || null, 価格: numPrice,
        カテゴリ詳細: 'VAN', source: 'TOYO_A_2026-01-01',
        最終更新日: '2026-01-01',
      });
      count++;
    }
  }
  console.log(`【VAN左側】${count}件`);

  // CELSIUS CARGO (オールシーズン) も拾う
  // 行23: ヘッダ「ビジネスバン用オールシーズン」 銘柄「CELSIUS CARGO」
  // 行25以降にデータがあるはず
  let celsiusCount = 0;
  let inCelsius = false;
  for (let r = 23; r < data.length; r++) {
    const row = data[r] || [];
    if (String(row[2]||'').includes('CELSIUS')) { inCelsius = true; continue; }
    if (!inCelsius) continue;
    const size = String(row[0]||'').trim();
    if (!size || !/R\d/.test(size) || size.length > 30) continue;
    const lwi = String(row[1]||'').trim();
    const price = row[3]; // CELSIUS価格列推定
    const numPrice = (typeof price === 'number') ? price :
                     (price && !isNaN(parseInt(String(price).replace(/[,円]/g,''))) ? parseInt(String(price).replace(/[,円]/g,'')) : null);
    if (!numPrice) continue;
    all.push({
      カテゴリ: 'バン', メーカー: 'TOYO', ブランド: null, パターン: 'CELSIUS CARGO',
      サイズ: size.replace(/\s+/g,''), 加重指数: lwi || null,
      注意: null, 価格: numPrice, カテゴリ詳細: 'VAN/オールシーズン',
      source: 'TOYO_A_2026-01-01', 最終更新日: '2026-01-01',
    });
    celsiusCount++;
  }
  console.log(`【VAN CELSIUS】${celsiusCount}件`);
}

// ─── LTR (小型トラック・バス) ───
// ヘッダ行5から銘柄列特定、各銘柄の隣セルの数値を価格と判定
function parseLtr() {
  const sh = wb.Sheets['【A表】LTR'];
  const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  // 銘柄列マップ
  const brandHeaders = data[5] || [];
  const brands = [];
  for (let c = 0; c < brandHeaders.length; c++) {
    const v = String(brandHeaders[c]||'').replace(/\r?\n/g, ' ').replace(/\s+/g,' ').trim();
    if (v && /^M\d|^Ｍ/.test(v)) {
      brands.push({ col: c, name: 'DELVEX ' + v.replace('Ｍ', 'M'), patternOnly: v.replace('Ｍ', 'M') });
    }
  }
  console.log('LTR銘柄列:', brands.map(b => `[${b.col}]${b.patternOnly}`).join(' '));
  let count = 0;
  let lastSize = '';
  for (let r = 7; r < data.length; r++) {
    const row = data[r] || [];
    let size = String(row[0]||'').trim();
    if (size) lastSize = size;
    else size = lastSize;
    const lwi = String(row[1]||'').trim();
    if (!size || !/R\d|\d-\d/.test(size) || size.length > 30) continue;
    for (let i = 0; i < brands.length; i++) {
      const b = brands[i];
      const nextCol = i + 1 < brands.length ? brands[i+1].col : row.length;
      // 銘柄列から次銘柄列までの間に数値セルがあれば価格
      let sym = '';
      let price = null;
      for (let c = b.col; c < nextCol; c++) {
        const v = row[c];
        if (typeof v === 'number' && v > 1000 && v < 1000000) {
          price = v;
          // 価格セルの直前 (1〜2セル) を記号と推定
          if (c > b.col) {
            const prev = String(row[c-1]||'').trim();
            if (prev && prev.length < 6 && !/^\d/.test(prev)) sym = prev;
          }
          break;
        }
      }
      if (!price) continue;
      all.push({
        カテゴリ: 'LTS', メーカー: 'TOYO', ブランド: 'DELVEX', パターン: b.name,
        サイズ: size.replace(/\s+/g,''), 加重指数: lwi || null,
        注意: sym || null, 価格: price,
        カテゴリ詳細: 'LTR小型トラック', source: 'TOYO_A_2026-01-01',
        最終更新日: '2026-01-01',
      });
      count++;
    }
  }
  console.log(`【LTR】${count}件`);
}

parseVan();
parseLtr();

// PCR分も読み込んでマージ
const pcrPath = path.join(__dirname, 'toyo-a-parsed.json');
const pcr = JSON.parse(fs.readFileSync(pcrPath, 'utf8'));
const merged = [...pcr, ...all];

// ブランド整理: PROXES/OPEN COUNTRY/NANOENERGY/TRANPATH はブランド名そのまま
// 個別のブランド処理 (ブランド未指定は null のまま、UI で「(ブランドなし)」表示しないように)
merged.forEach(r => {
  if (r.ブランド === 'OPEN') r.ブランド = 'OPEN COUNTRY';
});

console.log('\n━━━ 最終件数:', merged.length);
const byBrand = {};
merged.forEach(x => { byBrand[x.ブランド || '(ブランドなし)'] = (byBrand[x.ブランド || '(ブランドなし)']||0) + 1; });
console.log('ブランド別:', byBrand);

const out = path.join(__dirname, 'toyo-a-final.json');
fs.writeFileSync(out, JSON.stringify(merged, null, 2));
console.log('💾 保存:', out);
