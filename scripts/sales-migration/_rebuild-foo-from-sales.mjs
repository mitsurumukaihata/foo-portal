// 売上明細ベースで FOO パック契約DBを再構築
// 1) 既存44契約を全アーカイブ
// 2) 高宮運送 + イドム物流 を同一会社として統合
// 3) ユニーク契約（車番+リース開始日+商品コード）として全部登録
import https from 'https';
import fs from 'fs';

const FOO_DB = '8f7b92b3be4a4ac0832de8b53190c6b5';
const TOKUI_MASTER = 'f632f512f12d49b2b11f2b3e45c70aec';
const WORKER = 'notion-proxy.33322666666mm.workers.dev';

function nf(method, p, body, retries = 3) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: WORKER, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
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

async function archiveAll() {
  console.log('[1] 既存FOO契約を全アーカイブ...');
  const pages = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + FOO_DB + '/query', body);
    pages.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  console.log('  既存:', pages.length, '件');
  let archived = 0;
  for (const p of pages) {
    try {
      await new Promise((res, rej) => {
        const d = JSON.stringify({ archived: true });
        const req = https.request({ hostname: WORKER, path: '/pages/' + p.id, method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r2 => {
          let c = '';
          r2.on('data', x => c += x);
          r2.on('end', () => res(c));
        });
        req.on('error', rej);
        req.write(d);
        req.end();
      });
      archived++;
    } catch(e) { console.log('  ❌', p.id, e.message); }
    await sleep(120);
  }
  console.log('  アーカイブ:', archived, '件');
}

function normCustName(name) {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/株式会社|㈱|\(株\)|（株）|有限会社|㈲|\(有\)|（有）|会社/g, '')
    .replace(/\s+/g, '')
    .replace(/f\.o\.oパック|fパック/gi, '')
    .replace(/本社|営業所|支店/g, '')
    .replace(/＆/g, '&')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

