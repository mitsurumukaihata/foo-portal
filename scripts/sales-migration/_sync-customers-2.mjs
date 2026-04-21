import https from 'https';

function nf(method, path, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev', path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>res(JSON.parse(c))); });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CUST_DB = '1ca8d122be214e3892879932147143c9';

// Notion顧客情報全件取得
const all = [];
let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', `/databases/${CUST_DB}/query`, body);
  all.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
console.log('顧客情報DB:', all.length, '件');

function norm(s) {
  return s.replace(/[\s　]/g,'').replace(/[(（]株[)）]|株式会社|㈱/g,'').replace(/[(（]有[)）]|有限会社|㈲/g,'').toLowerCase();
}

// サフィックス除去（NR/G等）+ 本社・支店名も一時除去してマッチ
function stripSuffix(name) {
  return name.replace(/（[A-Za-z/]{1,8}）$/g, '').replace(/\([A-Za-z/]{1,8}\)$/g, '');
}

// 括弧内の別名を抽出
function extractAlias(name) {
  const m = name.match(/[（(]([^）)]+)[）)]$/);
  return m ? m[1] : null;
}

// マッチング用インデックス
const notionIndex = new Map();
all.forEach(c => {
  const name = c.properties['会社名']?.title?.[0]?.plain_text || '';
  const code = c.properties['弥生得意先コード']?.rich_text?.[0]?.plain_text || '';
  const keys = new Set();
  keys.add(norm(name));
  keys.add(norm(stripSuffix(name)));
  const alias = extractAlias(name);
  if (alias) keys.add(norm(alias));
  keys.forEach(k => {
    if (k.length < 2) return;
    if (!notionIndex.has(k)) notionIndex.set(k, []);
    notionIndex.get(k).push({ id: c.id, name, code });
  });
});

// マッチング対象
const targets = [
  {code:'005', name:'光立機工株式会社　安佐営業所'},
  {code:'008', name:'光立機工株式会社　本社'},
  {code:'018', name:'中山建設　株式会社'},
  {code:'020', name:'広島堆肥プラント　株式会社'},
  {code:'040', name:'株式会社　東雲打設工業'},
  {code:'060', name:'有限会社　クラタ運送'},
  {code:'0255', name:'(株)ダンロップタイヤ　広島営業所'},
  {code:'151', name:'株式会社カンサイ'},
  {code:'198', name:'株式会社タオダ自動車工業'},
  {code:'211', name:'株式会社　進商事'},
  {code:'241', name:'亀田農園株式会社'},
  {code:'247', name:'株式会社　JSOF'},
  {code:'255', name:'株式会社V.A.U.G'},
  {code:'258', name:'株式会社　キロク'},
  {code:'259', name:'広島冷凍輸送　株式会社　広島営業所'},
  {code:'268', name:'有限会社タイヤショップミカミ　千代田店'},
  {code:'278', name:'株式会社アロード　東広島営業所'},
  {code:'1135', name:'アクト中食株式会社'},
  {code:'1336001', name:'西尾レントオール㈱広島建築設備営業所'},
  {code:'1336005', name:'西尾レントオール㈱広島機械センター'},
  {code:'1336008', name:'西尾レントオール㈱岩国営業所'},
];

let updated = 0, created = 0;
for (const t of targets) {
  const tn = norm(t.name);
  let hit = notionIndex.get(tn);
  if (!hit || hit.length === 0) {
    // 部分一致で再検索
    for (const [k, v] of notionIndex) {
      if (k.length > 3 && (k.includes(tn) || tn.includes(k))) { hit = v; break; }
    }
  }

  if (hit && hit.length > 0) {
    // 最もマッチする候補（コード未設定のもの優先）
    const best = hit.find(h => !h.code) || hit[0];
    if (best.code && best.code.split(',').includes(t.code)) {
      console.log('  ⏭ ' + t.code + ' ' + t.name + ' → 既にコード設定済み');
      continue;
    }
    const newCode = best.code ? best.code + ',' + t.code : t.code;
    await nf('PATCH', `/pages/${best.id}`, {
      properties: { '弥生得意先コード': { rich_text: [{ text: { content: newCode } }] } }
    });
    updated++;
    console.log('  ✓ ' + t.code + ' → ' + best.name + ' (コード追加)');
  } else {
    // 新規作成
    await nf('POST', '/pages', {
      parent: { database_id: CUST_DB },
      properties: {
        '会社名': { title: [{ text: { content: t.name } }] },
        '弥生得意先コード': { rich_text: [{ text: { content: t.code } }] },
      }
    });
    created++;
    console.log('  ✚ ' + t.code + ' ' + t.name + ' (新規作成)');
  }
  await sleep(350);
}

console.log();
console.log('=== 結果 ===');
console.log('コード追加:', updated, '件');
console.log('新規作成:', created, '件');
