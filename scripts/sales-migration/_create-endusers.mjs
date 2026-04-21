import https from 'https';
import fs from 'fs';

function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>{ try { res(JSON.parse(c)); } catch(e) { rej(new Error('Parse: ' + c.slice(0,100))); } }); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CUST_DB = '1ca8d122be214e3892879932147143c9';

// 元請け名→中間管理会社select値
const motoSelectMap = {
  '(株)ﾄｰﾖｰﾀｲﾔｼﾞｬﾊﾟﾝ広島販売部': 'TOYO',
  'ブリヂストンタイヤソリューションジャパン(株)': 'BRIDGESTONE',
  '三菱ふそう中国地区販売(株)広島東支店': 'ふそう東',
  '三菱ふそう中国地区販売(株)広島西支店': 'ふそう西',
  '(株)ダンロップタイヤ　広島営業所': 'DUNLOP',
};

// 除外リスト（ユーザー名ではないもの）
const excludeNames = new Set([
  '営業車', '型式：BE740G', 'マイクロバス', 'STL:×', 'STL:4本×',
  '廃タイヤ：五日市倉庫', 'AC', '迫井部長', '福山依頼',
  '広島45み29-69', // 車番
  'TOYO香川', 'ふそう東香川', // 元請けの別拠点
]);

// 統合マップ（略称→正式名称に統合すべきもの）
const mergeMap = {
  'ウイラー': 'WILLER EXPRESS',
  'ウィラー': 'WILLER EXPRESS',
  '上本': '上本寿彦',
  '上本寿彦': '上本寿彦',
  '新見自動車/イチネン': '新見自動車',
  'ふそう西/基礎テック': '基礎テック',
  'ふそう西/イシザキ': 'イシザキ',
  'ふそう西/SORI': 'SORI',
  'ふそう西/新田石材': '新田石材',
  'リョーキ五日市/占部建設': 'リョーキ五日市',
  'アクティオ/水谷建設': 'アクティオ',
  '丸運/240': '丸運',
  '三笠産業様分': '三笠産業',
  '(有)ヒラオカ': 'ヒラオカ',
  '日本ﾍﾞｽﾄﾐｰﾄ　ｻﾝｳｪｲ物流': '日本ベストミート サンウェイ物流',
  'デリカウイング': 'デリカウィング',
};

// 既存顧客DB取得
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

function normCust(s) {
  return s.replace(/[\s　]/g,'').replace(/様$/,'').replace(/[(（]株[)）]|株式会社|㈱/g,'').replace(/[(（]有[)）]|有限会社|㈲/g,'').toLowerCase();
}
const existingNorms = new Map();
custs.forEach(c => {
  const name = c.properties['会社名']?.title?.[0]?.plain_text || '';
  existingNorms.set(normCust(name), c.id);
});
console.log(`  既存: ${custs.length}件`);

// 車両データから顧客空のユーザー名を収集
const data = JSON.parse(fs.readFileSync('_vehicle-rebuild.json', 'utf8'));
const nameInfo = new Map();
for (const v of data) {
  if (v.custId) continue;
  const m = v.memo.match(/弥生備考: (.+?)( \/ サイズ| \/ 元請け|$)/);
  if (!m) continue;
  const names = m[1].split(', ');
  const motoMatch = v.memo.match(/元請け: (.+?)$/);
  const moto = motoMatch ? motoMatch[1] : '';
  for (let n of names) {
    n = n.replace(/様$/, '').trim();
    if (!n || excludeNames.has(n) || /^\d/.test(n) || /km$/i.test(n) || n.includes('外し') || n.includes('￥') || n.includes('№') || n.length < 2) continue;
    // 統合
    if (mergeMap[n]) n = mergeMap[n];
    if (!nameInfo.has(n)) nameInfo.set(n, { count: 0, moto: '' });
    const info = nameInfo.get(n);
    info.count++;
    if (moto) info.moto = moto;
  }
}

// 既存DBとのマッチ確認
const toCreate = [];
const alreadyExists = [];
for (const [name, info] of nameInfo) {
  const nn = normCust(name);
  let found = existingNorms.has(nn);
  if (!found) {
    for (const [en, eid] of existingNorms) {
      if (en.length > 3 && (en.includes(nn) || nn.includes(en))) { found = true; break; }
    }
  }
  if (found) {
    alreadyExists.push(name);
  } else {
    toCreate.push({ name, count: info.count, moto: info.moto });
  }
}

console.log(`  既存DB一致: ${alreadyExists.length}件 → スキップ`);
console.log(`  新規作成: ${toCreate.length}件`);
console.log();

// 新規作成
let created = 0;
for (const item of toCreate) {
  const motoSelect = motoSelectMap[item.moto] || '';
  const props = {
    '会社名': { title: [{ text: { content: item.name } }] },
  };
  if (motoSelect) {
    try { props['中間管理会社'] = { select: { name: motoSelect } }; } catch(e) {}
  }

  try {
    await nf('POST', '/pages', { parent: { database_id: CUST_DB }, properties: props });
    created++;
    console.log(`  ✚ ${item.name} (${item.count}台, 元請け: ${motoSelect || '不明'})`);
    await sleep(300);
  } catch(e) {
    console.log(`  ❌ ${item.name}: ${e.message}`);
  }
}

console.log();
console.log(`=== 結果 ===`);
console.log(`新規作成: ${created}件`);
console.log(`スキップ（既存一致）: ${alreadyExists.length}件`);
if (alreadyExists.length > 0) console.log(`  一致: ${alreadyExists.join(', ')}`);
