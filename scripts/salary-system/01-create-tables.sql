-- ============================================================
-- 給与システム D1 テーブル作成 (Phase 1)
-- 実行: cd cloudflare-worker && npx wrangler d1 execute foo-portal-db --remote --file=../scripts/salary-system/01-create-tables.sql
-- ============================================================

-- 1. 社員マスタ (Notionから同期)
-- Notion 社員マスタ(タイヤアプリ) `08c5405729794337886b3565352ef96a` をD1に複製
CREATE TABLE IF NOT EXISTS 社員マスタ (
  id TEXT PRIMARY KEY,                  -- Notion page ID
  氏名 TEXT NOT NULL,
  在籍 TEXT,                             -- '在籍中' / '退職'
  権限 TEXT,                             -- '管理者' / '一般'
  アプリグループ TEXT,                    -- '管理者' / '事務' / '一般' / '経理' / '部長' / 'リーダー' / 'SNS/オークション' / '会長'
  メールアドレス TEXT,
  給与体系 TEXT,                         -- '月給' / '時給'
  基本給 INTEGER,                        -- 月給制の月額
  時給 INTEGER,                          -- 時給制の時給
  通勤手当 INTEGER,                      -- 月額
  住民税月額 INTEGER,
  健康保険月額 INTEGER,
  厚生年金月額 INTEGER,
  扶養人数 INTEGER DEFAULT 0,
  所定労働日数 INTEGER,                  -- 月の所定労働日数 (例: 21)
  所定労働時間 INTEGER,                  -- 月の所定労働時間 (例: 168)
  表示順 INTEGER,
  PIN TEXT,
  メモ TEXT,
  最終ログイン TEXT,
  created_time TEXT,
  last_edited_time TEXT
);

CREATE INDEX IF NOT EXISTS idx_社員_在籍 ON 社員マスタ(在籍);
CREATE INDEX IF NOT EXISTS idx_社員_氏名 ON 社員マスタ(氏名);

-- 2. 給与マスタ (社員別×適用年月の給与計算ベース値)
-- 例: 2026年4月から時給を変えた、2026年6月から住民税が変わった等を時系列で記録
CREATE TABLE IF NOT EXISTS 給与マスタ (
  社員ID TEXT NOT NULL,
  適用年月 TEXT NOT NULL,                -- "2026-04" 形式 (この年月から有効)
  給与体系 TEXT,                         -- '月給' / '時給'
  基本給 INTEGER,
  時給 INTEGER,
  役職手当 INTEGER DEFAULT 0,
  通勤手当 INTEGER DEFAULT 0,
  資格手当 INTEGER DEFAULT 0,
  その他手当 INTEGER DEFAULT 0,
  健康保険料 INTEGER DEFAULT 0,
  厚生年金 INTEGER DEFAULT 0,
  介護保険料 INTEGER DEFAULT 0,          -- 40歳以上のみ
  雇用保険料率 REAL DEFAULT 0.006,      -- 0.006 = 0.6%
  住民税月額 INTEGER DEFAULT 0,
  扶養人数 INTEGER DEFAULT 0,
  メモ TEXT,
  更新者 TEXT,
  created_time TEXT,
  last_edited_time TEXT,
  PRIMARY KEY (社員ID, 適用年月)
);

CREATE INDEX IF NOT EXISTS idx_給与マスタ_適用年月 ON 給与マスタ(適用年月);

-- 3. 給与明細 (確定済み or 下書き)
CREATE TABLE IF NOT EXISTS 給与明細 (
  id TEXT PRIMARY KEY,                  -- UUID
  社員ID TEXT NOT NULL,
  社員氏名 TEXT,                         -- 履歴用にスナップショット
  支給年月 TEXT NOT NULL,                -- "2026-04"
  対象期間_開始 TEXT,                    -- 勤怠締め開始日
  対象期間_終了 TEXT,
  -- 支給
  基本給 INTEGER DEFAULT 0,
  残業手当 INTEGER DEFAULT 0,
  休日出勤手当 INTEGER DEFAULT 0,
  深夜手当 INTEGER DEFAULT 0,
  通勤手当 INTEGER DEFAULT 0,
  役職手当 INTEGER DEFAULT 0,
  資格手当 INTEGER DEFAULT 0,
  その他手当 INTEGER DEFAULT 0,
  支給合計 INTEGER DEFAULT 0,
  -- 控除
  健康保険料 INTEGER DEFAULT 0,
  厚生年金 INTEGER DEFAULT 0,
  介護保険料 INTEGER DEFAULT 0,
  雇用保険料 INTEGER DEFAULT 0,
  所得税 INTEGER DEFAULT 0,
  住民税 INTEGER DEFAULT 0,
  その他控除 INTEGER DEFAULT 0,
  控除合計 INTEGER DEFAULT 0,
  -- 集計
  差引支給額 INTEGER DEFAULT 0,
  -- 勤怠サマリ (履歴用にスナップショット)
  出勤日数 INTEGER DEFAULT 0,
  出勤時間 REAL DEFAULT 0,
  残業時間 REAL DEFAULT 0,
  有給日数 REAL DEFAULT 0,
  欠勤日数 INTEGER DEFAULT 0,
  -- 状態管理
  ステータス TEXT DEFAULT '下書き',      -- '下書き' / '承認待ち' / '確定' / '公開' / '差し戻し'
  作成者 TEXT,
  代表承認日 TEXT,
  公開日 TEXT,
  PDF_URL TEXT,                          -- R2ストレージのキー
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);

