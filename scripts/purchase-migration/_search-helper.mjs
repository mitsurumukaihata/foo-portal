// /search API を使って特定DBの全ページを取得するヘルパ
// Notion の /databases/{id}/query が300件でキャップされる問題の回避策
import https from 'https';

export function notionRequest(method, p, body, retries = 6) {
  return new Promise((resolve) => {
    const tryFetch = (n, attempt = 1) => {
      const d = body ? JSON.stringify(body) : '';
      const opt = { hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method, headers: { 'Content-Type': 'application/json' } };
      if (d) opt.headers['Content-Length'] = Buffer.byteLength(d);
      const req = https.request(opt, r => {
        let c = ''; r.on('data', x => c += x);
        r.on('end', () => {
          let pp;
          try { pp = JSON.parse(c); }
          catch(e) { if (n>0) { setTimeout(()=>tryFetch(n-1, attempt+1), 5000); return; } return resolve({ object:'error', code:'parse', message:e.message }); }
          if (pp?.object === 'error' && ['rate_limited','internal_server_error','service_unavailable','conflict_error','bad_gateway'].includes(pp.code) && n>0) {
            setTimeout(() => tryFetch(n-1, attempt+1), Math.min(60000, 5000 * Math.pow(2, attempt-1)));
            return;
          }
          resolve(pp);
        });
      });
      req.on('error', e => { if (n>0) setTimeout(()=>tryFetch(n-1, attempt+1), 5000); else resolve({ object:'error', code:'network', message:e.message }); });
      req.setTimeout(60000, () => req.destroy());
      if (d) req.write(d); req.end();
    };
    tryFetch(retries);
  });
}

/**
 * /search API 経由で特定DBの全ページを取得
 * @param {string[]} parentIds - マッチ対象の database_id / data_source_id（ハイフンあり）のリスト
 * @param {object} opts - { onProgress: (count)=>void }
 */
export async function fetchAllPagesInDb(parentIds, opts = {}) {
  const wantSet = new Set(parentIds.flatMap(id => [id, id.replace(/-/g, '')]));
  const hits = [];
  let cursor = null;
  let scanned = 0;
  do {
    const body = { page_size: 100, filter: { value: 'page', property: 'object' } };
    if (cursor) body.start_cursor = cursor;
    const r = await notionRequest('POST', '/search', body);
    if (r.object === 'error') throw new Error('search error: ' + r.code + ' ' + r.message);
    for (const p of (r.results || [])) {
      scanned++;
      const pid = p.parent?.data_source_id || p.parent?.database_id || '';
      if (wantSet.has(pid) || wantSet.has(pid.replace(/-/g, ''))) hits.push(p);
    }
    if (opts.onProgress) opts.onProgress(hits.length, scanned);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return hits;
}
