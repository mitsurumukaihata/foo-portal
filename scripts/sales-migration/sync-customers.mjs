import https from 'https';
import fs from 'fs';

const WORKER = 'notion-proxy.33322666666mm.workers.dev';
const CUST_DB = '1ca8d122be214e3892879932147143c9';

function notionFetch(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: WORKER, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let c = '';
      res.on('data', d => c += d);
      res.on('end', () => { try { resolve(JSON.parse(c)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const match = JSON.parse(fs.readFileSync('_match2-result.json', 'utf8'));

// 特殊4カテゴリ（有効=false）
const SPECIAL = new Set(['300', '3006', '501', '601']);

// BS統合: 103 と 1031 は同じ。103で作成、1031は弥生コードに追加
// unmatched から 1031 を除外して 103 作成時にコード2つ付ける
const brist103 = match.unmatched.find(u => u.code === '103');
const brist1031 = match.unmatched.find(u => u.code === '1031');
const otherUnmatched = match.unmatched.filter(u => u.code !== '103' && u.code !== '1031');

let updated = 0, created = 0, failed = 0;

console.log('===== Phase 1: マッチ済み34件に弥生得意先コードをセット =====');
for (const m of match.matched) {
  try {
    const props = {
      '弥生得意先コード': { rich_text: [{ text: { content: m.code } }] },
      '有効': { checkbox: true },
    };
    const res = await notionFetch('PATCH', `/pages/${m.notion.id}`, { properties: props });
    if (res.object === 'error') {
      console.log('  ❌ ' + m.code + ' ' + m.yayoiName + ' → ' + res.message);
      failed++;
    } else {
      updated++;
      if (updated % 10 === 0) console.log('  ✓ ' + updated + '/' + match.matched.length);
    }
  } catch(e) {
    console.log('  ❌ ' + m.code + ' → ' + e.message);
    failed++;
  }
  await sleep(350); // 3req/sec制限
}
console.log('  更新完了: ' + updated + ' / ' + match.matched.length);

console.log();
console.log('===== Phase 2: ブリヂストン統合作成（103,1031） =====');
if (brist103) {
  try {
    const props = {
      '会社名': { title: [{ text: { content: brist103.yayoiName } }] },
      '弥生得意先コード': { rich_text: [{ text: { content: '103,1031' } }] },
      '有効': { checkbox: true },
      '中間管理会社': { select: { name: 'BS' } },
    };
    const res = await notionFetch('POST', '/pages', {
      parent: { database_id: CUST_DB },
      properties: props,
    });
    if (res.object === 'error') {
      console.log('  ❌ BS → ' + res.message);
      failed++;
    } else {
      created++;
      console.log('  ✓ BS統合レコード作成 (103,1031)');
    }
  } catch(e) {
    console.log('  ❌ BS → ' + e.message);
    failed++;
  }
  await sleep(350);
}

console.log();
console.log('===== Phase 3: 残り' + otherUnmatched.length + '件 + 関谷 を新規作成 =====');
// 関谷モータース元請けを追加
const allNew = [
  ...otherUnmatched,
  { code: '231', yayoiName: '関谷モータース', note: '元請け（ソルコム・皆実高校はエンドユーザー）' },
];

// 元請け判定: TOYO / ふそう東 / ふそう西 は 中間管理会社を自分自身にセット
function getKanriKaisha(name, code) {
  if (code === '001') return 'TOYO';           // ﾄｰﾖｰﾀｲﾔｼﾞｬﾊﾟﾝ
  if (code === '00371') return 'ふそう東';      // 三菱ふそう広島東
  if (code === '200') return 'ふそう西';        // 三菱ふそう広島西
  if (code === '231') return null;              // 関谷（選択肢にない）
  return 'F.o.o';                                // それ以外は直接取引
}

for (const u of allNew) {
  const isSpecial = SPECIAL.has(u.code);
  const kanri = getKanriKaisha(u.yayoiName, u.code);
  try {
    const props = {
      '会社名': { title: [{ text: { content: u.yayoiName } }] },
      '弥生得意先コード': { rich_text: [{ text: { content: u.code } }] },
      '有効': { checkbox: !isSpecial },
    };
    if (kanri) props['中間管理会社'] = { select: { name: kanri } };
    const res = await notionFetch('POST', '/pages', {
      parent: { database_id: CUST_DB },
      properties: props,
    });
    if (res.object === 'error') {
      console.log('  ❌ ' + u.code + ' ' + u.yayoiName + ' → ' + res.message);
      failed++;
    } else {
      created++;
      const tag = isSpecial ? '[特殊]' : (kanri ? '[' + kanri + ']' : '[元請け]');
      console.log('  ✓ ' + tag + ' ' + u.code + ' ' + u.yayoiName);
    }
  } catch(e) {
    console.log('  ❌ ' + u.code + ' → ' + e.message);
    failed++;
  }
  await sleep(350);
}

console.log();
console.log('===== 結果 =====');
console.log('✅ 更新: ' + updated + ' 件（マッチ済み既存レコード）');
console.log('✅ 新規作成: ' + created + ' 件');
console.log('❌ 失敗: ' + failed + ' 件');
console.log('合計処理: ' + (updated + created) + ' 件');
