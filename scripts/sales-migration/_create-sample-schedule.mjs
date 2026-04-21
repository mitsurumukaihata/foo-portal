import https from 'https';

function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>{ try { res(JSON.parse(c)); } catch(e) { rej(new Error('Parse: ' + c.slice(0,200))); } }); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SCHEDULE_DB = '342a695f8e8881efbe44fc39adaf0271';
const CUST_DB = '1ca8d122be214e3892879932147143c9';

// 顧客情報DB取得
console.log('顧客情報DBを取得中...');
const custs = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${CUST_DB}/query`, body);
  custs.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);

// 名前→IDマップ
function findCust(kw) {
  const c = custs.find(c => (c.properties['会社名']?.title?.[0]?.plain_text || '').includes(kw));
  if (!c) return null;
  return {
    id: c.id,
    name: c.properties['会社名']?.title?.[0]?.plain_text || '',
    moto: c.properties['中間管理会社']?.select?.name || '',
  };
}

// 今日の日付
const today = new Date();
const dateStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}-${today.getDate().toString().padStart(2,'0')}`;
console.log('対象日:', dateStr);

function iso(hhmm) {
  return `${dateStr}T${hhmm}:00+09:00`;
}

// サンプル予定リスト
const plans = [
  // 大田
  { worker: '大田', start: '09:00', end: '10:30', custKw: '中山建設', custNameFallback: '中山建設(株)', car: '広島400わ80-31', workTypes: ['組替','脱着'], size: '205/75R16', pattern: 'M634', qty: 4, memo: '川辺運送' },
  { worker: '大田', start: '11:00', end: '12:00', custKw: 'リョーキ五日市', custNameFallback: 'リョーキ五日市', car: '広島800あ65-40', workTypes: ['脱着'], size: '225/80R17.5', pattern: 'M646', qty: 2, memo: 'RGA03208' },
  { worker: '大田', start: '14:00', end: '16:00', custKw: '太陽建機', custNameFallback: '太陽建機岩国', car: '広島400わ62-75', workTypes: ['タイヤ販売(中古)','組替','脱着'], size: '205/75R16', pattern: 'M634', qty: 6, memo: 'TLB-5841' },

  // 矢島
  { worker: '矢島', start: '09:00', end: '11:00', custKw: 'シモハナ', custNameFallback: 'シモハナ物流', car: '広島100き88-11', workTypes: ['組替','脱着'], size: '245/70R19.5', pattern: 'M646', qty: 6, memo: '' },
  { worker: '矢島', start: '13:00', end: '14:30', custKw: '西尾レントオール', custNameFallback: '西尾レントオール', car: '', workTypes: ['タイヤ販売(新品)','組替'], size: '11R22.5', pattern: 'M888', qty: 4, dest: '五日市機械センター', memo: '' },
  { worker: '矢島', start: '15:00', end: '17:00', custKw: 'ムロオ五日市', custNameFallback: 'ムロオ五日市', car: '広島800か36-99', workTypes: ['f.o.oパック'], size: '245/70R19.5', pattern: 'M676', qty: 6, memo: '管理番号:1377' },

  // 中川
  { worker: '中川', start: '09:30', end: '11:00', custKw: '松木エネルギー', custNameFallback: '松木エネルギー', car: '広島800せ58-38', workTypes: ['タイヤ販売(新品)','組替','脱着'], size: '195/75R15', pattern: 'M634', qty: 4, memo: '¥250/1本' },
  { worker: '中川', start: '11:30', end: '12:30', custKw: 'なかた', custNameFallback: 'なかた', car: '広島800せ25-29', workTypes: ['脱着'], size: '205/85R16', pattern: 'M634', qty: 4, memo: '' },
  { worker: '中川', start: '14:00', end: '15:30', custKw: 'アクティオ廿日市', custNameFallback: 'アクティオ廿日市', car: '広島480わ34-43', workTypes: ['組替','脱着'], size: '145/80R12', pattern: 'K370', qty: 4, memo: '' },
  { worker: '中川', start: '16:00', end: '17:30', custKw: '広島IC', custNameFallback: '広島IC', car: '', workTypes: ['タイヤ販売(新品)','組替'], size: '275/80R22.5', pattern: 'M646', qty: 10, memo: 'ミカミ経由' },

  // 山根
  { worker: '山根', start: '08:30', end: '10:00', custKw: '', custNameFallback: '', car: '', workTypes: ['出張(市内)'], memo: 'No.3713 大型 国府' },
  { worker: '山根', start: '10:30', end: '12:30', custKw: '豊栄運輸', custNameFallback: '豊栄運輸', car: '広島800こ30-00', workTypes: ['タイヤ販売(中古)','組替','脱着'], size: '275/80R22.5', pattern: 'M899', qty: 4, memo: '' },
  { worker: '山根', start: '14:00', end: '15:00', custKw: '', custNameFallback: '', car: '', workTypes: ['出張(市内)'], memo: 'No.8731 国府 文型' },
  { worker: '山根', start: '16:00', end: '17:30', custKw: 'CLO', custNameFallback: '(株)CLO', car: '', workTypes: ['バランス','脱着'], size: '245/80R17.5', pattern: 'M646', qty: 2, memo: '' },

  // 村田
  { worker: '村田', start: '09:00', end: '11:30', custKw: 'キョウワ運輸', custNameFallback: 'キョウワ運輸', car: '', workTypes: ['組替','脱着','タイヤ販売(中古)'], size: '11R22.5 16P', pattern: 'RTM890', qty: 4, memo: '' },
  { worker: '村田', start: '13:00', end: '15:00', custKw: 'アロード', custNameFallback: 'アロード東広島', car: '', workTypes: ['f.o.oパック','組替'], size: '295/80R22.5', pattern: 'M676', qty: 4, memo: '東広島' },
  { worker: '村田', start: '15:30', end: '17:00', custKw: '中山建設', custNameFallback: '中山建設', car: '', workTypes: ['タイヤ販売(新品)','組替','脱着'], size: '225/80R17.5', pattern: 'M125', qty: 4, memo: '' },

  // 平野
  { worker: '平野', start: '10:00', end: '11:00', custKw: '', custNameFallback: '', car: '', workTypes: ['その他'], memo: '備品チェック' },
  { worker: '平野', start: '13:30', end: '15:00', custKw: 'リョーキ五日市', custNameFallback: 'リョーキ五日市', car: '広島400わ47-18', workTypes: ['脱着','組替'], size: '205/75R16', pattern: 'M634', qty: 6, memo: 'RGA01379' },
  { worker: '平野', start: '16:00', end: '17:30', custKw: '', custNameFallback: '', car: '', workTypes: ['その他'], memo: '倉庫整理' },

  // 向畑
  { worker: '向畑', start: '09:00', end: '10:00', custKw: '', custNameFallback: '', car: '', workTypes: ['その他'], memo: 'ミーティング' },
  { worker: '向畑', start: '11:00', end: '12:30', custKw: 'ツネイシ', custNameFallback: 'ツネイシカムテックス', car: '広島100え17-31', workTypes: ['組替','脱着'], size: '195/75R15', pattern: 'M135', qty: 2, memo: '' },
  { worker: '向畑', start: '14:00', end: '15:30', custKw: '', custNameFallback: '', car: '', workTypes: ['出張(市外)'], memo: '福山 商談' },
  { worker: '向畑', start: '16:30', end: '18:00', custKw: '', custNameFallback: '', car: '', workTypes: ['その他'], memo: '事務処理' },
];

