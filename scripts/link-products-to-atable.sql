-- ============================================================
-- 商品マスタ ↔ A表 リンク: A表定価を商品マスタに同期
-- マッチング: (タイヤサイズ, タイヤ銘柄) ≈ (A表.サイズ, A表.パターン)
--
-- 実行: npx wrangler d1 execute foo-portal-db --remote --file=../scripts/link-products-to-atable.sql
--   cwd: cloudflare-worker/
-- ============================================================

-- 1. 商品マスタ に A表定価カラムを追加 (冪等)
ALTER TABLE 商品マスタ ADD COLUMN A表定価 INTEGER;
-- 既に存在する場合はエラーになるが無視OK

-- 2. A表定価を同期 (完全一致 優先)
UPDATE 商品マスタ
SET A表定価 = (
  SELECT a.価格 FROM A表 a
  WHERE a.サイズ = 商品マスタ.タイヤサイズ
    AND a.パターン = 商品マスタ.タイヤ銘柄
    AND (a.旧モデル IS NULL OR a.旧モデル = 0)
  ORDER BY a.価格 DESC
  LIMIT 1
)
WHERE タイヤサイズ IS NOT NULL AND タイヤ銘柄 IS NOT NULL;

-- 3. 部分一致 (パターンにスラッシュ区切りあるため)
UPDATE 商品マスタ
SET A表定価 = (
  SELECT a.価格 FROM A表 a
  WHERE a.サイズ = 商品マスタ.タイヤサイズ
    AND (a.旧モデル IS NULL OR a.旧モデル = 0)
    AND (
      a.パターン LIKE '%' || 商品マスタ.タイヤ銘柄 || '%'
      OR 商品マスタ.タイヤ銘柄 LIKE '%' || a.パターン || '%'
    )
  ORDER BY a.価格 DESC
  LIMIT 1
)
WHERE A表定価 IS NULL
  AND タイヤサイズ IS NOT NULL AND タイヤ銘柄 IS NOT NULL;

-- 確認
SELECT
  COUNT(*) AS 商品マスタ総数,
  SUM(CASE WHEN A表定価 IS NOT NULL THEN 1 ELSE 0 END) AS A表紐付け済,
  SUM(CASE WHEN A表定価 IS NULL AND タイヤサイズ IS NOT NULL THEN 1 ELSE 0 END) AS 未紐付け
FROM 商品マスタ;
