// 弥生売上明細 → Notion 移行スクリプト
// 使い方:
//   node _migrate-sales.mjs --file "売上明細　2026.3.xlsx" --limit 3   (テスト3伝票)
//   node _migrate-sales.mjs --file "売上明細　2026.3.xlsx"             (全件)
//   node _migrate-sales.mjs --file "売上明細　2026.3.xlsx" --dryrun    (実行せず集計のみ)

import https from 'https';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

// ─── 引数 ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  return args[i + 1] || true;
}
const FILE_NAME = getArg('file', '売上明細　2026.3.xlsx');
const LIMIT = parseInt(getArg('limit', '0')) || 0;   // 0 = 全件
const DRY_RUN = !!getArg('dryrun', false);
const ONLY_RAW = getArg('only', '');  // カンマ区切りの伝票番号（リトライ用）
const ONLY_SET = ONLY_RAW && typeof ONLY_RAW === 'string' ? new Set(ONLY_RAW.split(',')) : null;
// バンドルファイル用の年月フィルタ（例: 2024.4-2025.3.xlsx から2024/5だけ抽出）
const TARGET_YEAR = parseInt(getArg('target-year', '0')) || 0;
const TARGET_MONTH = parseInt(getArg('target-month', '0')) || 0;

// ファイルパス: ルート or サブフォルダ(売上明細/)を自動判定
let FILE_PATH = path.join('C:/Users/Mitsuru Mukaihata/Desktop/売上明細', FILE_NAME);
if (!fs.existsSync(FILE_PATH)) {
  FILE_PATH = path.join('C:/Users/Mitsuru Mukaihata/Desktop/売上明細/売上明細', FILE_NAME);
}

// ─── Notion API ─────────────────────────────────────────────────
const WORKER = 'notion-proxy.33322666666mm.workers.dev';
const SALES_DB  = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const CUST_DB   = '1ca8d122be214e3892879932147143c9';

