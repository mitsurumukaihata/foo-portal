// fooパック支払管理フォルダ全ファイルをNotionへ投入（CLOは投入済みなのでスキップ）
import https from 'https';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const FOO_DB = '8f7b92b3be4a4ac0832de8b53190c6b5';
const CUST_DB = 'f632f512f12d49b2b11f2b3e45c70aec';
const DIR = 'C:/Users/Mitsuru Mukaihata/Desktop/売上明細/fooパック支払管理';

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
    const m = s.match(/^(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
    if (m) {
      let y = parseInt(m[1]);
      if (y < 100) y += 2000;
      return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    }
  }
  return null;
}

// 顧客情報DBから名前で検索
async function findCustomer(name) {
  const r = await nf('POST', '/databases/' + CUST_DB + '/query', {
    filter: { property: '顧客名', title: { contains: name } },
    page_size: 5,
  });
  return (r.results || [])[0]?.id || null;
}

function parseSheet(wb, sname) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sname], { header: 1 });
  // 列オフセット自動判定: row 2 の col 1 or col 0 に御中
  const row2 = data[2] || [];
  let offset = 0;
  if (String(row2[1] || '').includes('御中') || String(row2[1] || '').match(/株式会社|㈱|有限会社|㈲|会社/)) offset = 0;
  else if (String(row2[0] || '').includes('御中') || String(row2[0] || '').match(/株式会社|㈱|有限会社|㈲|会社/)) offset = -1;
  const getCell = (r, c) => (data[r] || [])[c + offset] != null ? (data[r] || [])[c + offset] : undefined;

  // 空シートや Sheet1 の判定
  const custName = String(getCell(2, 1) || '').replace(/御中/g, '').replace(/\s/g, '').trim();
  const productLabel = String(getCell(8, 3) || '').trim();
  if (!custName || !productLabel) return null;

  const contractNoRaw = String(getCell(9, 3) || '').trim();
  const contractDate = excelDateToISO(getCell(7, 3));
  const leaseStart = excelDateToISO(getCell(10, 3));
  const leaseEnd = excelDateToISO(getCell(11, 3));
  const monthsStr = String(getCell(11, 6) || '').replace(/ヶ月/, '').trim();
  const months = Number(monthsStr) || 60;
  const total = Number(getCell(12, 4)) || 0;
  const residual = Number(getCell(12, 8)) || 0;

  // お支払い明細（列オフセット考慮）
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

  if (payments.length === 0) return null;

  // 通常月額と最終月
  const count = new Map();
  for (const p of payments) {
    const key = `${p.amount}/${p.tax}`;
    count.set(key, (count.get(key) || 0) + 1);
  }
  let normalKey = null, maxC = 0;
  for (const [k, v] of count) if (v > maxC) { maxC = v; normalKey = k; }
  const [normalAmt, normalTax] = normalKey.split('/').map(Number);
  let lastAmt = normalAmt, lastTax = normalTax;
  for (const p of payments) {
    if (p.amount !== normalAmt || p.tax !== normalTax) {
      lastAmt = p.amount;
      lastTax = p.tax;
      break;
    }
  }

  // 商品区分
  let category = 'f.o.oパックライト';
  if (/LTL/i.test(productLabel) || /LTL/i.test(contractNoRaw)) category = 'f.o.oパックLTL';
  else if (/LTS/i.test(productLabel) || /LTS/i.test(contractNoRaw)) category = 'f.o.oパックLTS';
  else if (/TB/i.test(productLabel) || /TB/i.test(contractNoRaw)) category = 'f.o.oパックTB';
  else if (/ライト/i.test(productLabel)) category = 'f.o.oパックライト';
  else category = 'f.o.oパックLT';

  // 複数台契約の判定
  const isBundle = /計\s*(\d+)\s*台/.test(contractNoRaw);
  const bundleCountMatch = contractNoRaw.match(/計\s*(\d+)\s*台/);
  const bundleCount = bundleCountMatch ? Number(bundleCountMatch[1]) : null;
  const memo = isBundle ? `まとめ契約（${bundleCount}台分）` : '';

  return {
    sheetName: sname,
    custName,
    contractNoRaw,
    contractDate,
    leaseStart,
    leaseEnd,
    months,
    total,
    residual,
    normalAmt,
    normalTax,
    normalZeinuki: normalAmt - normalTax,
    lastAmt,
    lastTax,
    lastZeinuki: lastAmt - lastTax,
    category,
    isBundle,
    bundleCount,
    memo,
  };
}

