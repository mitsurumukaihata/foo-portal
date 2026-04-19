// 2023/12, 2024/3 に残っている伝票のID一覧を出力
import https from 'https';

function nf(method, p, body, retries = 10) {
  return new Promise((res, rej) => {
    const tryFetch = (n) => {
      const d = body ? JSON.stringify(body) : '';
      const req = https.request({ hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
        let c = '';
        r.on('data', x => c += x);
        r.on('end', () => {
          try {
            const parsed = JSON.parse(c);
            if (parsed.object === 'error' && parsed.code === 'rate_limited' && n > 0) { setTimeout(() => tryFetch(n-1), 60000); return; }
            res(parsed);
          } catch(e) { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(new Error(c.slice(0, 300))); }
        });
      });
      req.on('error', e => { if (n > 0) setTimeout(() => tryFetch(n-1), 5000); else rej(e); });
      req.setTimeout(30000, () => req.destroy());
      if (d) req.write(d);
      req.end();
    };
    tryFetch(retries);
  });
}

const SALES_DB = '58cc4a13df03435db14b3439ef1f0a6f';

for (const [year, month, label] of [[2023, 12, '2023/12'], [2024, 3, '2024/3']]) {
  const dateFrom = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  const r = await nf('POST', '/databases/' + SALES_DB + '/query', {
    filter: { and: [
      { property: '売上日', date: { on_or_after: dateFrom } },
      { property: '売上日', date: { on_or_before: dateTo } },
    ]}, page_size: 100,
  });
  console.log('===', label, '残存:', (r.results||[]).length, '件 ===');
  for (const s of (r.results||[])) {
    const memo = s.properties['備考']?.rich_text?.[0]?.plain_text || '';
    const m = memo.match(/弥生伝票(\d+)/);
    const title = s.properties['伝票タイトル']?.title?.[0]?.plain_text || '';
    console.log(s.id, 'archived=' + (s.archived||false), 'title="' + title + '"', '弥生' + (m?m[1]:'-'));
  }
}