CREATE INDEX IF NOT EXISTS idx_給与明細_社員 ON 給与明細(社員ID);
CREATE INDEX IF NOT EXISTS idx_給与明細_年月 ON 給与明細(支給年月);
CREATE INDEX IF NOT EXISTS idx_給与明細_状態 ON 給与明細(ステータス);
CREATE UNIQUE INDEX IF NOT EXISTS idx_給与明細_uniq ON 給与明細(社員ID, 支給年月);

-- 4. 賞与明細
CREATE TABLE IF NOT EXISTS 賞与明細 (
  id TEXT PRIMARY KEY,
  社員ID TEXT NOT NULL,
  社員氏名 TEXT,
  支給年月 TEXT NOT NULL,                -- "2026-07" 形式
  賞与種別 TEXT,                         -- '夏季賞与' / '冬季賞与' / '決算賞与' / 'その他'
  -- 算定基礎
  基本給 INTEGER,
  支給月数 REAL,                         -- 1.5ヶ月 等
  -- 支給
  賞与額 INTEGER,                        -- 計算済み or 手入力
  業績加算 INTEGER DEFAULT 0,
  特別加算 INTEGER DEFAULT 0,
  支給合計 INTEGER DEFAULT 0,
  -- 控除 (賞与専用税率)
  健康保険料 INTEGER DEFAULT 0,
  厚生年金 INTEGER DEFAULT 0,
  介護保険料 INTEGER DEFAULT 0,
  雇用保険料 INTEGER DEFAULT 0,
  所得税 INTEGER DEFAULT 0,              -- 賞与専用源泉税率表
  控除合計 INTEGER DEFAULT 0,
  -- 集計
  差引支給額 INTEGER DEFAULT 0,
  ステータス TEXT DEFAULT '下書き',
  作成者 TEXT,
  代表承認日 TEXT,
  公開日 TEXT,
  PDF_URL TEXT,
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);

CREATE INDEX IF NOT EXISTS idx_賞与_社員 ON 賞与明細(社員ID);
CREATE INDEX IF NOT EXISTS idx_賞与_年月 ON 賞与明細(支給年月);

-- 5. 経理チケット (経費精算・立替・小口現金・法人カード等を統合管理)
CREATE TABLE IF NOT EXISTS 経理チケット (
  id TEXT PRIMARY KEY,
  種別 TEXT NOT NULL,                    -- '立替精算' / '小口現金' / '法人カード' / '社内経費メモ' / 'その他'
  日付 TEXT NOT NULL,
  申請者 TEXT,                           -- 社員氏名
  申請者ID TEXT,                         -- 社員ID
  金額 INTEGER NOT NULL,
  科目 TEXT,                             -- '消耗品費' / '通信費' / '会議費' / '交通費' 等
  内容 TEXT,                             -- 説明
  支払先 TEXT,                           -- 取引先・店舗名
  領収書_URL TEXT,                       -- R2ストレージ画像
  ステータス TEXT DEFAULT '申請中',       -- '申請中' / '承認' / '振込予定' / '完了' / '却下'
  承認者 TEXT,
  承認日 TEXT,
  振込予定日 TEXT,
  振込実行日 TEXT,
  弥生連携済 INTEGER DEFAULT 0,          -- 0/1
  メモ TEXT,
  created_time TEXT,
  last_edited_time TEXT
);

CREATE INDEX IF NOT EXISTS idx_経理_種別 ON 経理チケット(種別);
CREATE INDEX IF NOT EXISTS idx_経理_日付 ON 経理チケット(日付);
CREATE INDEX IF NOT EXISTS idx_経理_状態 ON 経理チケット(ステータス);

-- 確認用
SELECT '社員マスタ' AS テーブル, COUNT(*) AS 件数 FROM 社員マスタ
UNION ALL SELECT '給与マスタ', COUNT(*) FROM 給与マスタ
UNION ALL SELECT '給与明細', COUNT(*) FROM 給与明細
UNION ALL SELECT '賞与明細', COUNT(*) FROM 賞与明細
UNION ALL SELECT '経理チケット', COUNT(*) FROM 経理チケット;
