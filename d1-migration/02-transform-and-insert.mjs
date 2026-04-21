#!/usr/bin/env node
// Phase 1-B: Notion JSON export を D1 形式に変換して SQL batch 生成
// wrangler経由で D1 にバルクインサート

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = path.join(SCRIPT_DIR, 'export');
const SQL_DIR = path.join(SCRIPT_DIR, 'sql');
if (!fs.existsSync(SQL_DIR)) fs.mkdirSync(SQL_DIR);

const LOG_FILE = path.join(SCRIPT_DIR, 'transform.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// SQL用のエスケープ
function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

// Notion property 値抽出ヘルパ
function getText(p) { return p?.rich_text?.[0]?.plain_text || p?.title?.[0]?.plain_text || ''; }
function getAllText(p) { return (p?.rich_text || p?.title || []).map(t => t.plain_text).join(''); }
function getNum(p) { return p?.number ?? null; }
function getSelect(p) { return p?.select?.name || ''; }
function getMultiSelect(p) { return (p?.multi_select || []).map(o => o.name).join(','); }
function getDate(p) { return p?.date?.start || ''; }
function getRel(p) { return p?.relation?.[0]?.id || ''; }
function getRelAll(p) { return (p?.relation || []).map(r => r.id).join(','); }
function getCheck(p) { return p?.checkbox ? 1 : 0; }
function getFormula(p) { return p?.formula?.string || p?.formula?.number || ''; }

// ─── テーブル別変換関数 ──────────────────────────────

function transform得意先マスタ(p) {
  const pr = p.properties;
  return {
    id: p.id,
    得意先名: getText(pr['得意先名']),
    ふりがな: getText(pr['ふりがな']),
    弥生得意先コード: getText(pr['得意先コード']),  // Notion側は '得意先コード'
    有効: getCheck(pr['有効']),
    取引区分: getSelect(pr['取引区分']) || getText(pr['取引区分']),
    住所: getText(pr['住所']),
    TEL: getText(pr['TEL']),
    FAX: getText(pr['FAX']),
    メモ: getAllText(pr['メモ']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform顧客情報DB(p) {
  const pr = p.properties;
  return {
    id: p.id,
    顧客名: getText(pr['顧客名']) || getText(pr['Name']),
    ふりがな: getText(pr['ふりがな']),
    住所: getText(pr['住所']),
    TEL: getText(pr['TEL']) || getText(pr['電話']),
    メモ: getAllText(pr['メモ']) || getAllText(pr['備考']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform商品マスタ(p) {
  const pr = p.properties;
  return {
    id: p.id,
    商品コード: getText(pr['商品コード']) || getText(pr['コード']),
    商品名: getText(pr['商品名']) || getText(pr['品名']),
    タイヤサイズ: getText(pr['タイヤサイズ']) || getText(pr['サイズ']),
    タイヤ銘柄: getText(pr['タイヤ銘柄']) || getText(pr['銘柄']),
    メーカー: getSelect(pr['メーカー']),
    単価: getNum(pr['単価']),
    メモ: getAllText(pr['メモ']) || getAllText(pr['備考']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform車両マスタ(p) {
  const pr = p.properties;
  return {
    id: p.id,
    車番: getText(pr['車番']),
    管理番号: getText(pr['管理番号']),
    顧客ID: getRel(pr['顧客']) || getRel(pr['顧客名']),
    車種: getSelect(pr['車種']),
    仕様: getText(pr['仕様']),
    前輪サイズ: getText(pr['前輪サイズ']) || getText(pr['サイズ前']),
    後輪サイズ: getText(pr['後輪サイズ']) || getText(pr['サイズ後']),
    前輪パターン: getText(pr['前輪パターン']),
    後輪パターン: getText(pr['後輪パターン']),
    本数: getNum(pr['本数']),
    カテゴリ: getSelect(pr['カテゴリ']),
    バルブ交換日: getDate(pr['バルブ交換日']) || getText(pr['最終バルブ']),
    メモ: getAllText(pr['メモ']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform仕入先マスタ(p) {
  const pr = p.properties;
  return {
    id: p.id,
    仕入先名: getText(pr['仕入先名']),
    仕入先コード: getText(pr['仕入先コード']),
    適格請求書事業者: getCheck(pr['適格請求書事業者']),
    登録番号: getText(pr['登録番号']),
    TEL: getText(pr['TEL']),
    住所: getText(pr['住所']),
    メモ: getAllText(pr['メモ']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform売上伝票(p) {
  const pr = p.properties;
  return {
    id: p.id,
    伝票タイトル: getText(pr['伝票タイトル']),
    売上日: getDate(pr['売上日']),
    請求先ID: getRel(pr['請求先']),
    顧客名ID: getRel(pr['顧客名']),
    伝票種類: getSelect(pr['伝票種類']),
    作業区分: getSelect(pr['作業区分']),
    担当者: getSelect(pr['担当者']),
    支払い方法: getSelect(pr['支払い方法']),
    宛先敬称: getSelect(pr['宛先敬称']),
    車番: getText(pr['車番']),
    管理番号: getText(pr['管理番号']),
    税抜合計: getNum(pr['税抜合計']),
    消費税合計: getNum(pr['消費税合計']),
    税込合計: getNum(pr['税込合計']),
    ステータス: getSelect(pr['ステータス']),
    備考: getAllText(pr['備考']),
    件名: getText(pr['件名']),
    要確認: getCheck(pr['要確認']),
    確認項目: getAllText(pr['確認項目']),
    伝票番号: pr['伝票番号']?.unique_id?.number || pr['伝票番号']?.number || null,
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform売上明細(p) {
  const pr = p.properties;
  return {
    id: p.id,
    売上伝票ID: getRel(pr['売上伝票']),
    明細タイトル: getText(pr['明細タイトル']),
    商品コード: getText(pr['商品コード']),
    品目: getSelect(pr['品目']),
    タイヤサイズ: getText(pr['タイヤサイズ']),
    タイヤ銘柄: getText(pr['タイヤ銘柄']),
    数量: getNum(pr['数量']),
    単位: getSelect(pr['単位']),
    単価: getNum(pr['単価']),
    税区分: getSelect(pr['税区分']),
    税額: getNum(pr['税額']),
    税込小計: getNum(pr['税込小計']),
    車番: getText(pr['車番']),
    備考: getAllText(pr['備考']),
    弥生備考: getAllText(pr['弥生備考']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform仕入伝票(p) {
  const pr = p.properties;
  return {
    id: p.id,
    伝票タイトル: getText(pr['伝票タイトル']),
    仕入日: getDate(pr['仕入日']),
    入荷日: getDate(pr['入荷日']),
    弥生伝票番号: getText(pr['弥生伝票番号']),
    仕入先ID: getRel(pr['仕入先']),
    担当者: getSelect(pr['担当者']),
    税抜合計: getNum(pr['税抜合計']),
    消費税合計: getNum(pr['消費税合計']),
    税込合計: getNum(pr['税込合計']),
    仕入税額控除: getSelect(pr['仕入税額控除']),
    ステータス: getSelect(pr['ステータス']),
    発注番号: getText(pr['発注番号']),
    備考: getAllText(pr['備考']),
    伝票番号: pr['伝票番号']?.unique_id?.number || pr['伝票番号']?.number || null,
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform仕入明細(p) {
  const pr = p.properties;
  return {
    id: p.id,
    仕入伝票ID: getRel(pr['仕入伝票']),
    明細タイトル: getText(pr['明細タイトル']),
    商品コード: getText(pr['商品コード']),
    品名: getText(pr['品名']),
    タイヤサイズ: getText(pr['タイヤサイズ']),
    銘柄: getText(pr['銘柄']),
    メーカー: getSelect(pr['メーカー']),
    数量: getNum(pr['数量']),
    単位: getSelect(pr['単位']),
    単価: getNum(pr['単価']),
    税込小計: getNum(pr['税込小計']),
    税額: getNum(pr['税額']),
    税区分: getSelect(pr['税区分']),
    備考: getAllText(pr['備考']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform勤怠管理(p) {
  const pr = p.properties;
  return {
    id: p.id,
    タイトル: getText(pr['タイトル']),
    社員名: getSelect(pr['社員名']),
    日付: getDate(pr['日付']),
    出勤: getNum(pr['出勤']),
    退勤: getNum(pr['退勤']),
    有給使用: getCheck(pr['有給使用']),
    有給使用時間: getNum(pr['有給使用時間']),
    欠勤: getCheck(pr['欠勤']),
    労災扱い: getCheck(pr['労災扱い']),
    指定休: getCheck(pr['指定休']),
    締め月手入力: getSelect(pr['締め月（手入力）']),
    備考: getAllText(pr['備考']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform入金管理(p) {
  const pr = p.properties;
  return {
    id: p.id,
    入金日: getDate(pr['入金日']) || getDate(pr['日付']),
    請求先ID: getRel(pr['請求先']) || getRel(pr['顧客']),
    金額: getNum(pr['金額']) || getNum(pr['入金額']),
    入金方法: getSelect(pr['入金方法']),
    備考: getAllText(pr['備考']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

function transform発注管理(p) {
  const pr = p.properties;
  return {
    id: p.id,
    発注日: getDate(pr['発注日']) || getDate(pr['日付']),
    納入予定日: getDate(pr['納入予定日']),
    納入予定場所: getSelect(pr['納入予定場所']) || getText(pr['納入予定場所']),
    商品コード: getText(pr['商品コード']),
    サイズコード: getText(pr['サイズコード']),
    パターン名: getText(pr['パターン名']),
    数量: getNum(pr['数量']),
    単価: getNum(pr['単価']),
    発注先: getText(pr['発注先']) || getSelect(pr['発注先']),
    ステータス: getSelect(pr['ステータス']),
    備考: getAllText(pr['備考']),
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
  };
}

const TRANSFORMERS = {
  '得意先マスタ': transform得意先マスタ,
  '顧客情報DB': transform顧客情報DB,
  '商品マスタ': transform商品マスタ,
  '車両マスタ': transform車両マスタ,
  '仕入先マスタ': transform仕入先マスタ,
  // 売上系・仕入系は Excel から直接 (02c / 02d で別生成)
  '勤怠管理': transform勤怠管理,
  '入金管理': transform入金管理,
  '発注管理': transform発注管理,
};

// カラム順（SQL INSERT 用）
const COLUMNS = {
  '得意先マスタ': ['id','得意先名','ふりがな','弥生得意先コード','有効','取引区分','住所','TEL','FAX','メモ','created_time','last_edited_time'],
  '顧客情報DB': ['id','顧客名','ふりがな','住所','TEL','メモ','created_time','last_edited_time'],
  '商品マスタ': ['id','商品コード','商品名','タイヤサイズ','タイヤ銘柄','メーカー','単価','メモ','created_time','last_edited_time'],
  '車両マスタ': ['id','車番','管理番号','顧客ID','車種','仕様','前輪サイズ','後輪サイズ','前輪パターン','後輪パターン','本数','カテゴリ','バルブ交換日','メモ','created_time','last_edited_time'],
  '仕入先マスタ': ['id','仕入先名','仕入先コード','適格請求書事業者','登録番号','TEL','住所','メモ','created_time','last_edited_time'],
  '売上伝票': ['id','伝票タイトル','売上日','請求先ID','顧客名ID','伝票種類','作業区分','担当者','支払い方法','宛先敬称','車番','管理番号','税抜合計','消費税合計','税込合計','ステータス','備考','件名','要確認','確認項目','伝票番号','created_time','last_edited_time'],
  '売上明細': ['id','売上伝票ID','明細タイトル','商品コード','品目','タイヤサイズ','タイヤ銘柄','数量','単位','単価','税区分','税額','税込小計','車番','備考','弥生備考','created_time','last_edited_time'],
  '仕入伝票': ['id','伝票タイトル','仕入日','入荷日','弥生伝票番号','仕入先ID','担当者','税抜合計','消費税合計','税込合計','仕入税額控除','ステータス','発注番号','備考','伝票番号','created_time','last_edited_time'],
  '仕入明細': ['id','仕入伝票ID','明細タイトル','商品コード','品名','タイヤサイズ','銘柄','メーカー','数量','単位','単価','税込小計','税額','税区分','備考','created_time','last_edited_time'],
  '勤怠管理': ['id','タイトル','社員名','日付','出勤','退勤','有給使用','有給使用時間','欠勤','労災扱い','指定休','締め月手入力','備考','created_time','last_edited_time'],
  '入金管理': ['id','入金日','請求先ID','金額','入金方法','備考','created_time','last_edited_time'],
  '発注管理': ['id','発注日','納入予定日','納入予定場所','商品コード','サイズコード','パターン名','数量','単価','発注先','ステータス','備考','created_time','last_edited_time'],
};

// SQL生成
function genSQL(tableName, records) {
  const cols = COLUMNS[tableName];
  const colList = cols.map(c => `"${c}"`).join(', ');
  const BATCH = 50; // 1つのINSERT文あたりのVALUES件数
  const statements = [];
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const values = batch.map(r => '(' + cols.map(c => esc(r[c])).join(', ') + ')').join(',\n  ');
    statements.push(`INSERT INTO "${tableName}" (${colList}) VALUES\n  ${values};`);
  }
  return statements.join('\n');
}

// slipKey (弥生伝票番号+日付) ベースのdedup（最古のID優先）
function dedupByBikou(rows, bikouCol = '備考', dateCol = '売上日') {
  const byKey = new Map();
  const unmatched = [];
  for (const r of rows) {
    const bikou = r[bikouCol] || '';
    const date = r[dateCol] || '';
    const m = bikou.match(/弥生伝票(\d+)/);
    if (!m || !date) { unmatched.push(r); continue; }
    const key = m[1] + '|' + date;
    const existing = byKey.get(key);
    if (!existing || (r.created_time < existing.created_time)) {
      byKey.set(key, r);
    }
  }
  return [...byKey.values(), ...unmatched];
}

log('━━━ 変換＆SQL生成 開始 ━━━');
const stats = {};
for (const [name, transformer] of Object.entries(TRANSFORMERS)) {
  const inputPath = path.join(EXPORT_DIR, name + '.json');
  if (!fs.existsSync(inputPath)) {
    log(`⚠️ ${name}.json が無い → skip`);
    continue;
  }
  log(`🔄 ${name} 変換中...`);
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  let rows = raw.map(transformer);
  const initialCount = rows.length;
  // ID重複除去（念のため）
  const seen = new Set();
  rows = rows.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id); return true;
  });
  // 売上伝票・仕入伝票は 弥生伝票+日付 で dedup
  if (name === '売上伝票') {
    const before = rows.length;
    rows = dedupByBikou(rows, '備考', '売上日');
    log(`   dedup by slipKey: ${before}→${rows.length}`);
  }
  if (name === '仕入伝票') {
    // 仕入の 弥生伝票番号 は専用フィールド
    const byKey = new Map();
    for (const r of rows) {
      const key = (r['弥生伝票番号'] || '') + '|' + (r['仕入日'] || '');
      if (!key.includes('|')) continue;
      const ex = byKey.get(key);
      if (!ex || r.created_time < ex.created_time) byKey.set(key, r);
    }
    const before = rows.length;
    rows = [...byKey.values()];
    log(`   dedup by slipKey: ${before}→${rows.length}`);
  }
  const sql = genSQL(name, rows);
  fs.writeFileSync(path.join(SQL_DIR, name + '.sql'), sql);
  log(`   ✅ ${rows.length}行 (元${initialCount}) → ${name}.sql (${Math.round(sql.length/1024)}KB)`);
  stats[name] = { input: initialCount, output: rows.length };
}

log('━━━ 変換完了 ━━━');
fs.writeFileSync(path.join(SCRIPT_DIR, 'transform-stats.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
