#!/usr/bin/env node
// 売上伝票DBの既存データを (弥生伝票番号+売上日) キーで取得
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SALES_DS = '46b28352-0562-4fbc-8416-b7357291f808';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function nf(p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method:'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
    }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>{ try{res(JSON.parse(c));}catch(e){rej(e);} }); });
    req.on('error',rej); if(d) req.write(d); req.end();
  });
}

const all=[]; let cursor=null;
do {
  const body={page_size:100}; if(cursor) body.start_cursor=cursor;
  const r = await nf('/data_sources/'+SALES_DS+'/query', body);
  all.push(...(r.results||[]));
  cursor = r.has_more ? r.next_cursor : null;
  process.stdout.write('\r  '+all.length+'件...');
} while(cursor);
console.log('\n取得:', all.length);

const keys = new Set();
for (const p of all) {
  const bikou = p.properties['備考']?.rich_text?.[0]?.plain_text || '';
  const date = p.properties['売上日']?.date?.start || '';
  const m = bikou.match(/弥生伝票(\d+)/);
  if (m && date) keys.add(m[1] + '|' + date);
}
console.log('ユニーク(弥生伝票番号+日):', keys.size);
fs.writeFileSync(path.join(SCRIPT_DIR, 'existing-sales-keys.json'), JSON.stringify([...keys], null, 2));
console.log('→ existing-sales-keys.json 保存');
