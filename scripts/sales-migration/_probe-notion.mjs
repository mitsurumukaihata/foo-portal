// プロキシ動作確認: 2024/12のNotion伝票を1ページだけ取得
import https from 'https';

function nf(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev',
      path: p, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, r => {
      let c = '';
      r.on('data', x => c += x);
      r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { rej(new Error(c.slice(0, 500))); } });
    });
    req.on('error', rej);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    if (d) req.write(d);
    req.end();
  });
}

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';

async function probe() {
  console.log('=== Notion Proxy Probe ===');

  // Test 1: 単純な全件クエリ（page_size=5）
  console.log('Test 1: page_size=5 全件');
  try {
    const r = await nf('POST', '/databases/' + SALES_DB + '/query', { page_size: 5 });
    console.log('  伝票:', (r.results || []).length, 'has_more:', r.has_more);
    if (r.results?.[0]) {
      const p = r.results[0];
      console.log('  サンプル:', p.id, p.properties?.['売上日']?.date?.start, p.properties?.['備考']?.rich_text?.[0]?.plain_text?.slice(0,50));
    }
    if (r.object === 'error') console.log('  ERROR:', r.message);
  } catch(e) { console.log('  失敗:', e.message); }

  // Test 2: 2024/12 フィルタ
  console.log();
  console.log('Test 2: 2024/12 フィルタ page_size=100');
  try {
    const r = await nf('POST', '/databases/' + SALES_DB + '/query', {
      filter: { and: [
        { property: '売上日', date: { on_or_after: '2024-12-01' } },
        { property: '売上日', date: { on_or_before: '2024-12-31' } },
      ]},
      page_size: 100,
    });
    console.log('  伝票:', (r.results || []).length, 'has_more:', r.has_more);
    if (r.object === 'error') console.log('  ERROR:', r.message);
  } catch(e) { console.log('  失敗:', e.message); }

  // Test 3: 2024/12 フィルタ (降順ソート)
  console.log();
  console.log('Test 3: 2024/12 フィルタ + 降順ソート');
  try {
    const r = await nf('POST', '/databases/' + SALES_DB + '/query', {
      filter: { and: [
        { property: '売上日', date: { on_or_after: '2024-12-01' } },
        { property: '売上日', date: { on_or_before: '2024-12-31' } },
      ]},
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 100,
    });
    console.log('  伝票:', (r.results || []).length, 'has_more:', r.has_more);
    if (r.object === 'error') console.log('  ERROR:', r.message);
  } catch(e) { console.log('  失敗:', e.message); }
}

probe().catch(e => console.error('Fatal:', e));
