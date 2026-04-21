# 弥生 → Notion 売上データ移行スクリプト

## 概要
弥生会計の日付別売上明細表（.xlsx）を Notion の売上伝票DB・売上明細DBに投入するスクリプト群。

## ファイル
| ファイル | 用途 |
|---|---|
| `migrate-sales.mjs` | メインの移行スクリプト |
| `report.mjs` | 月次集計レポート（弥生との照合） |
| `verify.mjs` | 投入データの構造確認（最新3伝票） |
| `sync-customers.mjs` | 顧客マスタの弥生得意先コード同期（初回のみ） |
| `delete-latest.mjs` | テスト後の後始末（最新3伝票を削除） |

## 月次移行フロー

### 1. 準備
弥生から「日付別売上明細表」を Excel でエクスポートして以下に置く:
```
C:\Users\Mitsuru Mukaihata\Desktop\売上明細\売上明細　YYYY.M.xlsx
```

### 2. DRY RUN（集計確認）
```bash
cd C:\Users\Mitsuru Mukaihata\Desktop\foo-portal
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　YYYY.M.xlsx" --dryrun
```

### 3. テストインポート (3伝票)
```bash
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　YYYY.M.xlsx" --limit 3
node scripts/sales-migration/verify.mjs   # 結果確認
node scripts/sales-migration/delete-latest.mjs  # 問題なければ削除
```

### 4. 本番移行（全件）
```bash
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　YYYY.M.xlsx" > _migrate-log.txt 2>&1 &
```
所要時間: 約 45-60 分（352伝票の場合）

### 5. 集計レポート
```bash
node scripts/sales-migration/report.mjs
```
弥生の金額合計との差額チェック。

## 注意事項
- Notion API のレート制限: 3 req/sec → sleep 350ms で制御
- 内税/外税の混在: 弥生の「税転嫁」列で判定して正しく計算
- 顧客マップ: 弥生得意先コード ↔ Notion `弥生得意先コード` プロパティで紐付け
- 新規顧客が出てきた場合: `sync-customers.mjs` を編集して追加実行

## 仕様
- **品目マッピング**: コードと商品名から自動判定（LK/LKL/TK/PK/OR/FOO等）
- **タイヤサイズ/銘柄**: 商品名から正規表現で抽出
- **車番**: 備考欄から `広島100わ45-12` 形式を抽出
- **担当者**: 弥生の担当者名をそのままNotion selectに（全角スペース含む）
- **作業区分**: 明細に「出張」があれば出張作業、なければ来店
- **税額**: 内税伝票は金額 ÷ (1 + 税率) で税抜逆算、外税は金額 × 税率

## 既知の制限
- 担当者が弥生で空欄の伝票はNotionでも空欄（作業報告書連動で将来解消）
- 同名会社の複数コード（例: BRIDGESTONE 103 と 1031）は別レコード
- 内税逆算で数円～数十円の差額が出る（許容範囲）
