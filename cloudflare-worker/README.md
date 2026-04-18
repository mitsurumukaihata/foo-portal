# Cloudflare Worker: notion-proxy

このディレクトリは **Cloudflare Worker `notion-proxy`** のソースコード保管場所。

## デプロイURL
https://notion-proxy.33322666666mm.workers.dev

## 主要エンドポイント
| Path | 用途 |
|---|---|
| `/databases/{id}/query` | Notion DB検索のプロキシ |
| `/pages` POST | Notionページ作成 |
| `/pages/{id}` PATCH | Notionページ更新 |
| `/blocks/{id}/children` | Notionブロック操作 |
| `/ai/summarize` | Claude API 会議要約 |
| `/ai/transcribe` | Groq Whisper 音声文字起こし |
| `/welfare/*` | 福利厚生アプリ |
| `/pdf-proxy` | PDF取得用 |

## 必要なSecrets（Cloudflare側に登録）
- `NOTION_TOKEN`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`

## デプロイ方法（手動）
1. Cloudflareダッシュボード → Workers & Pages → notion-proxy
2. Edit Code → 全選択 (Ctrl+A) → Delete → `worker.js` の内容を貼り付け
3. Deploy

## モデル名の運用ルール

### 現在の使用モデル
- **`claude-sonnet-4-6`**（Sonnet 4.6、2026/2/17リリース、$3/$15 per MTok、1M context）
- 24行目の `model:` の値
- コスト目安: 30分会議1回あたり約6円、月100回で約600円

### 固定バージョン指定の方針
弊社では **バージョン固定** で運用する（`latest` や エイリアス（`sonnet` 単体）は使わない）。

**理由**:
- 出力フォーマットの一貫性を保証（アクション抽出の形が勝手に変わらない）
- 新モデルの挙動変化でアプリが突然壊れるリスク回避
- Git履歴にモデル変更の記録が残る

### モデル変更のタイミング
以下のどれかに該当したら検討:
- ✅ 現行モデルが deprecated（非推奨）になった
- ✅ 新モデルで精度が明確に上がる報告がある
- ✅ コスト削減になる（同等以上の精度で安い）
- ✅ 年に1回くらいの定期見直し

### モデル変更の手順
1. `cloudflare-worker/worker.js` の24行目の `model:` を新しい値に書き換え
2. `README.md` の「現在の使用モデル」セクションと「履歴」を更新
3. Git コミット & push
4. Cloudflareダッシュボードで Raw コピペ → Deploy
5. テスト要求を送って動作確認

### 参考: 2026年4月時点の主要モデル文字列
| モデル | API文字列 | $/MTok 入力 | $/MTok 出力 |
|---|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 |
| **Sonnet 4.6** ← 現行 | `claude-sonnet-4-6` | $3 | $15 |
| Opus 4.6 | `claude-opus-4-6` | $15 | $75 |
| Opus 4.7 | `claude-opus-4-7` | $5 | $25 |

### 使ってはいけない形式
- ❌ `claude-3-5-haiku-latest`（`-latest` サフィックスは2026年時点で404を返すケースあり）
- ❌ `sonnet` / `haiku`（エイリアス。自動追随するが挙動変化リスク）
- ❌ `claude-3-haiku-20240307`（2026/4/19退役予定）

## 履歴
- 2026/04/18 ①: `claude-3-5-haiku-latest` → `claude-haiku-4-5` に変更（404対策）
- 2026/04/18 ②: `claude-haiku-4-5` → `claude-sonnet-4-6` に変更（精度優先で統一）
