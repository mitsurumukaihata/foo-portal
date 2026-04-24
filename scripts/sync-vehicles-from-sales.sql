-- ============================================================
-- 売上明細の全車番 → 車両マスタに自動登録するメンテナンススクリプト
-- ============================================================
-- 使い方: D1 Admin から手動で流すか、月次のcronで実行する
-- 冪等: 未登録の車番だけを INSERT するので何度流しても安全
-- 2026/4/25 向畑 充 作成
-- ============================================================

-- 1. 未登録車番を自動登録
INSERT INTO 車両マスタ (id, 車番, 顧客ID, 前輪サイズ, 前輪パターン, メモ, created_time, last_edited_time)
SELECT
  'auto' || lower(hex(randomblob(12))) AS id,
  d.車番,
  -- 顧客ID = 最新売上伝票の請求先
  (SELECT s.請求先ID FROM 売上明細 d2 JOIN 売上伝票 s ON d2.売上伝票ID = s.id
   WHERE d2.車番 = d.車番 AND s.請求先ID IS NOT NULL
   ORDER BY s.売上日 DESC LIMIT 1) AS 顧客ID,
  -- 前輪サイズ = 最新売上明細のタイヤサイズ
  (SELECT d3.タイヤサイズ FROM 売上明細 d3 JOIN 売上伝票 s ON d3.売上伝票ID = s.id
   WHERE d3.車番 = d.車番 AND d3.タイヤサイズ IS NOT NULL AND d3.タイヤサイズ != ''
   ORDER BY s.売上日 DESC LIMIT 1) AS 前輪サイズ,
  -- 前輪パターン = サービス行(脱着/組替等)を除いた最新タイヤ銘柄
  (SELECT d4.タイヤ銘柄 FROM 売上明細 d4 JOIN 売上伝票 s ON d4.売上伝票ID = s.id
   WHERE d4.車番 = d.車番 AND d4.タイヤ銘柄 IS NOT NULL AND d4.タイヤ銘柄 != ''
     AND d4.明細タイトル NOT LIKE '%脱着%' AND d4.明細タイトル NOT LIKE '%組替%'
     AND d4.明細タイトル NOT LIKE '%バランス%' AND d4.明細タイトル NOT LIKE '%出張%'
     AND d4.明細タイトル NOT LIKE '%エア調整%' AND d4.明細タイトル NOT LIKE '%廃タイヤ%'
   ORDER BY s.売上日 DESC LIMIT 1) AS 前輪パターン,
  -- メモに自動登録日と最新請求先(元請け)を記載
  '自動登録 (' || date('now') || ') - 売上明細から逆引き' || char(10)
    || '元請け: ' || COALESCE((SELECT c.得意先名 FROM 売上明細 d5 JOIN 売上伝票 s ON d5.売上伝票ID = s.id
         JOIN 得意先マスタ c ON s.請求先ID = c.id
         WHERE d5.車番 = d.車番 ORDER BY s.売上日 DESC LIMIT 1), '不明') AS メモ,
  datetime('now') AS created_time,
  datetime('now') AS last_edited_time
FROM (
  SELECT DISTINCT 車番 FROM 売上明細
  WHERE 車番 IS NOT NULL AND 車番 != ''
    AND 車番 NOT IN (SELECT 車番 FROM 車両マスタ WHERE 車番 IS NOT NULL)
) d;

-- 2. 既存車両のサイズを実装着明細(タイヤ販売/組替/交換)の最頻値から補完
--    脱着/バランス/エア調整のみの車両はサイズ不確定なのでNULLで『⚠要確認』タグ付与
UPDATE 車両マスタ SET 前輪サイズ = NULL,
  メモ = CASE WHEN メモ LIKE '%サイズ要確認%' THEN メモ
              ELSE COALESCE(メモ,'') || char(10) || '⚠ サイズ要確認: 売上明細が脱着/サービスのみで実装着サイズ不明' END
WHERE 前輪サイズ IS NOT NULL
  AND EXISTS (SELECT 1 FROM 売上明細 d WHERE d.車番 = 車両マスタ.車番)
  AND NOT EXISTS (SELECT 1 FROM 売上明細 d WHERE d.車番 = 車両マスタ.車番
    AND (d.明細タイトル LIKE '%タイヤ販売%' OR d.明細タイトル LIKE '%組替%' OR d.明細タイトル LIKE '%交換%'));

