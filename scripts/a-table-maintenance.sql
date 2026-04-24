-- ============================================================
-- A表 関連メンテナンスSQL (集約版)
-- 実行: npx wrangler d1 execute foo-portal-db --remote --file=../scripts/a-table-maintenance.sql
-- cwd: cloudflare-worker/
-- ============================================================

-- ------------------------------------------------------------
-- 1. A表 テーブル (BRIDGESTONE業界価格表)
--    import-bs-a-table-excel.mjs で取り込み
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS A表 (
  id TEXT PRIMARY KEY,
  カテゴリ TEXT,        -- PC / LTS / バン
  ブランド TEXT,        -- POTENZA, REGNO, ECOPIA, NEWNO, SEIBERLING, DUELER, ...
  パターン TEXT,        -- GRⅢ, NH200, SL, etc.
  サイズ TEXT,          -- 195/65R15 形式
  加重指数 TEXT,        -- 91H etc.
  マーク TEXT,          -- ★ ② ▼ * □ ■ 等
  価格 INTEGER,         -- 定価 (税抜)
  商品コード TEXT,      -- 弥生商品コード 8桁
  商品名称 TEXT,
  グループ TEXT,        -- PSR0/PSR1/LTS0/LVR0 etc.
  旧モデル INTEGER,     -- 1=旧モデル (A表掲載外)
  notion_url TEXT,
  created_time TEXT,
  last_edited_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_a表_サイズ ON A表(サイズ);
CREATE INDEX IF NOT EXISTS idx_a表_カテゴリ ON A表(カテゴリ);
CREATE INDEX IF NOT EXISTS idx_a表_ブランド ON A表(ブランド);
CREATE INDEX IF NOT EXISTS idx_a表_パターン ON A表(パターン);

-- ------------------------------------------------------------
-- 2. サイズマスタ (A表から派生、車種判定の根拠)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS サイズマスタ (
  サイズ TEXT PRIMARY KEY,
  カテゴリ TEXT,        -- PC / LTS / バン
  件数 INTEGER
);

-- 再構築 (A表から集計)
DELETE FROM サイズマスタ;
INSERT INTO サイズマスタ (サイズ, カテゴリ, 件数)
SELECT サイズ,
  -- 同じサイズで複数カテゴリあれば優先: PC > LTS > バン
  (SELECT カテゴリ FROM A表 a2 WHERE a2.サイズ = a.サイズ
   ORDER BY CASE カテゴリ WHEN 'PC' THEN 1 WHEN 'LTS' THEN 2 WHEN 'バン' THEN 3 ELSE 4 END LIMIT 1) AS cat,
  COUNT(*) AS cnt
FROM A表 a
WHERE サイズ IS NOT NULL AND サイズ != ''
GROUP BY サイズ;

-- ------------------------------------------------------------
-- 3. 要確認サイズ (異常値検出)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS 要確認サイズ (
  サイズ TEXT PRIMARY KEY,
  件数 INTEGER,
  理由 TEXT
);

DELETE FROM 要確認サイズ;
INSERT INTO 要確認サイズ (サイズ, 件数, 理由)
SELECT サイズ, COUNT(*), '売上明細にあるがサイズマスタ未登録 (要確認)'
FROM 売上明細
WHERE サイズ IS NOT NULL AND サイズ != ''
  AND サイズ NOT IN (SELECT サイズ FROM サイズマスタ)
GROUP BY サイズ
HAVING COUNT(*) >= 1
ORDER BY COUNT(*) DESC;

-- ------------------------------------------------------------
-- 4. 不整合車両 (車種 vs サイズカテゴリ不一致)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS 不整合車両 (
  車番 TEXT PRIMARY KEY,
  車種 TEXT,
  サイズ TEXT,
  想定カテゴリ TEXT,
  備考 TEXT
);

DELETE FROM 不整合車両;
INSERT INTO 不整合車両 (車番, 車種, サイズ, 想定カテゴリ, 備考)
SELECT v.車番, v.車種, v.前輪サイズ, m.カテゴリ,
  '車種=' || COALESCE(v.車種,'?') || ' / サイズカテゴリ=' || m.カテゴリ
FROM 車両マスタ v
JOIN サイズマスタ m ON v.前輪サイズ = m.サイズ
WHERE v.車番 IS NOT NULL
  AND v.車番 NOT LIKE '%(旧%'
  AND v.前輪サイズ IS NOT NULL
  AND (
    (v.車種 = '乗用車' AND m.カテゴリ != 'PC') OR
    (v.車種 = 'バン' AND m.カテゴリ != 'バン') OR
    (v.車種 IN ('小型トラック','中型トラック','大型トラック') AND m.カテゴリ != 'LTS')
  );

-- ------------------------------------------------------------
-- 5. 表記ゆれ正規化
-- ------------------------------------------------------------
UPDATE A表 SET ブランド='SEIBERLING' WHERE ブランド='SEIBER LING';

-- ------------------------------------------------------------
-- 確認用 SELECT
-- ------------------------------------------------------------
SELECT 'A表' AS テーブル, COUNT(*) AS 件数 FROM A表
UNION ALL SELECT 'サイズマスタ', COUNT(*) FROM サイズマスタ
UNION ALL SELECT '要確認サイズ', COUNT(*) FROM 要確認サイズ
UNION ALL SELECT '不整合車両', COUNT(*) FROM 不整合車両;
