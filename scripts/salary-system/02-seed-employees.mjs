#!/usr/bin/env node
/**
 * Notion 社員マスタ → D1 社員マスタ シード
 * 在籍中・退職問わず全員を同期 (権限制御に必要)
 */
import https from 'node:https';

const EMPLOYEE_DB = '08c5405729794337886b3565352ef96a';
const WORKER = 'notion-proxy.33322666666mm.workers.dev';

function call(host, path, payload, method = 'POST') {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const opt = {
      hostname: host, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opt, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d, status: r.statusCode }); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const sql = (q, params = []) => call(WORKER, '/d1/sql', { sql: q, params });

async function fetchAllEmployees() {
  const all = [];
  let cursor;
  while (true) {
    const body = JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 });
    const res = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: WORKER,
        path: '/v1/databases/' + EMPLOYEE_DB + '/query',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    if (res.status !== 200) throw new Error('Notion fetch failed: ' + res.body);
    const j = JSON.parse(res.body);
    all.push(...j.results);
    if (!j.has_more) break;
    cursor = j.next_cursor;
  }
  return all;
}

function num(p) { return p?.number ?? null; }
function txt(p) {
  if (!p) return null;
  if (p.type === 'title' || p.type === 'rich_text') return (p[p.type] || []).map(x => x.plain_text).join('') || null;
  if (p.type === 'select') return p.select?.name || null;
  if (p.type === 'email') return p.email || null;
  if (p.type === 'url') return p.url || null;
  return null;
}

async function main() {
  console.log('📥 Notion 社員マスタ取得中...');
  const pages = await fetchAllEmployees();
  console.log(`  ${pages.length}名取得`);

  // 既存全削除→入れ直し (シンプル)
  console.log('🗑  D1 既存社員マスタクリア...');
  // SELECT only なので worker /d1/exec endpoint 必要、代わりに wrangler 使うか…一旦 INSERT OR REPLACE で対応
  // INSERT OR REPLACE エンドポイントを Worker に追加するか、別のSQL実行手段が必要

  console.log('💾 D1 へINSERT OR REPLACE...');
  let ok = 0, ng = 0;
  for (const page of pages) {
    const p = page.properties;
    const row = {
      id: page.id,
      氏名: txt(p['氏名']),
      在籍: txt(p['在籍']),
      権限: txt(p['権限']),
      アプリグループ: txt(p['アプリグループ']),
      メールアドレス: txt(p['メールアドレス']),
      給与体系: txt(p['給与体系']),
      基本給: num(p['基本給']),
      時給: num(p['時給']),
      通勤手当: num(p['通勤手当']),
      住民税月額: num(p['住民税月額']),
      健康保険月額: num(p['健康保険月額']),
      厚生年金月額: num(p['厚生年金月額']),
      扶養人数: num(p['扶養人数']),
      所定労働日数: num(p['所定労働日数']),
      所定労働時間: num(p['所定労働時間']),
      表示順: num(p['表示順']),
      PIN: txt(p['PIN']),
      メモ: txt(p['メモ']),
      最終ログイン: txt(p['最終ログイン']),
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
    };
    if (!row.氏名) { ng++; continue; }
    const r = await call(WORKER, '/d1/upsert-employee', row);
    if (r.success) ok++;
    else { ng++; console.log(`  ❌ ${row.氏名}:`, r.error); }
  }
  console.log(`✅ 完了: ${ok}名 / 失敗: ${ng}名`);
}

main().catch(e => { console.error(e); process.exit(1); });