function nf(method, path, body, retries = 5) {
  return new Promise((resolve, reject) => {
    const tryFetch = (n) => {
      const data = body ? JSON.stringify(body) : '';
      const req = https.request({
        hostname: WORKER, path, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, res => {
        let c = '';
        res.on('data', d => c += d);
        res.on('end', () => {
          try { resolve(JSON.parse(c)); }
          catch(e) {
            if (n > 0) setTimeout(() => tryFetch(n - 1), 3000);
            else reject(new Error('Parse error: ' + c.slice(0, 200)));
          }
        });
      });
      req.on('error', (e) => {
        if (n > 0) setTimeout(() => tryFetch(n - 1), 3000);
        else reject(e);
      });
      req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
      if (data) req.write(data);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 顧客マスタ取得（弥生コード → Notion ID のマップ） ──────────
async function buildCustomerMap() {
  const all = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await nf('POST', `/databases/${CUST_DB}/query`, body);
    all.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  const map = new Map();
  all.forEach(p => {
    const code = p.properties['弥生得意先コード']?.rich_text?.[0]?.plain_text || '';
    if (code) {
      code.split(',').map(c => c.trim()).forEach(c => map.set(c, p.id));
    }
  });
  return map;
}

// ─── 半角カナ → 全角カナ ─────────────────────────────────────────
const HAN_KANA_PAIR = ['ｶﾞ','ガ','ｷﾞ','ギ','ｸﾞ','グ','ｹﾞ','ゲ','ｺﾞ','ゴ','ｻﾞ','ザ','ｼﾞ','ジ','ｽﾞ','ズ','ｾﾞ','ゼ','ｿﾞ','ゾ','ﾀﾞ','ダ','ﾁﾞ','ヂ','ﾂﾞ','ヅ','ﾃﾞ','デ','ﾄﾞ','ド','ﾊﾞ','バ','ﾋﾞ','ビ','ﾌﾞ','ブ','ﾍﾞ','ベ','ﾎﾞ','ボ','ﾊﾟ','パ','ﾋﾟ','ピ','ﾌﾟ','プ','ﾍﾟ','ペ','ﾎﾟ','ポ','ｳﾞ','ヴ','ｱ','ア','ｲ','イ','ｳ','ウ','ｴ','エ','ｵ','オ','ｶ','カ','ｷ','キ','ｸ','ク','ｹ','ケ','ｺ','コ','ｻ','サ','ｼ','シ','ｽ','ス','ｾ','セ','ｿ','ソ','ﾀ','タ','ﾁ','チ','ﾂ','ツ','ﾃ','テ','ﾄ','ト','ﾅ','ナ','ﾆ','ニ','ﾇ','ヌ','ﾈ','ネ','ﾉ','ノ','ﾊ','ハ','ﾋ','ヒ','ﾌ','フ','ﾍ','ヘ','ﾎ','ホ','ﾏ','マ','ﾐ','ミ','ﾑ','ム','ﾒ','メ','ﾓ','モ','ﾔ','ヤ','ﾕ','ユ','ﾖ','ヨ','ﾗ','ラ','ﾘ','リ','ﾙ','ル','ﾚ','レ','ﾛ','ロ','ﾜ','ワ','ｦ','ヲ','ﾝ','ン','ｧ','ァ','ｨ','ィ','ｩ','ゥ','ｪ','ェ','ｫ','ォ','ｬ','ャ','ｭ','ュ','ｮ','ョ','ｯ','ッ','ｰ','ー','｡','。','､','、','｢','「','｣','」','･','・'];
function hankanaToZen(s) {
  if (!s) return s;
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.substr(i, 2);
    const one = s[i];
    let replaced = false;
    for (let j = 0; j < HAN_KANA_PAIR.length; j += 2) {
      if (HAN_KANA_PAIR[j] === two) { r += HAN_KANA_PAIR[j+1]; i++; replaced = true; break; }
    }
    if (replaced) continue;
    for (let j = 0; j < HAN_KANA_PAIR.length; j += 2) {
      if (HAN_KANA_PAIR[j] === one) { r += HAN_KANA_PAIR[j+1]; replaced = true; break; }
    }
    if (!replaced) r += one;
  }
  return r;
}

// ─── Excelシリアル日付 → ISO日付 ─────────────────────────────────
function excelDateToISO(serial) {
  const n = typeof serial === 'number' ? serial : parseFloat(serial);
  if (!n || isNaN(n)) return null;
  // Excel は 1900/1/1 = 1 のシリアル（Lotus 1-2-3 のバグで 1900/2/29 を計上）
  // Date.UTC(1899, 11, 30) = Excel シリアル 0 相当
  const ms = (n - 25569) * 86400 * 1000;  // 25569 = 1970/1/1 のシリアル値
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// ─── 品目マッピング ────────────────────────────────────────────
function mapHinmoku(code, name) {
  const c = (code || '').toUpperCase();
  const n = name || '';
  // 中古・再生・廃を優先判定
  if (/廃タイヤ/.test(n)) return '廃タイヤ';
  if (/中古ホイール/.test(n)) return 'ホイール';
  if (/再生|更生/.test(n)) return 'タイヤ販売(更生)';
  if (/中古/.test(n)) return 'タイヤ販売(中古)';
  // 作業コード優先
  if (/Fバランス/.test(n)) return 'Fバランス';
  if (/^SH01/.test(c) || /市内出張/.test(n)) return '出張(市内)';
  if (/^SH02/.test(c) || /市外出張/.test(n)) return '出張(市外)';
  // 作業: LK/LKL/TK/PK/OR/TPPTK の末尾番号で判定
  const wm = c.match(/^(LKL|LK|TK|PK|OR|TPPTK)(\d+)/);
  if (wm) {
    const num = wm[2];
    if (num === '01') return '組替';
    if (num === '02' || num === '022' || num === '05') return /脱着/.test(n) ? '脱着' : (num === '05' ? 'その他' : '脱着');
    if (num === '03') return 'バランス';
  }
  if (/組替/.test(n)) return '組替';
  if (/脱着/.test(n)) return '脱着';
  if (/バランス/.test(n)) return 'バランス';
  // ハイタイヤ・f.o.oパック・その他作業・バルブ・ナット等
  if (/^HT/.test(c)) return 'その他';
  if (/^FOO/.test(c)) return 'f.o.oパック';
  if (/^ST/i.test(c)) return 'その他';
  if (/^CH06/.test(c)) return 'ホイール';
  // 数字プレフィックス + 銘柄 → タイヤ新品
  if (/^\d/.test(c)) return 'タイヤ販売(新品)';
  return 'その他';
}

// ─── 税区分マッピング ──────────────────────────────────────────
function mapTaxKubun(s) {
  if (!s) return '課税(10%)';
  if (/10\.0%|10%|課税/.test(s)) return '課税(10%)';
  if (/8\.0%|8%|軽減/.test(s)) return '軽減税率(8%)';
  if (/非課税/.test(s)) return '非課税';
  return '課税(10%)';
}

// ─── タイヤサイズ・銘柄抽出 ────────────────────────────────────
function extractTireInfo(productName) {
  const n = hankanaToZen(productName || '');
  // サイズパターン: 245/70R19.5, 275/80R22.5, 11R22.5, 145/80R12, 165R13 等
  const sizeMatch = n.match(/(\d{2,3}(?:\/\d{2,3})?R\d{1,3}(?:\.\d)?)/);
  const size = sizeMatch ? sizeMatch[1] : '';
  // 銘柄: Mxxx, Rxxx, Wxxx, Vxxx, SPxxx, Gxxx, XDWxxx, PIRELLIxxx等
  // サイズより前にあるアルファベット+数字
  const beforeSize = sizeMatch ? n.slice(0, sizeMatch.index).trim() : n;
  const brandMatch = beforeSize.match(/([MRWVGXDSP][A-Z0-9a-z]*\d+[a-zA-Z]*)/);
  const brand = brandMatch ? brandMatch[1] : '';
  return { size, brand };
}

// ─── 作業区分（売上伝票レベル）は弥生データに無いので「来店」をデフォルト ───
function guessWorkType(details) {
  // 出張が含まれていれば出張作業
  for (const d of details) {
    const n = d.productName || '';
    if (/市外出張/.test(n)) return '出張作業';
    if (/市内出張/.test(n)) return '出張作業';
  }
  return '来店';
}

// ─── 支払い方法マッピング ─────────────────────────────────────
function mapPayment(torihikiKubun) {
  if (!torihikiKubun) return '売掛';
  if (/掛/.test(torihikiKubun)) return '売掛';
  if (/現/.test(torihikiKubun)) return '現金';
  if (/カード/.test(torihikiKubun)) return 'クレジットカード';
  return '売掛';
}

// ─── 担当者正規化（念のため） ─────────────────────────────────
function normalizeStaff(s) {
  if (!s) return '';
  return hankanaToZen(s).trim();
}

// ─── 車番抽出（備考から） ─────────────────────────────────────
const CAR_NUMBER_RE = /([\u4e00-\u9fff\u3040-\u309f]{1,4}\s*\d{2,4}\s*[\u3040-\u309f]\s*\d{1,4}-\d{1,4})/;
function extractCarNumber(bikou) {
  if (!bikou) return '';
  const m = bikou.match(CAR_NUMBER_RE);
  return m ? m[1].replace(/\s/g, '') : '';
}

// ═════════════════════════════════════════════════════════════
// メイン処理
// ═════════════════════════════════════════════════════════════
async function main() {
  console.log('=== 弥生 → Notion 移行スクリプト ===');
  console.log('ファイル:', FILE_PATH);
  console.log('モード:', DRY_RUN ? 'DRY RUN (実行なし)' : (LIMIT > 0 ? 'テスト(' + LIMIT + '伝票)' : '本番(全件)'));
  console.log();

  if (!fs.existsSync(FILE_PATH)) {
    console.error('❌ ファイルが見つかりません:', FILE_PATH);
    process.exit(1);
  }

  // 1. 顧客マップ取得
  console.log('📥 顧客マスタから 弥生コード→Notion ID マップを構築中...');
  const custMap = await buildCustomerMap();
  console.log('   マップサイズ:', custMap.size, '件');
  console.log();

  // 2. Excel読込
  console.log('📖 Excelファイル読込中...');
  const wb = XLSX.readFile(FILE_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log('   総行数:', rows.length);

  // 3. 伝票単位にグループ化（行6以降、最終行は総合計なので除外）
  const slips = new Map();  // 伝票番号 → { header, details }
  let yayoiTotal = 0;
  if (TARGET_YEAR && TARGET_MONTH) {
    console.log(`   🔍 年月フィルタ: ${TARGET_YEAR}/${TARGET_MONTH}`);
  }
  for (let i = 5; i < rows.length - 1; i++) {
    const row = rows[i];
    const denpyoNo = String(row[2] || '').trim();
    if (!denpyoNo) continue;
    // バンドルファイル用の年月フィルタ
    if (TARGET_YEAR && TARGET_MONTH) {
      const ds = row[1];
      if (typeof ds === 'number') {
        const dt = new Date((ds - 25569) * 86400 * 1000);
        if (dt.getFullYear() !== TARGET_YEAR || dt.getMonth() + 1 !== TARGET_MONTH) continue;
      }
    }
    const shohinName = String(row[15] || '').trim();
    // 消費税行は明細としては登録しないが、伝票の正確な消費税額として保存
    if (shohinName === '《消費税》') {
      yayoiTotal += parseFloat(row[25] || 0);
      // 対応する伝票に消費税額を記録
      if (slips.has(denpyoNo)) {
        const s = slips.get(denpyoNo);
        if (!s.yayoiTax) s.yayoiTax = 0;
        s.yayoiTax += parseFloat(row[25] || 0);
      }
      continue;
    }
    const dateSerial = row[1];
    const torihikiKubun = String(row[3] || '').trim();
    const custCode = String(row[5] || '').trim();
    const custName = String(row[6] || '').trim();
    const zeiTenka = String(row[7] || '').trim();     // 外税/伝票計 or 内税/総額
    const staffCode = String(row[10] || '').trim();
    const staffName = normalizeStaff(String(row[11] || '').trim());
    const shohinCode = String(row[14] || '').trim();
    const unit = String(row[16] || '').trim();
    const soukoName = String(row[20] || '').trim();
    const suryou = parseFloat(row[21] || 0);
    const tanka = parseFloat(row[23] || 0);
    const kingaku = parseFloat(row[25] || 0);  // 金額（税抜 or 税込。"外税"なら税抜、"内税"なら税込）
    const zeiKubun = String(row[29] || '').trim();
    const bikou = String(row[30] || '').trim();

    if (!slips.has(denpyoNo)) {
      slips.set(denpyoNo, {
        denpyoNo,
        salesDate: excelDateToISO(dateSerial),
        torihikiKubun,
        zeiTenka,
        custCode,
        custName,
        staffName,
        soukoName,
        details: [],
        bikouList: [],
      });
    }
    const slip = slips.get(denpyoNo);
    slip.details.push({
      shohinCode,
      productName: shohinName,
      unit,
      quantity: suryou,
      unitPrice: tanka,
      amount: kingaku,  // 外税: 税抜 / 内税: 税込
      zeiKubun,
      bikou,
    });
    if (bikou) slip.bikouList.push(bikou);
    yayoiTotal += kingaku;
  }
  console.log('   伝票数:', slips.size);
  console.log('   明細数:', [...slips.values()].reduce((s, x) => s + x.details.length, 0));
  console.log('   弥生金額合計(税抜+税込混合):', yayoiTotal.toLocaleString(), '円');
  console.log();

  // 4. 顧客コード未マッチ検出
  const missingCodes = new Set();
  for (const slip of slips.values()) {
    if (!custMap.has(slip.custCode)) missingCodes.add(slip.custCode + ' ' + slip.custName);
  }
  if (missingCodes.size > 0) {
    console.log('⚠️ 顧客マップに無いコード:', missingCodes.size, '件');
    [...missingCodes].forEach(c => console.log('   - ' + c));
    console.log();
  }

  // 伝票ごとに税抜/税込を正しく計算
  function calcSlipTotals(slip) {
    const isInclusive = /内税/.test(slip.zeiTenka);  // 内税/総額 → 金額は税込
    let zeinukiSum = 0, zeiSum = 0;
    const detailResults = slip.details.map(d => {
      const taxName = mapTaxKubun(d.zeiKubun);
      const rate = taxName === '課税(10%)' ? 0.1 : (taxName === '軽減税率(8%)' ? 0.08 : 0);
      let zeinuki, zei, zeikomi;
      if (isInclusive) {
        // 内税: 金額は税込 → 税抜 = 税込 / (1+率)
        zeikomi = d.amount;
        zeinuki = rate > 0 ? Math.round(d.amount / (1 + rate)) : d.amount;
        zei = zeikomi - zeinuki;
      } else {
        // 外税: 金額は税抜 → 税 = 税抜 × 率
        zeinuki = d.amount;
        zei = Math.round(d.amount * rate);
        zeikomi = zeinuki + zei;
      }
      zeinukiSum += zeinuki;
      zeiSum += zei;
      return { ...d, taxName, zeinuki, zei, zeikomi };
    });
    return {
      isInclusive,
      zeinukiSum,
      zeiSum,
      zeikomiSum: zeinukiSum + zeiSum,
      detailResults,
    };
  }

  if (DRY_RUN) {
    console.log('=== DRY RUN 完了 ===');
    let totalZeinuki = 0, totalZei = 0, totalZeikomi = 0;
    let inclusiveCount = 0, exclusiveCount = 0;
    for (const slip of slips.values()) {
      const t = calcSlipTotals(slip);
      totalZeinuki += t.zeinukiSum;
      totalZei += t.zeiSum;
      totalZeikomi += t.zeikomiSum;
      if (t.isInclusive) inclusiveCount++;
      else exclusiveCount++;
    }
    console.log('外税伝票:', exclusiveCount, '件 / 内税伝票:', inclusiveCount, '件');
    console.log('税抜合計:', totalZeinuki.toLocaleString(), '円');
    console.log('消費税合計:', totalZei.toLocaleString(), '円');
    console.log('税込合計:', totalZeikomi.toLocaleString(), '円');
    console.log('弥生金額列合計（外税=税抜+内税=税込の混合）:', yayoiTotal.toLocaleString(), '円');
    console.log();
    console.log('最初の3伝票サンプル:');
    const sample = [...slips.values()].slice(0, 3);
    sample.forEach(s => {
      const t = calcSlipTotals(s);
      const mode = t.isInclusive ? '[内税]' : '[外税]';
      console.log('  伝票' + s.denpyoNo + ' ' + mode, '/', s.salesDate, '/', s.custName, '/', s.staffName, '/', s.details.length + '明細 税抜:' + t.zeinukiSum.toLocaleString() + ' 税:' + t.zeiSum.toLocaleString());
    });
    return;
  }

  // 本番投入時もこの関数を使う
  global._calcSlipTotals = calcSlipTotals;

  // 5. Notion投入
  let targetSlips = LIMIT > 0 ? [...slips.values()].slice(0, LIMIT) : [...slips.values()];
  if (ONLY_SET) targetSlips = targetSlips.filter(s => ONLY_SET.has(s.denpyoNo));
  console.log('🚀 投入開始:', targetSlips.length, '伝票');
  console.log();

  let okCount = 0, failCount = 0;
  const errors = [];

  for (let i = 0; i < targetSlips.length; i++) {
    const slip = targetSlips[i];
    try {
      // 車番抽出（全備考から）
      const carNumber = extractCarNumber(slip.bikouList.join(' '));

      // 作業区分推定
      const workType = guessWorkType(slip.details);

      // 顧客リレーション
      const custId = custMap.get(slip.custCode);

      // 明細ごとに税額を計算して合計（内税/外税対応）
      const totals = global._calcSlipTotals(slip);
      const { zeinukiSum, zeiSum, zeikomiSum } = totals;
      const detailPrepared = totals.detailResults;

      // タイトル: YYYY/MM/DD 顧客名 車番
      let title = `${slip.salesDate.replace(/-/g, '/')} ${hankanaToZen(slip.custName)}`;
      if (carNumber) title += ` ${carNumber}`;

      // 伝票作成
      const slipProps = {
        '伝票タイトル': { title: [{ text: { content: title } }] },
        '伝票種類': { select: { name: '納品書' } },
        '売上日': { date: { start: slip.salesDate } },
        '担当者': slip.staffName ? { select: { name: slip.staffName } } : undefined,
        '車番': { rich_text: [{ text: { content: carNumber } }] },
        '作業区分': { select: { name: workType } },
        '支払い方法': { select: { name: mapPayment(slip.torihikiKubun) } },
        '宛先敬称': { select: { name: '御中' } },
        'ステータス': { select: { name: '請求済' } },
        '備考': { rich_text: [{ text: { content: `弥生伝票${slip.denpyoNo} 倉庫:${slip.soukoName}` } }] },
        '税抜合計': { number: zeinukiSum },
        // 弥生の《消費税》行があればその正確な値を使用（差額0円に）
        '消費税合計': { number: slip.yayoiTax != null ? slip.yayoiTax : zeiSum },
        '税込合計': { number: slip.yayoiTax != null ? zeinukiSum + slip.yayoiTax : zeikomiSum },
      };
      if (custId) slipProps['顧客名'] = { relation: [{ id: custId }] };
      // undefined を除去
      Object.keys(slipProps).forEach(k => slipProps[k] === undefined && delete slipProps[k]);

      const slipRes = await nf('POST', '/pages', {
        parent: { database_id: SALES_DB },
        properties: slipProps,
      });
      if (slipRes.object === 'error') throw new Error(slipRes.message);
      const slipPageId = slipRes.id;
      await sleep(350);

      // 明細投入（失敗時はリトライ + 完了後に件数チェック）
      let detailOk = 0;
      let detailFail = 0;
      for (const d of detailPrepared) {
        const tireInfo = extractTireInfo(d.productName);
        const hinmoku = mapHinmoku(d.shohinCode, d.productName);
        const detailTitle = `${hinmoku} ${tireInfo.size || ''} ${tireInfo.brand || ''}`.trim() || (d.productName.slice(0, 40));
        const detailProps = {
          '明細タイトル': { title: [{ text: { content: detailTitle } }] },
          '売上伝票': { relation: [{ id: slipPageId }] },
          '商品コード': { rich_text: [{ text: { content: d.shohinCode } }] },
          '品目': { select: { name: hinmoku } },
          'タイヤサイズ': { rich_text: [{ text: { content: tireInfo.size } }] },
          'タイヤ銘柄': { rich_text: [{ text: { content: tireInfo.brand } }] },
          '数量': { number: d.quantity || 0 },
          '単位': d.unit ? { select: { name: d.unit } } : undefined,
          // 単価は弥生の元値をそのまま（内税伝票なら税込単価、外税伝票なら税抜単価）
          '単価': { number: d.unitPrice || 0 },
          '税区分': { select: { name: d.taxName } },
          '税額': { number: d.zei || 0 },
          '税込小計': { number: d.zeikomi || 0 },
          '備考': { rich_text: [{ text: { content: hankanaToZen(d.productName) } }] },
          '弥生備考': d.bikou ? { rich_text: [{ text: { content: d.bikou } }] } : undefined,
        };
        Object.keys(detailProps).forEach(k => detailProps[k] === undefined && delete detailProps[k]);

        // リトライ付き明細投入（最大3回）
        let ok = false;
        for (let retry = 0; retry < 3; retry++) {
          try {
            const detailRes = await nf('POST', '/pages', {
              parent: { database_id: DETAIL_DB },
              properties: detailProps,
            });
            if (detailRes.object === 'error') throw new Error(detailRes.message);
            if (!detailRes.id) throw new Error('No id returned');
            ok = true;
            break;
          } catch(e) {
            if (retry < 2) {
              console.log('   ⚠️ 明細リトライ ' + (retry+1) + '/3 (伝票' + slip.denpyoNo + '): ' + e.message);
              await sleep(1500);
            } else {
              console.log('   ❌ 明細失敗 (伝票' + slip.denpyoNo + ', 商品' + d.shohinCode + '): ' + e.message);
              detailFail++;
            }
          }
        }
        if (ok) detailOk++;
        await sleep(350);
      }

      // 件数チェック：期待値と実際の投入数が合うか
      if (detailOk !== detailPrepared.length) {
        console.log('   ⚠️ 伝票' + slip.denpyoNo + ' 明細不足: 期待' + detailPrepared.length + ' / 成功' + detailOk);
        errors.push({ denpyoNo: slip.denpyoNo, error: `明細不足: ${detailOk}/${detailPrepared.length}` });
      }
      okCount++;
      console.log('  ✓ ' + (i + 1) + '/' + targetSlips.length + ' 伝票' + slip.denpyoNo + ' ' + slip.custName + ' (' + detailOk + '/' + detailPrepared.length + '明細)');
    } catch(e) {
      failCount++;
      errors.push({ denpyoNo: slip.denpyoNo, error: e.message });
      console.log('  ❌ 伝票' + slip.denpyoNo + ' → ' + e.message);
    }
  }

  console.log();
  console.log('===== 結果 =====');
  console.log('✅ 成功:', okCount, '伝票');
  console.log('❌ 失敗:', failCount, '伝票');
  if (errors.length > 0) {
    fs.writeFileSync('_migrate-errors.json', JSON.stringify(errors, null, 2));
    console.log('   エラーは _migrate-errors.json に保存');
  }

  // ═══════════════════════════════════════════════════════════
  // 終了時の自動件数チェック（Notion側と弥生Excelの件数が一致するか）
  // ═══════════════════════════════════════════════════════════
  if (DRY_RUN || ONLY_SET) return;

  console.log();
  console.log('===== 件数チェック =====');

  // 弥生Excelの明細数を再カウント（Excelから直接読み取り）
  const wb2 = XLSX.readFile(FILE_PATH);
  const data2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1 });
  let yayoiDetailCount = 0;
  const yayoiSlipsSet = new Set();
  for (let i = 5; i < data2.length; i++) {
    const row = data2[i];
    if (!row || !row[2]) continue;
    // バンドルファイルの年月フィルタ
    if (TARGET_YEAR && TARGET_MONTH) {
      const ds = row[1];
      if (typeof ds === 'number') {
        const dt = new Date((ds - 25569) * 86400 * 1000);
        if (dt.getFullYear() !== TARGET_YEAR || dt.getMonth() + 1 !== TARGET_MONTH) continue;
      }
    }
    if (String(row[15] || '') === '《消費税》') continue;
    yayoiSlipsSet.add(String(row[2]).trim());
    yayoiDetailCount++;
  }
  console.log('弥生 伝票:', yayoiSlipsSet.size, '/ 明細:', yayoiDetailCount);

  // Notion側の明細数をカウント（Excelファイルの月から対象月を判定）
  try {
    // TARGET_YEAR/MONTH があればそちらを優先、なければ FILE_NAME から
    let yr, mo;
    if (TARGET_YEAR && TARGET_MONTH) { yr = TARGET_YEAR; mo = TARGET_MONTH; }
    else {
      const fnMatch = FILE_NAME.match(/(\d{4})\.(\d{1,2})/);
      if (fnMatch) { yr = parseInt(fnMatch[1]); mo = parseInt(fnMatch[2]); }
    }
    if (yr && mo) {
      const lastD = new Date(yr, mo, 0).getDate();
      const firstDate = `${yr}-${String(mo).padStart(2,'0')}-01`;
      const lastDate = `${yr}-${String(mo).padStart(2,'0')}-${lastD}`;
      // 伝票取得
      let notionSlips = [];
      let cur = null;
      do {
        const body = { filter: { and: [
          { property: '売上日', date: { on_or_after: firstDate } },
          { property: '売上日', date: { on_or_before: lastDate } },
        ]}, page_size: 100 };
        if (cur) body.start_cursor = cur;
        const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
        notionSlips.push(...(r.results || []));
        cur = r.has_more ? r.next_cursor : null;
      } while (cur);

      // 明細数を数える
      let notionDetailCount = 0;
      const emptySlips = [];
      for (const ns of notionSlips) {
        let dcount = 0;
        let dcur = null;
        do {
          const body = { filter: { property: '売上伝票', relation: { contains: ns.id } }, page_size: 100 };
          if (dcur) body.start_cursor = dcur;
          const r = await nf('POST', `/databases/${DETAIL_DB}/query`, body);
          dcount += (r.results || []).length;
          dcur = r.has_more ? r.next_cursor : null;
        } while (dcur);
        notionDetailCount += dcount;
        if (dcount === 0) {
          const memo = ns.properties['備考']?.rich_text?.[0]?.plain_text || '';
          const m = memo.match(/弥生伝票(\d+)/);
          if (m) emptySlips.push(m[1]);
        }
        await sleep(50);
      }
      console.log('Notion 伝票:', notionSlips.length, '/ 明細:', notionDetailCount);
      console.log('差分 伝票:', notionSlips.length - yayoiSlipsSet.size, '/ 明細:', notionDetailCount - yayoiDetailCount);

      if (emptySlips.length > 0) {
        console.log('⚠️ 明細0件の伝票:', emptySlips.length, '件');
        console.log('   ', emptySlips.join(', '));
      }
      if (notionSlips.length === yayoiSlipsSet.size && notionDetailCount === yayoiDetailCount) {
        console.log('✅ 完全一致！');
      } else {
        console.log('❌ 件数不一致');
      }
    }
  } catch(e) {
    console.log('件数チェック失敗:', e.message);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
