-- NOT NULL制約を緩和（空データ対応）
-- SQLite の制約変更は DROP+CREATE が必要なので、新しい CREATE を使う方針

DROP TABLE IF EXISTS 顧客情報DB;
CREATE TABLE 顧客情報DB (
  id TEXT PRIMARY KEY,
  顧客名 TEXT,
  ふりがな TEXT,
  住所 TEXT,
  TEL TEXT,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);

DROP TABLE IF EXISTS 得意先マスタ;
CREATE TABLE 得意先マスタ (
  id TEXT PRIMARY KEY,
  得意先名 TEXT,
  ふりがな TEXT,
  弥生得意先コード TEXT,
  有効 INTEGER DEFAULT 0,
  取引区分 TEXT,
  住所 TEXT,
  TEL TEXT,
  FAX TEXT,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX idx_得意先マスタ_有効 ON 得意先マスタ(有効);
CREATE INDEX idx_得意先マスタ_弥生コード ON 得意先マスタ(弥生得意先コード);

DROP TABLE IF EXISTS 仕入先マスタ;
CREATE TABLE 仕入先マスタ (
  id TEXT PRIMARY KEY,
  仕入先名 TEXT,
  仕入先コード TEXT,
  適格請求書事業者 INTEGER DEFAULT 0,
  登録番号 TEXT,
  TEL TEXT,
  住所 TEXT,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
