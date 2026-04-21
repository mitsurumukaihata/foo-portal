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
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';

// 最新の伝票を取得
const res = await nf('POST', `/databases/${SALES_DB}/query`, {
  sorts: [{ timestamp: 'created_time', direction: 'descending' }],
  page_size: 3
});

for (const slip of res.results || []) {
  const title = slip.properties['伝票タイトル']?.title?.[0]?.plain_text || '';
  const custRel = slip.properties['顧客名']?.relation || [];
  const zeinuki = slip.properties['税抜合計']?.number || 0;
  const zei = slip.properties['消費税合計']?.number || 0;
  const zeikomi = slip.properties['税込合計']?.number || 0;
  const carNo = slip.properties['車番']?.rich_text?.[0]?.plain_text || '';
  const staff = slip.properties['担当者']?.select?.name || '';
  const meisaiRel = slip.properties['明細一覧']?.relation || [];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋', title);
  console.log('   担当者:', staff, '| 車番:', carNo || '(なし)');
  console.log('   税抜:', zeinuki.toLocaleString() + '円', '/ 税:', zei.toLocaleString() + '円', '/ 税込:', zeikomi.toLocaleString() + '円');
  console.log('   顧客リレーション:', custRel.length, '件');
  console.log('   明細リレーション:', meisaiRel.length, '件');
  console.log('   --- 明細一覧 ---');

  // 各明細を取得して表示
  for (const rel of meisaiRel.slice(0, 10)) {
    const d = await nf('GET', `/pages/${rel.id}`);
    const p = d.properties || {};
    const dtitle = p['明細タイトル']?.title?.[0]?.plain_text || '';
    const hinmoku = p['品目']?.select?.name || '';
    const size = p['タイヤサイズ']?.rich_text?.[0]?.plain_text || '';
    const brand = p['タイヤ銘柄']?.rich_text?.[0]?.plain_text || '';
    const qty = p['数量']?.number || 0;
    const unit = p['単位']?.select?.name || '';
    const price = p['単価']?.number || 0;
    const taxCls = p['税区分']?.select?.name || '';
    const taxAmt = p['税額']?.number || 0;
    const zeikomiDetail = p['税込小計']?.number || 0;
    console.log(`     [${hinmoku}] ${brand || '-'} ${size || ''} × ${qty}${unit} @¥${price.toLocaleString()} (${taxCls}) 税込:¥${zeikomiDetail.toLocaleString()}`);
  }
  if (meisaiRel.length > 10) console.log('     ... 他', meisaiRel.length - 10, '件');
  console.log();
}
