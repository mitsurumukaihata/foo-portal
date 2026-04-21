import https from 'https';
function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev',
      path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>res(JSON.parse(c))); });
    req.on('error', rej);
    if (d) req.write(d);
    req.end();
  });
}
const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';

// 2026-03 の全伝票を取得
const all = [];
let cursor = null;
do {
  const body = {
    filter: {
      and: [
        { property: '売上日', date: { on_or_after: '2026-03-01' } },
        { property: '売上日', date: { on_or_before: '2026-03-31' } }
      ]
    },
    page_size: 100
  };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${SALES_DB}/query`, body);
  all.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

console.log('===== 2026年3月 売上伝票 集計レポート =====\n');
console.log('📊 件数');
console.log('  伝票数:', all.length);

// 合計
let zeinukiSum = 0, zeiSum = 0, zeikomiSum = 0;
const byStaff = new Map();
const byWorkType = new Map();
const byCustomer = new Map();
const carsSet = new Set();
let needsReviewCount = 0;

for (const slip of all) {
  const p = slip.properties;
  const zn = p['税抜合計']?.number || 0;
  const zei = p['消費税合計']?.number || 0;
  const zk = p['税込合計']?.number || 0;
  zeinukiSum += zn;
  zeiSum += zei;
  zeikomiSum += zk;
  const staff = p['担当者']?.select?.name || '(未設定)';
  byStaff.set(staff, (byStaff.get(staff) || 0) + zn);
  const wt = p['作業区分']?.select?.name || '(未設定)';
  byWorkType.set(wt, (byWorkType.get(wt) || 0) + 1);
  const custId = p['顧客名']?.relation?.[0]?.id || '';
  if (custId) byCustomer.set(custId, (byCustomer.get(custId) || 0) + zn);
  const car = p['車番']?.rich_text?.[0]?.plain_text || '';
  if (car) carsSet.add(car);
  if (p['要確認']?.checkbox) needsReviewCount++;
}

console.log();
console.log('💰 金額');
console.log('  税抜合計:', zeinukiSum.toLocaleString(), '円');
console.log('  消費税合計:', zeiSum.toLocaleString(), '円');
console.log('  税込合計:', zeikomiSum.toLocaleString(), '円');
console.log();
console.log('📌 弥生との照合');
const yayoi = 19794614;
console.log('  弥生金額列合計:', yayoi.toLocaleString(), '円');
console.log('  Notion税込合計:', zeikomiSum.toLocaleString(), '円');
console.log('  差額:', (zeikomiSum - yayoi).toLocaleString(), '円', (Math.abs(zeikomiSum - yayoi) < 100 ? '✅ (許容範囲)' : '⚠️'));

console.log();
console.log('👥 担当者別 (税抜)');
[...byStaff.entries()].sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
  console.log('  ' + k.padEnd(12) + ' ' + v.toLocaleString().padStart(12) + ' 円');
});

console.log();
console.log('🚚 作業区分別 (件数)');
[...byWorkType.entries()].sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
  console.log('  ' + k.padEnd(10) + ' ' + String(v).padStart(4) + ' 件');
});

console.log();
console.log('🏆 売上 TOP10 顧客');
const custTotal = [...byCustomer.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10);
for (const [id, total] of custTotal) {
  // 顧客名を取得
  const r = await nf('GET', `/pages/${id}`);
  const name = r.properties?.['会社名']?.title?.[0]?.plain_text || '(不明)';
  console.log('  ' + total.toLocaleString().padStart(12) + ' 円 ' + name);
}

console.log();
console.log('🚗 ユニーク車番:', carsSet.size, '台');
console.log('⚠️ 要確認フラグ:', needsReviewCount, '件');
