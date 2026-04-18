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

## モデル名の注意
- `claude-3-5-haiku-latest` は2026年時点で404を返すので使用不可
- 現在は `claude-haiku-4-5` を使用（自動で最新のHaiku 4.5系）
- 将来モデル変更時は24行目の `model: "claude-haiku-4-5"` を書き換え

## 履歴
- 2026/04/18: `claude-3-5-haiku-latest` → `claude-haiku-4-5` に変更（404対策）