console.log(`サンプル予定: ${plans.length}件 を登録中...`);

let created = 0;
let errors = 0;

for (const plan of plans) {
  // 顧客検索
  let cust = null;
  if (plan.custKw) cust = findCust(plan.custKw);

  // 元請けタイプ判定
  let motoType = '直販';
  if (cust?.moto) {
    if (/TOYO|ﾄｰﾖｰ/i.test(cust.moto)) motoType = 'TOYO';
    else if (/BRIDGESTONE|ﾌﾞﾘﾁﾞｽﾄﾝ/i.test(cust.moto)) motoType = 'BRIDGESTONE';
    else if (/ふそう東/.test(cust.moto)) motoType = 'ふそう東';
    else if (/ふそう西/.test(cust.moto)) motoType = 'ふそう西';
    else if (/DUNLOP|ダンロップ/i.test(cust.moto)) motoType = 'DUNLOP';
    else motoType = 'その他元請け';
  }

  const custName = cust?.name || plan.custNameFallback || '';
  const title = [custName, plan.car, plan.workTypes?.join('+')].filter(Boolean).join(' ').trim() || '(予定)';

  const props = {
    '予定タイトル': { title: [{ text: { content: title } }] },
    '開始日時': { date: { start: iso(plan.start) } },
    '終了日時': { date: { start: iso(plan.end) } },
    '作業者': { select: { name: plan.worker } },
    '作業内容': { multi_select: (plan.workTypes || []).map(t => ({ name: t })) },
    '車番': { rich_text: [{ text: { content: plan.car || '' } }] },
    'タイヤサイズ': { rich_text: [{ text: { content: plan.size || '' } }] },
    'パターン': { rich_text: [{ text: { content: plan.pattern || '' } }] },
    '本数': { number: plan.qty || null },
    '出庫先': { rich_text: [{ text: { content: plan.dest || '' } }] },
    'メモ': { rich_text: [{ text: { content: plan.memo || '' } }] },
    '状態': { select: { name: '未完了' } },
    '元請けタイプ': { select: { name: motoType } },
  };
  if (cust?.id) props['顧客'] = { relation: [{ id: cust.id }] };

  try {
    await nf('POST', '/pages', { parent: { database_id: SCHEDULE_DB }, properties: props });
    created++;
    console.log(`  ✓ ${plan.worker} ${plan.start} ${custName || '(自社)'} [${motoType}]`);
    await sleep(300);
  } catch (e) {
    errors++;
    console.log(`  ❌ ${plan.worker} ${plan.start}: ${e.message}`);
  }
}

console.log();
console.log('===== 結果 =====');
console.log(`作成: ${created}件`);
console.log(`エラー: ${errors}件`);
