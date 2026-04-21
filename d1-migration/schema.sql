-- ════════════════════════════════════════════════════════════════
-- foo-portal D1 スキーマ（Notion からの移行先）
-- データベース: foo-portal-db (ID: 5abde5a4-c104-419e-a88a-d879af9356cc)
-- 作成日: 2026-04-21
-- ════════════════════════════════════════════════════════════════

-- ─── 顧客関連 ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS 得意先マスタ (
  id TEXT PRIMARY KEY,          -- NotionページID (UUID)
  得意先名 TEXT NOT NULL,
  ふりがな TEXT,
  弥生得意先コード TEXT,        -- カンマ区切りで複数可
  有効 INTEGER DEFAULT 0,       -- boolean: 1=true/0=false
  取引区分 TEXT,
  住所 TEXT,
  TEL TEXT,
  FAX TEXT,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_得意先マスタ_有効 ON 得意先マスタ(有効);
CREATE INDEX IF NOT EXISTS idx_得意先マスタ_弥生コード ON 得意先マスタ(弥生得意先コード);

CREATE TABLE IF NOT EXISTS 顧客情報DB (
  id TEXT PRIMARY KEY,
  顧客名 TEXT NOT NULL,
  ふりがな TEXT,
  住所 TEXT,
  TEL TEXT,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);

-- ─── 商品・車両マスタ ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS 商品マスタ (
  id TEXT PRIMARY KEY,
  商品コード TEXT,
  商品名 TEXT,
  タイヤサイズ TEXT,
  タイヤ銘柄 TEXT,
  メーカー TEXT,
  単価 REAL,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_商品マスタ_code ON 商品マスタ(商品コード);

CREATE TABLE IF NOT EXISTS 車両マスタ (
  id TEXT PRIMARY KEY,
  車番 TEXT,
  管理番号 TEXT,
  顧客ID TEXT,                  -- 得意先マスタ or 顧客情報DB の id
  車種 TEXT,
  仕様 TEXT,
  前輪サイズ TEXT,
  後輪サイズ TEXT,
  前輪パターン TEXT,
  後輪パターン TEXT,
  本数 INTEGER,
  カテゴリ TEXT,
  バルブ交換日 TEXT,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_車両マスタ_carNo ON 車両マスタ(車番);
CREATE INDEX IF NOT EXISTS idx_車両マスタ_mgmt ON 車両マスタ(管理番号);
CREATE INDEX IF NOT EXISTS idx_車両マスタ_顧客 ON 車両マスタ(顧客ID);

-- ─── 売上系 ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS 売上伝票 (
  id TEXT PRIMARY KEY,
  伝票タイトル TEXT,
  売上日 TEXT,                  -- YYYY-MM-DD
  請求先ID TEXT,                -- 得意先マスタ.id
  顧客名ID TEXT,                -- 顧客情報DB.id
  伝票種類 TEXT,                -- 納品書/見積書/請求書/納品書兼請求書
  作業区分 TEXT,                -- 来店/配達/引き取り/出張作業/その他
  担当者 TEXT,
  支払い方法 TEXT,
  宛先敬称 TEXT,
  車番 TEXT,                    -- カンマ区切り（複数車両）
  管理番号 TEXT,
  税抜合計 REAL DEFAULT 0,
  消費税合計 REAL DEFAULT 0,
  税込合計 REAL DEFAULT 0,
  ステータス TEXT,              -- 下書き/未請求/請求済/一部入金/入金済/キャンセル
  備考 TEXT,
  件名 TEXT,
  要確認 INTEGER DEFAULT 0,
  確認項目 TEXT,
  伝票番号 INTEGER,             -- 自動採番
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_売上伝票_date ON 売上伝票(売上日);
CREATE INDEX IF NOT EXISTS idx_売上伝票_bill ON 売上伝票(請求先ID);
CREATE INDEX IF NOT EXISTS idx_売上伝票_cust ON 売上伝票(顧客名ID);
CREATE INDEX IF NOT EXISTS idx_売上伝票_status ON 売上伝票(ステータス);
CREATE INDEX IF NOT EXISTS idx_売上伝票_car ON 売上伝票(車番);

CREATE TABLE IF NOT EXISTS 売上明細 (
  id TEXT PRIMARY KEY,
  売上伝票ID TEXT NOT NULL,
  明細タイトル TEXT,
  商品コード TEXT,
  品目 TEXT,
  タイヤサイズ TEXT,
  タイヤ銘柄 TEXT,
  数量 REAL DEFAULT 0,
  単位 TEXT,
  単価 REAL DEFAULT 0,
  税区分 TEXT,
  税額 REAL DEFAULT 0,
  税込小計 REAL DEFAULT 0,
  車番 TEXT,
  備考 TEXT,
  弥生備考 TEXT,
  created_time TEXT,
  last_edited_time TEXT,
  FOREIGN KEY (売上伝票ID) REFERENCES 売上伝票(id)
);
CREATE INDEX IF NOT EXISTS idx_売上明細_slip ON 売上明細(売上伝票ID);
CREATE INDEX IF NOT EXISTS idx_売上明細_code ON 売上明細(商品コード);
CREATE INDEX IF NOT EXISTS idx_売上明細_size ON 売上明細(タイヤサイズ);
CREATE INDEX IF NOT EXISTS idx_売上明細_brand ON 売上明細(タイヤ銘柄);
CREATE INDEX IF NOT EXISTS idx_売上明細_car ON 売上明細(車番);

-- ─── 仕入系 ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS 仕入先マスタ (
  id TEXT PRIMARY KEY,
  仕入先名 TEXT NOT NULL,
  仕入先コード TEXT,
  適格請求書事業者 INTEGER DEFAULT 0,
  登録番号 TEXT,
  TEL TEXT,
  住所 TEXT,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);

CREATE TABLE IF NOT EXISTS 仕入伝票 (
  id TEXT PRIMARY KEY,
  伝票タイトル TEXT,
  仕入日 TEXT,
  入荷日 TEXT,
  弥生伝票番号 TEXT,
  仕入先ID TEXT,
  担当者 TEXT,
  税抜合計 REAL DEFAULT 0,
  消費税合計 REAL DEFAULT 0,
  税込合計 REAL DEFAULT 0,
  仕入税額控除 TEXT,              -- 適格100%/経過措置80%/経過措置50%/控除不可
  ステータス TEXT,
  発注番号 TEXT,
  備考 TEXT,
  伝票番号 INTEGER,
  created_time TEXT,
  last_edited_time TEXT,
  FOREIGN KEY (仕入先ID) REFERENCES 仕入先マスタ(id)
);
CREATE INDEX IF NOT EXISTS idx_仕入伝票_date ON 仕入伝票(仕入日);
CREATE INDEX IF NOT EXISTS idx_仕入伝票_sup ON 仕入伝票(仕入先ID);
CREATE INDEX IF NOT EXISTS idx_仕入伝票_yno ON 仕入伝票(弥生伝票番号);

CREATE TABLE IF NOT EXISTS 仕入明細 (
  id TEXT PRIMARY KEY,
  仕入伝票ID TEXT NOT NULL,
  明細タイトル TEXT,
  商品コード TEXT,
  品名 TEXT,
  タイヤサイズ TEXT,
  銘柄 TEXT,
  メーカー TEXT,
  数量 REAL DEFAULT 0,
  単位 TEXT,
  単価 REAL DEFAULT 0,
  税込小計 REAL DEFAULT 0,
  税額 REAL DEFAULT 0,
  税区分 TEXT,
  備考 TEXT,
  created_time TEXT,
  last_edited_time TEXT,
  FOREIGN KEY (仕入伝票ID) REFERENCES 仕入伝票(id)
);
CREATE INDEX IF NOT EXISTS idx_仕入明細_slip ON 仕入明細(仕入伝票ID);
CREATE INDEX IF NOT EXISTS idx_仕入明細_maker ON 仕入明細(メーカー);
CREATE INDEX IF NOT EXISTS idx_仕入明細_size ON 仕入明細(タイヤサイズ);

-- ─── 勤怠・入金 ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS 勤怠管理 (
  id TEXT PRIMARY KEY,
  タイトル TEXT,
  社員名 TEXT,
  日付 TEXT,
  出勤 INTEGER,                   -- HHMM (例: 900 = 9:00)
  退勤 INTEGER,
  有給使用 INTEGER DEFAULT 0,
  有給使用時間 REAL,
  欠勤 INTEGER DEFAULT 0,
  労災扱い INTEGER DEFAULT 0,
  指定休 INTEGER DEFAULT 0,
  締め月手入力 TEXT,
  備考 TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_勤怠_staff_date ON 勤怠管理(社員名, 日付);
CREATE INDEX IF NOT EXISTS idx_勤怠_date ON 勤怠管理(日付);

CREATE TABLE IF NOT EXISTS 入金管理 (
  id TEXT PRIMARY KEY,
  入金日 TEXT,
  請求先ID TEXT,
  金額 REAL DEFAULT 0,
  入金方法 TEXT,
  備考 TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_入金_date ON 入金管理(入金日);

-- ─── 在庫・発注 ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS 在庫DB (
  id TEXT PRIMARY KEY,
  日付 TEXT,
  区分 TEXT,                       -- 入庫/繰越/出庫/準備/移動入庫/移動出庫/返品
  倉庫 TEXT,
  商品コード TEXT,
  サイズコード TEXT,
  パターン名 TEXT,
  カテゴリ TEXT,
  数量 INTEGER DEFAULT 0,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_在庫_date ON 在庫DB(日付);
CREATE INDEX IF NOT EXISTS idx_在庫_code ON 在庫DB(商品コード);

CREATE TABLE IF NOT EXISTS 発注管理 (
  id TEXT PRIMARY KEY,
  発注日 TEXT,
  納入予定日 TEXT,
  納入予定場所 TEXT,
  商品コード TEXT,
  サイズコード TEXT,
  パターン名 TEXT,
  数量 INTEGER DEFAULT 0,
  単価 REAL DEFAULT 0,
  発注先 TEXT,
  ステータス TEXT,
  備考 TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_発注_date ON 発注管理(発注日);
CREATE INDEX IF NOT EXISTS idx_発注_code ON 発注管理(商品コード);

-- ─── メタ情報 ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS migration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT,
  notion_records INTEGER,
  d1_records INTEGER,
  migrated_at TEXT,
  notes TEXT
);
