#!/usr/bin/env node
/**
 * タイヤ管理表 → 車両マスタ: 前後違うサイズ・車軸配置の反映
 *
 * 引数:
 *   --apply  : 実際に DB を更新 (デフォルトはドライラン)
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const APPLY = process.argv.includes('--apply');
const DATA = path.join(import.meta.dirname, 'all-vehicles.json');

function call(host, p, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: host, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
const sql = (q, params = []) => call('notion-proxy.33322666666mm.workers.dev', '/d1/sql', { sql: q, params });
const updateVehicle = (payload) => call('notion-proxy.33322666666mm.workers.dev', '/d1/update-vehicle', payload);

// サイズ文字列のサニタイズ
// 「夏：195/75R15」「冬：205/85R16」「145R12　6PR」「215/70R17.5  XL」等を整える
function sanitizeSize(s) {
  if (!s) return null;
  let v = String(s);
  // 夏／冬 プレフィックス除去 (主シーズン扱い)
  v = v.replace(/^(夏|冬|S|W)\s*[：:]\s*/, '');
  // ／ や / で区切られた複数サイズの場合は最初を取る
  v = v.split(/[\/／]/)[0];
  // ただし通常サイズの XX/XXR## の '/' は保持する → split前に保護
  // 改めて: 元文字列から最初のXX/XXR## or XXX-RXX or XXX/XXR## or 単数値RXX を抽出
  const m = String(s).match(/(\d{3}\/\d{2}R\d+(?:\.\d)?|\d{3}R\d+(?:\.\d)?|\d\.\d{2}R\d+|\d{3,4}R\d+)/);
  if (m) return m[1].replace(/\s+/g, '');
  return null;
}

// 車軸配置の自動判定
// ⚠ 2-D-D は TB(R22.5/R20)サイズの3軸大型のみ。LTS/PC/バンサイズは絶対に2-D-Dにしない
function inferAxleConfig(v) {
  const fr = v.frQty || 0;
  const rr = v.rrQty || 0;
  const total = fr + rr;
  const isTB = (s) => s && (/R22\.5/.test(s) || /R20\b/.test(s));
  // TBサイズかつ合計10本以上 → 確実な2-D-D
  if (isTB(v.frSize) && total >= 10) return '2-D-D';
  // TBサイズでFr≠Rr → 2-D-D候補
  if (isTB(v.frSize) && v.frSize && v.rrSize && v.frSize !== v.rrSize) return '2-D-D';
  if (total === 6) return '2-D';
  if (total === 4) return '2-2';
  return null; // 不明はnull (上書きしない)
}

// 車番候補検索 (顧客名または車番末尾マッチ)
async function findVehicle(carNo, customerName) {
  const norm = String(carNo || '').replace(/[・･\-\s　]/g, '');
  if (norm.length < 2) return [];
  const r = await sql(`SELECT v.id, v.車番, v.顧客ID, v.前輪サイズ, v.後輪サイズ, v.本数, v.車軸配置, v.メモ,
      COALESCE(e.得意先名, c.顧客名) AS 顧客名
    FROM 車両マスタ v
    LEFT JOIN 得意先マスタ e ON v.顧客ID = e.id
    LEFT JOIN 顧客情報DB c ON v.顧客ID = c.id
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(車番, '-', ''), ' ', ''), '　', ''), '・', ''), '･', '') LIKE '%' || ? || '%'
      AND 車番 NOT LIKE '%(旧%'
    LIMIT 5`, [norm]);
  let cands = r.results || [];
  if (cands.length > 1 && customerName) {
    const cn = customerName.replace(/[株式会社有限会社\(\)（）\s　・]/g, '');
    const filtered = cands.filter(c => (c.顧客名 || '').replace(/[株式会社有限会社\(\)（）\s　・]/g, '').includes(cn) || cn.includes((c.顧客名 || '').replace(/[株式会社有限会社\(\)（）\s　・]/g, '')));
    if (filtered.length > 0) cands = filtered;
  }
  return cands;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  // サイズをサニタイズしてから判定
  const targets = data.map(v => ({
    ...v,
    frSize: sanitizeSize(v.frSize),
    rrSize: sanitizeSize(v.rrSize),
  })).filter(v => v.frSize && v.rrSize && v.frSize !== v.rrSize);
  console.log(`=== 前後違うサイズ ${targets.length}件を処理 ${APPLY ? '(本番反映)' : '(ドライラン)'} ===\n`);

  let matched = 0, applied = 0, skipped = 0, notfound = 0;
  for (const v of targets) {
    const cands = await findVehicle(v.carNo, v.customerName);
    if (cands.length === 0) {
      console.log(`❌ ${v.carNo} (${v.frSize} / ${v.rrSize}) [${v.customerName}] → 未登録`);
      notfound++;
      continue;
    }
    if (cands.length > 1) {
      console.log(`⚠️ ${v.carNo} → 候補${cands.length}件あり、スキップ:`);
      cands.forEach(c => console.log(`     ・${c.車番} (${c.顧客名 || '-'})`));
      skipped++;
      continue;
    }
    const m = cands[0];
    const inferredAxle = inferAxleConfig(v);
    const changes = [];
    const payload = { id: m.id };
    if (m.前輪サイズ !== v.frSize) {
      payload.前輪サイズ = v.frSize;
      changes.push(`前輪: ${m.前輪サイズ || '(空)'} → ${v.frSize}`);
    }
    if (m.後輪サイズ !== v.rrSize) {
      payload.後輪サイズ = v.rrSize;
      changes.push(`後輪: ${m.後輪サイズ || '(空)'} → ${v.rrSize}`);
    }
    if (inferredAxle && m.車軸配置 !== inferredAxle) {
      payload.車軸配置 = inferredAxle;
      changes.push(`車軸: ${m.車軸配置 || '(空)'} → ${inferredAxle}`);
    }
    if (changes.length === 0) {
      console.log(`✓  ${v.carNo} → ${m.車番} (差分なし)`);
      matched++;
      continue;
    }
    matched++;
    console.log(`📝 ${v.carNo} → ${m.車番} [${m.顧客名 || '-'}]`);
    changes.forEach(c => console.log(`     ${c}`));
    if (APPLY) {
      const res = await updateVehicle(payload);
      if (res.success) { applied++; console.log(`     ✅ ${res.changes}行更新`); }
      else console.log(`     ❌ エラー: ${res.error}`);
    }
  }
  console.log(`\n=== サマリ ===`);
  console.log(`  マッチ: ${matched} / 候補複数(スキップ): ${skipped} / 未登録: ${notfound} / 全${targets.length}件`);
  if (APPLY) console.log(`  適用: ${applied}件`);
  else console.log(`\n💡 ドライラン完了。本番反映は --apply を付けて実行。`);
}
main().catch(e => { console.error(e); process.exit(1); });