async function buildTokuiMap() {
  const map = new Map();
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await nf('POST', '/databases/' + TOKUI_MASTER + '/query', body);
    for (const p of (r.results || [])) {
      const title = p.properties['得意先名']?.title?.[0]?.plain_text || '';
      if (title) map.set(title, p.id);
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return map;
}

function findTokuiMatch(custName, tokuiMap) {
  const norm = normCustName(custName);
  // イドム物流 f.o.oパック 優先
  for (const [name, id] of tokuiMap) {
    if (normCustName(name) === norm) return { id, name };
  }
  for (const [name, id] of tokuiMap) {
    const n = normCustName(name);
    if (n.includes(norm) || norm.includes(n)) return { id, name };
  }
  return null;
}

function prefixFromCust(custName) {
  const n = normCustName(custName);
  if (n.includes('clo')) return 'CLO';
  if (n.includes('イドム') || n.includes('高宮')) return 'IDM';
  if (n.includes('彩希')) return 'SAIKI';
  if (n.includes('アオイ')) return 'AOI';
  if (n.includes('建機')) return 'KENKI';
  if (n.includes('テイクス')) return 'TEIX';
  if (n.includes('シンヨー') || n.includes('新洋')) return 'SIN';
  if (n.includes('k&m') || n.includes('km')) return 'KM';
  if (n.includes('ヨシダ') || n.includes('よしだ')) return 'YSD';
  return 'FOO';
}

function statusFromLastSeen(lastSeen, leaseEnd) {
  // lastSeen: 'YYYY-MM' string, leaseEnd: 'YYYY-MM-DD'
  const end = new Date(leaseEnd);
  const today = new Date();
  if (end < today) return '満期';
  // lastSeen が 2025/10 以降なら有効
  if (lastSeen >= '2025-10') return '有効';
  return '満期';
}

async function main() {
  const raw = JSON.parse(fs.readFileSync('_foo-contracts-from-sales.json', 'utf8'));
  console.log('ソース契約:', raw.length);
  console.log();

  // 高宮 + イドム を統合: 車番+開始日+商品コード で重複排除、最新lastSeenを採用
  const merged = new Map();
  for (const c of raw) {
    const isIdmFamily = /高宮|イドム/.test(c.custName);
    const mergeCust = isIdmFamily ? '株式会社　イドム物流　f.o.oパック' : c.custName;
    const key = `${isIdmFamily ? 'IDM' : mergeCust}|${c.plate}|${c.leaseStart}|${c.code}`;
    const existing = merged.get(key);
    if (!existing || c.lastSeen > existing.lastSeen) {
      merged.set(key, { ...c, custName: mergeCust });
    }
  }
  console.log('統合後:', merged.size);
  console.log();

  // 得意先マスタマップ
  console.log('[2] 得意先マスタ取得...');
  const tokuiMap = await buildTokuiMap();
  console.log('  件数:', tokuiMap.size);
  console.log();

  // 既存全アーカイブ
  await archiveAll();
  console.log();

  // 投入
  console.log('[3] 再投入...');
  const prefixCount = new Map();
  let success = 0, fail = 0;
  const contracts = [...merged.values()].sort((a, b) => {
    if (a.custName !== b.custName) return a.custName.localeCompare(b.custName);
    return a.leaseStart.localeCompare(b.leaseStart);
  });

  for (const c of contracts) {
    const prefix = prefixFromCust(c.custName);
    prefixCount.set(prefix, (prefixCount.get(prefix) || 0) + 1);
    const seq = String(prefixCount.get(prefix)).padStart(3, '0');
    const plateLabel = c.plate ? ` ${c.plate}` : '';
    const contractNo = `${prefix}-${seq}${plateLabel}`;

    const latest = c.latestPrice || 0;
    const zei = Math.round(latest * 0.1);
    const zeikomi = latest + zei;
    const match = findTokuiMatch(c.custName, tokuiMap);
    const status = statusFromLastSeen(c.lastSeen, c.leaseEnd);

    const props = {
      '契約番号': { title: [{ text: { content: contractNo } }] },
      '得意先名': { rich_text: [{ text: { content: c.custName } }] },
      '商品区分': { select: { name: c.category } },
      '車番': { rich_text: [{ text: { content: c.plate || '' } }] },
      '契約日': { date: { start: c.leaseStart } },
      'リース開始日': { date: { start: c.leaseStart } },
      'リース終了日': { date: { start: c.leaseEnd } },
      '期間月数': { number: 60 },
      '月額税抜': { number: latest },
      '月額消費税': { number: zei },
      '月額税込': { number: zeikomi },
      '最終月税込': { number: zeikomi },
      '最終月税抜': { number: latest },
      '最終月消費税': { number: zei },
      '残価': { number: 0 },
      '契約総額': { number: 0 },
      '状態': { select: { name: status } },
      'メモ': { rich_text: [{ text: { content: `売上明細${c.firstSeen}〜${c.lastSeen}から再構築 / 元得意先名: ${raw.find(r => r.plate === c.plate && r.leaseStart === c.leaseStart && r.code === c.code)?.custName || ''}` } }] },
    };
    if (match) props['得意先'] = { relation: [{ id: match.id }] };

    try {
      const r = await nf('POST', '/pages', { parent: { database_id: FOO_DB }, properties: props });
      if (r.object === 'error') throw new Error(r.message);
      success++;
      if (success % 25 === 0) console.log(`  ${success}/${contracts.length} ...`);
    } catch(e) {
      fail++;
      console.log(`  ❌ ${contractNo}: ${e.message}`);
    }
    await sleep(180);
  }

  console.log();
  console.log(`成功: ${success} / 失敗: ${fail}`);
  console.log();
  console.log('プレフィックス別:');
  for (const [p, n] of prefixCount) console.log(`  ${p}: ${n}件`);
}

main().catch(e => { console.error(e); process.exit(1); });