// 顧客名をキーに重複検出
async function getExistingContracts() {
  const res = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + FOO_DB + '/query', body);
    res.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return res.map(p => (p.properties['契約番号']?.title?.[0]?.plain_text || '').trim());
}

console.log('=== FOOパック全ファイル投入 ===');
const existing = await getExistingContracts();
console.log('既存契約:', existing.length, '件');
console.log();

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.xlsx'));
const contracts = [];
for (const fname of files) {
  const wb = XLSX.readFile(path.join(DIR, fname));
  console.log('━━━', fname, '━━━');
  for (const sname of wb.SheetNames) {
    if (sname === 'Sheet1') continue;
    if (sname === '建機 初期') continue; // 建機 (2) と重複
    const c = parseSheet(wb, sname);
    if (!c) { console.log('  [' + sname + '] スキップ（空or明細なし）'); continue; }
    // 契約番号のユニーク化 (シート名 or ファイル名_シート)
    const baseName = fname.replace(/支払明細　|\.xlsx/g, '').trim();
    c.contractNo = sname.trim();
    if (existing.some(e => e === c.contractNo)) {
      console.log('  [' + c.contractNo + '] 既存スキップ');
      continue;
    }
    contracts.push(c);
    console.log(`  [${c.contractNo}] ${c.custName} ${c.category} 月額${c.normalAmt}円 ${c.isBundle?'('+c.bundleCount+'台)':'個別'}`);
  }
}

console.log();
console.log('新規投入対象:', contracts.length, '件');
console.log();

// 顧客検索（名前別にマップ）
const custMap = new Map();
for (const c of contracts) {
  if (custMap.has(c.custName)) continue;
  // カッコや 株 を取り除いてから検索
  const searchName = c.custName.replace(/[（(][^）)]*[）)]/g, '').replace(/株式会社|㈱|有限会社|㈲/g, '').trim();
  const id = await findCustomer(searchName) || await findCustomer(c.custName);
  custMap.set(c.custName, id);
  console.log('顧客検索:', c.custName, '→', id ? '見つかりました' : '未登録');
  await sleep(150);
}
console.log();

// 投入
let success = 0, fail = 0;
for (const c of contracts) {
  const props = {
    '契約番号': { title: [{ text: { content: c.contractNo } }] },
    '得意先名': { rich_text: [{ text: { content: c.custName } }] },
    '商品区分': { select: { name: c.category } },
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
    'メモ': { rich_text: [{ text: { content: c.memo } }] },
  };
  if (c.contractDate) props['契約日'] = { date: { start: c.contractDate } };
  if (c.leaseStart) props['リース開始日'] = { date: { start: c.leaseStart } };
  if (c.leaseEnd) props['リース終了日'] = { date: { start: c.leaseEnd } };
  const custPageId = custMap.get(c.custName);
  if (custPageId) props['得意先'] = { relation: [{ id: custPageId }] };

  try {
    const r = await nf('POST', '/pages', { parent: { database_id: FOO_DB }, properties: props });
    if (r.object === 'error') throw new Error(r.message);
    success++;
    console.log(`✓ ${c.contractNo} ${c.custName} 月額${c.normalAmt}円`);
  } catch(e) {
    fail++;
    console.log(`❌ ${c.contractNo}: ${e.message}`);
  }
  await sleep(250);
}

console.log();
console.log(`新規: ${success}件 / 失敗: ${fail}件`);
