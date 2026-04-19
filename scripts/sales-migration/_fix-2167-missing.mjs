// 2025/8 伝票00002167 に不足明細2件を追加
// HT03 ハイタイヤ qty=4 単価=0 金額=0 (付帯サービス)
// SH01 市内出張 qty=1 単価=1500 金額=1500 備考=エーコムにて
import https from 'https';

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';
const DETAIL_DB = '07bd22655e5849fd854bef1f4c4b5688';
const DRY = process.argv.includes('--dry');

function nf(method, p, body, retries = 5) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(new Error(c.slice(0, 300))); } });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1), 3000); else rej(e); });
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 伝票00002167 を検索（2025/8、ページネーション対応）
let target = null;
let cursor = null;
do {
  const body = { filter: { and: [
    { property: '売上日', date: { on_or_after: '2025-08-01' } },
    { property: '売上日', date: { on_or_before: '2025-08-31' } },
  ]}, page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', body);
  for (const s of (r.results || [])) {
    const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
    if (memo.includes('弥生伝票00002167')) { target = s; break; }
  }
  if (target) break;
  cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
if (!target) {
  console.log('伝票00002167が見つかりません');
  process.exit(1);
}
console.log('pageId:', target.id);

// 既存明細取得して重複防止
const dr = await nf('POST', '/databases/' + DETAIL_DB + '/query', {
  filter: { property: '売上伝票', relation: { contains: target.id } }, page_size: 100,
});
const existing = new Set();
for (const d of dr.results) {
  const code = d.properties['商品コード']?.rich_text?.[0]?.plain_text || '';
  const qty = d.properties['数量']?.number || 0;
  const tanka = d.properties['単価']?.number || 0;
  existing.add(`${code}|${qty}|${tanka}`);
}
console.log('既存明細:', dr.results.length, '件');

// 追加する明細
const toAdd = [
  { code: 'HT03', name: 'ＰＣ　ハイタイヤ（五日市）', qty: 4, tanka: 0, hinmoku: 'その他', taxKb: '課税(10%)' },
  { code: 'SH01', name: '市内出張', qty: 1, tanka: 1500, hinmoku: '出張(市内)', taxKb: '課税(10%)', bikou: 'エーコムにて' },
];

for (const a of toAdd) {
  const key = `${a.code}|${a.qty}|${a.tanka}`;
  if (existing.has(key)) {
    console.log('  既存スキップ:', a.code);
    continue;
  }
  const zeikomi = Math.round(a.qty * a.tanka * 1.1);
  const zeigaku = Math.round(a.qty * a.tanka * 0.1);
  const props = {
    '明細タイトル': { title: [{ text: { content: a.code + ' ' + a.name } }] },
    '商品コード': { rich_text: [{ text: { content: a.code } }] },
    '品目': { select: { name: a.hinmoku } },
    '数量': { number: a.qty },
    '単価': { number: a.tanka },
    '税込小計': { number: zeikomi },
    '税額': { number: zeigaku },
    '税区分': { select: { name: a.taxKb } },
    '売上伝票': { relation: [{ id: target.id }] },
  };
  if (a.bikou) props['備考'] = { rich_text: [{ text: { content: a.bikou } }] };
  console.log('追加:', a.code, a.qty, '×', a.tanka, '=', a.qty * a.tanka, a.bikou || '');
  if (!DRY) {
    const res = await nf('POST', '/pages', {
      parent: { database_id: DETAIL_DB },
      properties: props,
    });
    console.log('  created:', res.id?.slice(0, 8) || 'ERROR', res.object === 'error' ? res.message : 'OK');
    await sleep(300);
  }
}

// 伝票の税抜合計・税込合計・消費税合計を再計算（5,200円 → 税抜6,700円、税込7,370円）
// 弥生の正しい値: 税抜6,700円 / 税額670円 / 税込7,370円 だが
// 元のNotion税抜合計は5,200円（既存4明細の合計）なので、追加SH01の1,500円を加えて6,700円に
if (!DRY) {
  const currentZeinuki = target.properties['税抜合計']?.number || 0;
  const currentZeikomi = target.properties['税込合計']?.number || 0;
  const currentShouhizei = target.properties['消費税合計']?.number || 0;
  const newZeinuki = currentZeinuki + 1500;  // SH01追加分
  const newShouhizei = currentShouhizei + 150;
  const newZeikomi = currentZeikomi + 1650;
  console.log('伝票合計更新: 税抜', currentZeinuki, '→', newZeinuki, '/ 消費税', currentShouhizei, '→', newShouhizei, '/ 税込', currentZeikomi, '→', newZeikomi);
  await nf('PATCH', '/pages/' + target.id, { properties: {
    '税抜合計': { number: newZeinuki },
    '消費税合計': { number: newShouhizei },
    '税込合計': { number: newZeikomi },
  }});
  console.log('  伝票更新完了');
}
console.log('DONE');
