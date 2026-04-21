// CLO支払明細Excel → Notion f.o.oパック契約DB 初回インポート
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';

const FOO_DB = '8f7b92b3be4a4ac0832de8b53190c6b5';
const CUST_DB = 'f632f512f12d49b2b11f2b3e45c70aec';

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
function excelDateToISO(s) {
  if (typeof s === 'number') {
    const d = new Date((s - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof s === 'string') {
    // "2025.3.1" or "24.4.19" → YYYY-MM-DD
    const m = s.match(/^(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
    if (m) {
      let y = parseInt(m[1]);
      if (y < 100) y += 2000;
      return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    }
  }
  return null;
}

// 1. CLO得意先のpage_idを取得
console.log('CLO得意先のpage_id取得...');
let cloPageId = null;
{
  const r = await nf('POST', '/databases/' + CUST_DB + '/query', {
    filter: { property: '顧客名', title: { contains: 'CLO' } },
    page_size: 10,
  });
  for (const p of r.results || []) {
    const name = p.properties['顧客名']?.title?.[0]?.plain_text || '';
    if (name.includes('CLO')) { cloPageId = p.id; console.log('  得意先:', name, p.id); break; }
  }
}

// 2. Excel読込
const FILE = 'C:/Users/Mitsuru Mukaihata/Downloads/支払明細　CLO (2).xlsx';
const wb = XLSX.readFile(FILE);

// 3. 各シートを契約として解析
const contracts = [];
for (const sname of wb.SheetNames) {
  if (!sname.startsWith('CLO 19')) continue;
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sname], { header: 1 });
  const getCell = (r, c) => (data[r] || [])[c];

  const contractDate = excelDateToISO(getCell(7, 3));
  const productName = String(getCell(8, 3) || '').trim();
  const contractNo = String(getCell(9, 3) || sname).trim();
  const period = String(getCell(9, 6) || '').trim();
  const leaseStart = excelDateToISO(getCell(10, 3));
  const leaseEnd = excelDateToISO(getCell(11, 3));
  const months = Number(String(getCell(11, 6) || '').replace(/ヶ月/, '')) || 60;
  const total = Number(getCell(12, 4)) || 0;
  const residual = Number(getCell(12, 8)) || 0;

  // お支払い明細を全件読む
  const payments = [];
  for (let i = 22; i < 100; i++) {
    const p1 = Number(getCell(i, 4)) || 0;
    const t1 = Number(getCell(i, 6)) || 0;
    if (p1 > 0) payments.push({ no: Number(getCell(i, 1)) || payments.length + 1, amount: p1, tax: t1 });
    const p2 = Number(getCell(i, 14)) || 0;
    const t2 = Number(getCell(i, 16)) || 0;
    if (p2 > 0) payments.push({ no: Number(getCell(i, 11)) || payments.length + 1, amount: p2, tax: t2 });
  }
  payments.sort((a, b) => a.no - b.no);

  // 通常月額（最多値）と最終月額を区別
  const count = new Map();
  for (const p of payments) {
    const key = `${p.amount}/${p.tax}`;
    count.set(key, (count.get(key) || 0) + 1);
  }
  let normalKey = null, maxC = 0;
  for (const [k, v] of count) if (v > maxC) { maxC = v; normalKey = k; }
  const [normalAmt, normalTax] = normalKey.split('/').map(Number);
  const normalZeinuki = normalAmt - normalTax;

  // 最終月（通常月と違うもの）
  let lastAmt = normalAmt, lastTax = normalTax;
  for (const p of payments) {
    if (p.amount !== normalAmt || p.tax !== normalTax) {
      lastAmt = p.amount;
      lastTax = p.tax;
      break;
    }
  }

  // 商品区分を判定
  let productCategory = 'f.o.oパックライト';
  if (/TB/i.test(contractNo) || /TB/i.test(productName)) productCategory = 'f.o.oパックTB';
  else if (/LTL/i.test(contractNo) || /LTL/i.test(productName)) productCategory = 'f.o.oパックLTL';
  else if (/LTS/i.test(contractNo) || /LTS/i.test(productName)) productCategory = 'f.o.oパックLTS';
  else if (/LT/i.test(productName)) productCategory = 'f.o.oパックLT';

  contracts.push({
    contractNo: sname.trim(),
    productName,
    productCategory,
    contractDate,
    leaseStart,
    leaseEnd,
    months,
    total,
    residual,
    normalAmt,
    normalTax,
    normalZeinuki,
    lastAmt,
    lastTax,
    lastZeinuki: lastAmt - lastTax,
    paymentCount: payments.length,
  });
}

console.log('契約数:', contracts.length);
console.log();

// 4. Notionに投入
let success = 0, fail = 0;
for (const c of contracts) {
  const props = {
    '契約番号': { title: [{ text: { content: c.contractNo } }] },
    '得意先名': { rich_text: [{ text: { content: '株式会社CLO' } }] },
    '商品区分': { select: { name: c.productCategory } },
    '契約日': c.contractDate ? { date: { start: c.contractDate } } : undefined,
    'リース開始日': c.leaseStart ? { date: { start: c.leaseStart } } : undefined,
    'リース終了日': c.leaseEnd ? { date: { start: c.leaseEnd } } : undefined,
    '期間月数': { number: c.months },
    '契約総額': { number: c.total },
    '残価': { number: c.residual },
    '月額税込': { number: c.normalAmt },
    '月額税抜': { number: c.normalZeinuki },
    '月額消費税': { number: c.normalTax },
    '最終月税込': { number: c.lastAmt },
    '最終月税抜': { number: c.lastZeinuki },
    '最終月消費税': { number: c.lastTax },
    '状態': { select: { name: '有効' } },
  };
  if (cloPageId) props['得意先'] = { relation: [{ id: cloPageId }] };
  Object.keys(props).forEach(k => props[k] === undefined && delete props[k]);

  try {
    const r = await nf('POST', '/pages', { parent: { database_id: FOO_DB }, properties: props });
    if (r.object === 'error') throw new Error(r.message);
    success++;
    console.log(`✓ ${c.contractNo} ${c.productCategory} 月額${c.normalAmt}円 ${c.paymentCount}回`);
  } catch(e) {
    fail++;
    console.log(`❌ ${c.contractNo}: ${e.message}`);
  }
  await sleep(250);
}

console.log();
console.log(`成功: ${success}件 / 失敗: ${fail}件`);
