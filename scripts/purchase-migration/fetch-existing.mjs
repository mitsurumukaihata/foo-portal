#!/usr/bin/env node
// 仕入伝票DBの既存データを取得 → existing-keys.json に保存
// キー: 弥生伝票番号 + 仕入日 (弥生番号は年度ごとに重複するため)
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SLIP_DB_DS = 'e44b7179-7b09-4fc7-9c09-a2783f678283';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function nf(p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'notion-proxy.33322666666mm.workers.dev', path: p, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
    }, r => { let c=''; r.on('data',x=>c+=x); r.on('end',()=>{ try{res(JSON.parse(c));}catch(e){rej(e);} }); });
    req.on('error', rej); if(d) req.write(d); req.end();
  });
}

const all = []; let cursor = null;
do {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await nf('/data_sources/' + SLIP_DB_DS + '/query', body);
  all.push(...(r.results || []));
  cursor = r.has_more ? r.next_cursor : null;
  process.stdout.write(`\r  ${all.length}件...`);
} while (cursor);
console.log(`\n取得: ${all.length}件`);

// キー: slipNo + date
const keys = new Set();
const byKey = new Map();
for (const p of all) {
  const no = p.properties['弥生伝票番号']?.rich_text?.[0]?.plain_text || '';
  const date = p.properties['仕入日']?.date?.start || '';
  if (!no) continue;
  const key = no + '|' + date;
  keys.add(key);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(p.id);
}
const dups = [...byKey.entries()].filter(([k,v]) => v.length > 1);
console.log('ユニークキー(slipNo+date):', keys.size);
console.log('重複キー:', dups.length);

fs.writeFileSync(path.join(SCRIPT_DIR, 'existing-keys.json'), JSON.stringify([...keys], null, 2));
fs.writeFileSync(path.join(SCRIPT_DIR, 'duplicate-slips.json'), JSON.stringify(dups.map(([k,ids]) => ({key:k,ids})), null, 2));
console.log('→ existing-keys.json / duplicate-slips.json 保存');