UPDATE 車両マスタ SET 前輪サイズ = (
  SELECT d.タイヤサイズ FROM 売上明細 d
  WHERE d.車番 = 車両マスタ.車番 AND d.タイヤサイズ IS NOT NULL AND d.タイヤサイズ != ''
    AND (d.明細タイトル LIKE '%タイヤ販売%' OR d.明細タイトル LIKE '%組替%' OR d.明細タイトル LIKE '%交換%')
  GROUP BY d.タイヤサイズ ORDER BY COUNT(*) DESC LIMIT 1
) WHERE (前輪サイズ IS NULL OR 前輪サイズ = '')
  AND EXISTS (SELECT 1 FROM 売上明細 d WHERE d.車番 = 車両マスタ.車番
    AND (d.明細タイトル LIKE '%タイヤ販売%' OR d.明細タイトル LIKE '%組替%' OR d.明細タイトル LIKE '%交換%')
    AND d.タイヤサイズ IS NOT NULL AND d.タイヤサイズ != '');

UPDATE 車両マスタ SET 前輪パターン = (
  SELECT d.タイヤ銘柄 FROM 売上明細 d JOIN 売上伝票 s ON d.売上伝票ID = s.id
  WHERE d.車番 = 車両マスタ.車番 AND d.タイヤ銘柄 IS NOT NULL AND d.タイヤ銘柄 != ''
    AND d.明細タイトル NOT LIKE '%脱着%' AND d.明細タイトル NOT LIKE '%組替%'
    AND d.明細タイトル NOT LIKE '%バランス%' AND d.明細タイトル NOT LIKE '%出張%'
    AND d.明細タイトル NOT LIKE '%エア調整%' AND d.明細タイトル NOT LIKE '%廃タイヤ%'
  ORDER BY s.売上日 DESC LIMIT 1
) WHERE (前輪パターン IS NULL OR 前輪パターン = '')
  AND EXISTS (SELECT 1 FROM 売上明細 d WHERE d.車番 = 車両マスタ.車番 AND d.タイヤ銘柄 IS NOT NULL AND d.タイヤ銘柄 != '');

-- 3. メモに元請けが無い車両を売上明細(メーカー請求先)から補完
UPDATE 車両マスタ SET メモ = COALESCE(メモ,'') || char(10) || '元請け: '
  || (SELECT c.得意先名 FROM 売上明細 d JOIN 売上伝票 s ON d.売上伝票ID = s.id
      JOIN 得意先マスタ c ON s.請求先ID = c.id
      WHERE d.車番 = 車両マスタ.車番
        AND (c.得意先名 LIKE '%ﾄｰﾖｰ%' OR c.得意先名 LIKE '%トーヨー%'
             OR c.得意先名 LIKE '%ブリヂストン%' OR c.得意先名 LIKE '%ダンロップ%'
             OR c.得意先名 LIKE '%DUNLOP%' OR c.得意先名 LIKE '%三菱ふそう%'
             OR c.得意先名 LIKE '%いすゞ%' OR c.得意先名 LIKE '%いすず%')
      ORDER BY s.売上日 DESC LIMIT 1)
WHERE (メモ IS NULL OR メモ NOT LIKE '%元請け%')
  AND EXISTS (SELECT 1 FROM 売上明細 d JOIN 売上伝票 s ON d.売上伝票ID = s.id
    JOIN 得意先マスタ c ON s.請求先ID = c.id
    WHERE d.車番 = 車両マスタ.車番
      AND (c.得意先名 LIKE '%ﾄｰﾖｰ%' OR c.得意先名 LIKE '%トーヨー%'
           OR c.得意先名 LIKE '%ブリヂストン%' OR c.得意先名 LIKE '%ダンロップ%'
           OR c.得意先名 LIKE '%DUNLOP%' OR c.得意先名 LIKE '%三菱ふそう%'
           OR c.得意先名 LIKE '%いすゞ%' OR c.得意先名 LIKE '%いすず%'));
