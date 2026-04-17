# foo-portal プロジェクト用 CLAUDE.md

（ユーザーグローバルの `~/.claude/CLAUDE.md` と併せて参照）

## 📌 セッション開始時

1. `git log --oneline -20` で直近の変更を確認
2. `git status` で作業中の未コミット変更を確認
3. Notion「💰 売上管理」と「📜 進捗ログ」を fetch して現状把握

## 🚨 重要ファイルの扱い（致命度順）

| ファイル | 致命度 | 注意点 |
|---|---|---|
| `tire-manager.html` | 🔴 致命 | JSエラーが1つでもあるとログイン不能。編集後は必ずブラウザで動作確認 |
| `order.html` | 🔴 致命 | 仮伝票/本伝票チェック機能あり（過去消失経歴）。編集時注意 |
| `foo-common.js` | 🔴 重要 | 全アプリが依存。API共通関数・DB統一マップ・ログイン |
| `index.html` | 🟡 注意 | APP_DEFS で全30アプリ管理。新規追加時は忘れず更新 |
| `auto-order.html` | 🟡 注意 | SNAPSHOT_DB(しきい値) と在庫DB連携。プロパティ型を間違えやすい |

## 🗂️ リポジトリ構成

```
foo-portal/
├── *.html              # 30アプリ
├── foo-common.js       # 共通関数・DB統一マップ
├── foo-swipe.js        # iOSスワイプバック
├── manifest.json       # PWA設定
├── scripts/
│   └── sales-migration/  # 弥生→Notion移行スクリプト
└── .github/
    ├── scripts/        # ニュース自動配信（API課金ゼロ化で一部停止中）
    └── workflows/
```

## 🧪 動作確認

- HTML/JSに構文チェックはないので、**必ずブラウザで開いて確認**
- PWA キャッシュが古いと変更が反映されない→ 🔄 ボタンで強制更新
- レート制限対策: Notion API連続叩く時は並列3〜5、間隔300ms以上

## 📝 コミット後の必須フロー

```bash
git add <特定ファイル>
git commit -m "..."
git push  # push は自動（毎回確認しない）
```
→ その後、**必ず Notion「進捗ログ」に変更内容を記録**する。

## 🔧 移行スクリプト運用

`scripts/sales-migration/` の主要スクリプト:

- `migrate-sales.mjs`: 弥生Excel→Notion売上伝票DB 新規移行
  - `--file` で対象Excel、`--only <伝票番号,...>` でリトライ、`--target-year`/`--target-month` で年バンドルフィルタ
- `_verify-month.mjs --year YYYY --month M`: 月別の弥生 vs Notion 照合
- `_find-missing-slips.mjs`: 欠落伝票特定
- `_fix-all-missing-2024-12.mjs`: 特定月の不足明細一括補填（参考実装）
- `_dedupe-slip-details.mjs`: 重複明細削除
- `_fix-slip-totals.mjs`: 伝票税抜合計を弥生の正値で上書き
- `_phase-d-final.mjs`: 36ヶ月統合レポート
- `_probe-*.mjs`: DBスキーマ調査
