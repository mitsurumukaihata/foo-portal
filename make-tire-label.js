const PptxGenJS = require(require('path').join(
  require('os').homedir(), 'AppData/Roaming/npm/node_modules/pptxgenjs'
));

const pres = new PptxGenJS();

// A4 縦
pres.defineLayout({ name: 'A4', width: 8.27, height: 11.69 });
pres.layout = 'A4';

const slide = pres.addSlide();
slide.background = { color: 'F2F2F2' };

// ラベルデータ（各2枚ずつ）
const labels = [
  { num: 'M935', type: '\u2744 スタッドレス', size: '205/75 R16', col: '1a5faa' },
  { num: 'M935', type: '\u2744 スタッドレス', size: '205/75 R16', col: '1a5faa' },
  { num: 'M135', type: 'リブ',               size: '205/70 R16', col: '1e7a3a' },
  { num: 'M135', type: 'リブ',               size: '205/70 R16', col: '1e7a3a' },
  { num: 'M634', type: 'ラグ',               size: '205/75 R16', col: 'c0292a' },
  { num: 'M634', type: 'ラグ',               size: '205/75 R16', col: 'c0292a' },
];

const margin = 0.45;  // 外周マージン
const gapX   = 0.40;  // 列間（カット余白）
const gapY   = 0.38;  // 行間（カット余白）
const cols   = 2;
const rows   = 3;
const cardW  = (8.27 - margin * 2 - gapX * (cols - 1)) / cols;  // ≈ 3.49"
const cardH  = (11.69 - margin * 2 - gapY * (rows - 1)) / rows; // ≈ 3.42"

const bandH  = 0.52;  // カラー帯
const padX   = 0.20;  // カード内 左右パディング

labels.forEach((lbl, i) => {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x   = margin + col * (cardW + gapX);
  const y   = margin + row * (cardH + gapY);

  // カード本体（白 + 影）
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: cardW, h: cardH,
    fill: { color: 'FFFFFF' },
    line: { color: 'BBBBBB', width: 0.75 },
    shadow: { type: 'outer', color: '000000', blur: 12, offset: 3, angle: 135, opacity: 0.10 },
  });

  // カラー帯（上部）
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: cardW, h: bandH,
    fill: { color: lbl.col },
    line: { color: lbl.col, width: 0 },
  });

  // タイプ（帯内中央）
  slide.addText(lbl.type, {
    x, y, w: cardW, h: bandH,
    fontSize: 15, color: 'FFFFFF', bold: true,
    align: 'center', valign: 'middle',
    fontFace: 'Arial',
    margin: 0,
  });

  // --- コンテンツ垂直センタリング ---
  // 利用可能高さ（帯の下）
  const bodyTop = y + bandH;
  const bodyH   = cardH - bandH;

  // 各要素の高さ
  const prefH = 0.26;  // "DELVEX"
  const numH  = 1.25;  // "M935"
  const sizH  = 0.65;  // "205/75 R16"
  const sp1   = 0.04;  // prefix〜num間
  const sp2   = 0.08;  // num〜size間

  const totalContent = prefH + sp1 + numH + sp2 + sizH;
  const topPad = (bodyH - totalContent) / 2;

  const prefY = bodyTop + topPad;
  const numY  = prefY + prefH + sp1;
  const sizY  = numY + numH + sp2;

  // "DELVEX" 小テキスト
  slide.addText('DELVEX', {
    x: x + padX, y: prefY,
    w: cardW - padX * 2, h: prefH,
    fontSize: 12, color: lbl.col, bold: true,
    fontFace: 'Arial',
    charSpacing: 4,
    margin: 0,
  });

  // パターン番号（極大）
  slide.addText(lbl.num, {
    x: x + padX, y: numY,
    w: cardW - padX * 2, h: numH,
    fontSize: 76, color: lbl.col, bold: true,
    fontFace: 'Arial Black',
    valign: 'top',
    margin: 0,
  });

  // サイズ
  slide.addText(lbl.size, {
    x: x + padX, y: sizY,
    w: cardW - padX * 2, h: sizH,
    fontSize: 26, color: '111111', bold: true,
    fontFace: 'Arial Black',
    valign: 'top',
    margin: 0,
  });
});

// カット補助線（破線）
// 縦線（列間）
for (let c = 1; c < cols; c++) {
  const lx = margin + c * cardW + (c - 0.5) * gapX;
  slide.addShape(pres.shapes.LINE, {
    x: lx, y: 0.1, w: 0, h: 11.49,
    line: { color: 'AAAAAA', width: 1, dashType: 'dash' },
  });
}
// 横線（行間）
for (let r = 1; r < rows; r++) {
  const ly = margin + r * cardH + (r - 0.5) * gapY;
  slide.addShape(pres.shapes.LINE, {
    x: 0.1, y: ly, w: 8.07, h: 0,
    line: { color: 'AAAAAA', width: 1, dashType: 'dash' },
  });
}

const outPath = 'C:\\Users\\Mitsuru Mukaihata\\Desktop\\foo-portal\\tire-label.pptx';
pres.writeFile({ fileName: outPath }).then(() => {
  console.log('Done:', outPath);
}).catch(err => {
  console.error(err);
});
