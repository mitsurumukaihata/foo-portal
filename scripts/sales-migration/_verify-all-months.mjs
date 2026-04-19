// 全移行済み月を一気に verify
import { spawn } from 'child_process';
import path from 'path';

const months = [];
for (let y = 2023; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === 2023 && m < 4) continue;
    if (y === 2026 && m > 3) continue;
    months.push({ y, m });
  }
}

async function runVerify(y, m) {
  return new Promise((resolve) => {
    const args = ['scripts/sales-migration/_verify-month.mjs', '--year', String(y), '--month', String(m)];
    const proc = spawn('node', args, { cwd: 'C:/Users/Mitsuru Mukaihata/Desktop/foo-portal' });
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => out += d);
    proc.on('close', () => {
      const lines = out.split('\n');
      let notionSlips = null, notionDetails = null, notionTotal = null;
      let yayoiSlips = null, yayoiDetails = null, yayoiNetTotal = null;
      let diffSlips = 0, diffDetails = 0, emptyCount = 0, mismatchCount = 0;
      let perfect = false;
      for (const l of lines) {
        let m;
        if ((m = l.match(/弥生 伝票: (\d+) \/ 明細: (\d+)$/))) { yayoiSlips = +m[1]; yayoiDetails = +m[2]; }
        if ((m = l.match(/Notion 伝票: (\d+) \/ 明細: (\d+)/))) { notionSlips = +m[1]; notionDetails = +m[2]; }
        if ((m = l.match(/Notion 伝票税抜合計: ([-\d,]+)/))) notionTotal = +m[1].replace(/,/g, '');
        if ((m = l.match(/弥生 商品日報 純売上額: ([-\d,]+)/))) yayoiNetTotal = +m[1].replace(/,/g, '');
        if ((m = l.match(/差分 伝票: ([-\d,]+)/))) diffSlips = +m[1].replace(/,/g, '');
        if ((m = l.match(/差分 明細: ([-\d,]+)/))) diffDetails = +m[1].replace(/,/g, '');
        if ((m = l.match(/明細0件の伝票: (\d+)/))) emptyCount = +m[1];
        if ((m = l.match(/明細数不一致: (\d+)/))) mismatchCount = +m[1];
        if (l.includes('完全一致')) perfect = true;
      }
      resolve({ y, m, notionSlips, notionDetails, notionTotal, yayoiSlips, yayoiDetails, yayoiNetTotal, diffSlips, diffDetails, emptyCount, mismatchCount, perfect });
    });
  });
}

console.log('年月     | 弥生伝票|Notion伝票| 差 | 弥生明細|Notion明細| 差 | Notion税抜    | 弥生純売上    | 差(円)   | 空伝票|不一致| 判定');
console.log('─'.repeat(140));
for (const {y, m} of months) {
  const r = await runVerify(y, m);
  const diff = (r.notionTotal != null && r.yayoiNetTotal != null) ? r.notionTotal - r.yayoiNetTotal : null;
  const diffStr = diff == null ? 'N/A' : diff.toLocaleString();
  const notionSlips = r.notionSlips ?? '-';
  const notionDetails = r.notionDetails ?? '-';
  const yayoiSlips = r.yayoiSlips ?? '-';
  const yayoiDetails = r.yayoiDetails ?? '-';
  const notionTotal = r.notionTotal?.toLocaleString() ?? '-';
  const yayoiNetTotal = r.yayoiNetTotal?.toLocaleString() ?? '-';
  const mark = r.perfect ? '✅' : '❌';
  console.log(`${y}/${String(m).padStart(2)}  | ${String(yayoiSlips).padStart(7)} | ${String(notionSlips).padStart(8)} | ${String(r.diffSlips).padStart(3)} | ${String(yayoiDetails).padStart(7)} | ${String(notionDetails).padStart(8)} | ${String(r.diffDetails).padStart(3)} | ${notionTotal.padStart(13)} | ${yayoiNetTotal.padStart(13)} | ${diffStr.padStart(8)} | ${String(r.emptyCount).padStart(5)} | ${String(r.mismatchCount).padStart(4)} | ${mark}`);
}
