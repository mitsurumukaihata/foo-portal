// 単一伝票の明細だけを削除→再投入
// 使い方: node _reimport-single-slip.mjs --year 2026 --month 2 --slip 00003928
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

const args = process.argv.slice(2);
function getArg(name, def) { const i = args.indexOf('--' + name); return i === -1 ? def : (args[i+1] || true); }
const YEAR = parseInt(getArg('year', '2026'));
const MONTH = parseInt(getArg('month', '2'));
const SLIP = getArg('slip', '00003928');
const MM = MONTH.toString().padStart(2, '0');
const LAST = new Date(YEAR, MONTH, 0).getDate();
const DATE_FROM = `${YEAR}-${MM}-01`;
const DATE_TO = `${YEAR}-${MM}-${String(LAST).padStart(2,'0')}`;

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

function nf(method, p, body, retries = 3) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 2000); else rej(new Error(c.slice(0, 200))); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 2000); else rej(e); });
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 半角→全角変換（migrate-sales.mjsから抜粋）
function hankanaToZen(s) {
  const map = {'ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ','ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ','ｺ':'コ','ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ','ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ','ﾄ':'ト','ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ','ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ','ﾎ':'ホ','ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ','ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ','ﾗ':'ラ','ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ','ﾜ':'ワ','ｦ':'ヲ','ﾝ':'ン','ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ','ｬ':'ャ','ｭ':'ュ','ｮ':'ョ','ｯ':'ッ','ｰ':'ー','｡':'。','､':'、','｢':'「','｣':'」','ﾞ':'゛','ﾟ':'゜'};
  return String(s).replace(/[\uFF61-\uFF9F]/g, c => map[c] || c);
}

// 簡易品目マッピング
function mapHinmoku(code, name) {
  if (/^LK/.test(code)) return '組替';
  if (/^L?K/.test(code)) return '組替';
  if (/^HT/.test(code)) return 'その他';
  if (/^SH/.test(code)) return '出張';
  if (/^V/.test(code)) return 'バルブ';
  if (/^N/.test(code)) return 'ナット';
  return 'その他';
}
function extractTireInfo(name) {
  const sizeMatch = name.match(/(\d{2,3}\/\d{2}R\d{2}|\d{2,3}R\d{2}|\d{2,3}\.\d{1,2}-\d{2})/);
  return { size: sizeMatch ? sizeMatch[0] : '', brand: '' };
}

console.log(`=== 伝票${SLIP} 単独再投入 ===`);

// Notion伝票を取得
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

let target = null;
for (const s of slips) {
  const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
  if (memo.includes('弥生伝票' + SLIP)) { target = s; break; }
}
if (!target) { console.log('伝票が見つかりません'); process.exit(1); }
console.log('伝票 page_id:', target.id);

// 既存の明細を取得して削除
let existing = [];
let dcur = null;
do {
  const body = { filter: { property: '売上伝票', relation: { contains: target.id } }, page_size: 100 };
  if (dcur) body.start_cursor = dcur;
  const r = await nf('POST', '/databases/' + DETAIL_DB + '/query', body);
  existing.push(...(r.results || []));
  dcur = r.has_more ? r.next_cursor : null;
} while (dcur);
console.log('既存明細:', existing.length, '件 → 削除');
for (const d of existing) {
  await nf('PATCH', '/pages/' + d.id, { archived: true });
  await sleep(120);
}

// Excelから対象伝票の行を取得
let FILE = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
if (!fs.existsSync(FILE)) FILE = `C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細/売上明細　${YEAR}.${MONTH}.xlsx`;
const wb = XLSX.readFile(FILE);
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

// 弥生Excelの列マッピング (migrate-sales.mjs由来):
// r[2]=伝票No, r[7]=税種, r[14]=商品コード, r[15]=商品名, r[20]=倉庫?, r[21]=数量?, r[22]=単価?, r[25]=金額
// 実際にダンプしたら qty/unit/単価が変な列だったので、migrate-sales.mjsの定義を見て再確認

// 一旦ダンプして列を確認
console.log();
console.log('生データ:');
const rows = [];
for (let i = 5; i < data.length; i++) {
  const r = data[i];
  if (!r || !r[2]) continue;
  if (String(r[2]).trim() !== SLIP) continue;
  rows.push(r);
  console.log(`  cols: ${r.slice(0,30).map((c,i)=>`[${i}]${c||''}`).join(' ')}`);
}

console.log();
console.log('Total rows:', rows.length);
console.log('※ このスクリプトは現状確認用。実際の再投入は migrate-sales.mjs の列定義に合わせて個別実装が必要');
