// 任意月で「Notionにあるが弥生伝票番号が重複 or 弥生にない」伝票を検出
// 使い方: node _find-extra-slips.mjs --year 2023 --month 6 [--apply]
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

function getArg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i+1]; }
const YEAR = parseInt(getArg('year'));
const MONTH = parseInt(getArg('month'));
const APPLY = process.argv.includes('--apply');
if (!YEAR || !MONTH) { console.log('--year YYYY --month M 必須'); process.exit(1); }

const DATE_FROM = `${YEAR}-${String(MONTH).padStart(2,'0')}-01`;
const DATE_TO = `${YEAR}-${String(MONTH).padStart(2,'0')}-${new Date(YEAR, MONTH, 0).getDate()}`;
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

function nf(method, p, body, retries = 20) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try { const p = JSON.parse(c); if (p.object === 'error' && p.code === 'rate_limited' && n > 0) { setTimeout(() => tryFetch(n-1), 60000); return; } res(p); } catch(e) { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(new Error(c.slice(0, 300))); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 弥生
const candidates = [
  `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`,
];
const qs = [[1,3],[4,6],[7,9],[10,12]];
for (const [s, e] of qs) if (MONTH >= s && MONTH <= e) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${s}-${YEAR}.${e}.xlsx`);
if (MONTH >= 4) candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.4-${YEAR+1}.3.xlsx`);
else candidates.push(`C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR-1}.4-${YEAR}.3.xlsx`);
const FILE = candidates.find(p => fs.existsSync(p));

const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const yayoiNums = new Set();
for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[2]) continue;
  const ds = row[1];
  if (typeof ds === 'number') {
    const dt = new Date((ds - 25569) * 86400 * 1000);
    if (dt.getFullYear() !== YEAR || dt.getMonth() + 1 !== MONTH) continue;
  }
  yayoiNums.add(String(row[2]).trim());
}

// Notion
console.log(APPLY ? '[APPLY]' : '[DRY]', YEAR + '/' + MONTH);
const slips = [];
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: DATE_FROM } },
    { property: '売上日', date: { on_or_before: DATE_TO } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  slips.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('弥生伝票数:', yayoiNums.size, ', Notion伝票数:', slips.length);

// グループ化
const groups = new Map();  // num → [{s, created, zeinuki, ...}]
const unnumbered = [];
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const m = memo.match(/弥生伝票(\d+)/);
  const info = {
    pageId: s.id,
    created: s.created_time,
    zeinuki: s.properties['税抜合計']?.number || 0,
    zeikomi: s.properties['税込合計']?.number || 0,
    title: s.properties['伝票タイトル']?.title?.[0]?.plain_text || '',
    memo: memo.slice(0, 80),
  };
  if (m) {
    const num = m[1];
    if (!groups.has(num)) groups.set(num, []);
    groups.get(num).push(info);
  } else {
    unnumbered.push(info);
  }
}

// 重複・弥生にないもの・番号なしを列挙
const dups = [...groups.entries()].filter(([n, a]) => a.length > 1);
const notInYayoi = [...groups.entries()].filter(([n, a]) => !yayoiNums.has(n));

console.log('\n=== 検出 ===');
console.log('重複弥生番号:', dups.length, '件');
for (const [num, arr] of dups) {
  console.log(`  弥生${num} → ${arr.length}件`);
  arr.sort((a, b) => a.created.localeCompare(b.created));
  for (const a of arr) console.log(`    [${a.pageId.slice(0,8)}] created=${a.created.slice(0,16)} 税抜=${a.zeinuki.toLocaleString()} title="${a.title.slice(0,40)}"`);
}
console.log('\n弥生に存在しない伝票:', notInYayoi.length, '件');
for (const [num, arr] of notInYayoi) for (const a of arr) console.log(`  弥生${num}[${a.pageId.slice(0,8)}] 税抜=${a.zeinuki.toLocaleString()} "${a.title.slice(0,40)}"`);
console.log('\n弥生伝票番号なしNotion:', unnumbered.length, '件');
for (const a of unnumbered) console.log(`  [${a.pageId.slice(0,8)}] 税抜=${a.zeinuki.toLocaleString()} "${a.title.slice(0,40)}"`);

// 削除対象: 重複は新しい方、弥生に存在しない伝票、番号なし（zeinuki=0の空伝票は優先して削除）
const toDelete = [];
for (const [num, arr] of dups) {
  arr.sort((a, b) => a.created.localeCompare(b.created));  // 古い順
  for (let i = 1; i < arr.length; i++) toDelete.push({ reason: '重複', ...arr[i] });
}
for (const [num, arr] of notInYayoi) for (const a of arr) toDelete.push({ reason: '弥生なし', ...a });
for (const a of unnumbered) {
  if (a.zeinuki === 0) toDelete.push({ reason: '番号なし空伝票', ...a });
}

console.log('\n=== 削除対象: ' + toDelete.length + '件 ===');
for (const d of toDelete) console.log(`  [${d.reason}] ${d.pageId.slice(0,8)} 税抜=${d.zeinuki.toLocaleString()} "${d.title.slice(0,40)}"`);

if (APPLY && toDelete.length > 0) {
  console.log('\n[APPLY] 削除開始...');
  let ok = 0;
  for (const d of toDelete) {
    // 明細も先に削除
    const dd = [];
    let dcur = null;
    do {
      const body = { filter: { property: '売上伝票', relation: { contains: d.pageId } }, page_size: 100 };
      if (dcur) body.start_cursor = dcur;
      const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
      dd.push(...(r.results || []));
      dcur = r.has_more ? r.next_cursor : null;
    } while (dcur);
    for (const det of dd) {
      try { await nf('PATCH', '/pages/' + det.id, { archived: true }); } catch(_) {}
      await sleep(200);
    }
    try {
      const r = await nf('PATCH', '/pages/' + d.pageId, { archived: true });
      if (r.object === 'error' && !/archived/.test(r.message || '')) console.warn('  error:', r.message);
      else ok++;
    } catch(e) { console.error('  err:', e.message); }
    await sleep(250);
  }
  console.log('削除完了:', ok, '件');
}
