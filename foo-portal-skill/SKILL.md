---
name: foo-portal
description: |
  (有)タイヤマネージャーフーの社内ポータル「f.o.o portal」の開発・保守スキル。
  GitHub Pages上の静的HTMLアプリ群（タイヤ入出庫、出勤簿、資金繰り、タスク管理など）を
  Notion APIと連携して管理する。このスキルは以下の場面で必ず使用すること：
  - ポータルのアプリ追加・修正・バグ修正
  - Notion DBとの連携コード作成
  - index.htmlのAPP_DEFS変更やアクセス制御の設定
  - 「ポータル」「アプリ」「Notion」「タイヤアプリ」「foo-portal」に関する作業全般
  - GitHubへのプッシュが伴う作業
---

# f.o.o Portal 開発スキル

## 概要

(有)タイヤマネージャーフーの社内業務ポータル。トラックタイヤの販売・交換業の日常業務を
スマホ中心のWebアプリで支えている。全アプリはGitHub Pages上の静的HTML（SPA）で、
バックエンドはNotion DB + Cloudflare Worker Proxy。

## Gitリポジトリ

- **リポジトリ**: `mitsurumukaihata/foo-portal`
- **ホスティング**: GitHub Pages（mainブランチ直接配信）
- **ローカルクローン先**: 作業ディレクトリ配下に `foo-portal-push/` として clone
- **認証**: リモートURLにPATトークンが埋め込み済み

### Git操作の流れ

```bash
# 1. 最新を取得（作業開始時に必ず実行）
cd foo-portal-push && git pull origin main

# 2. ファイルを編集

# 3. コミット＆プッシュ
git add <ファイル名>
git commit -m "コミットメッセージ

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin main
```

プッシュ後、GitHub Pagesのデプロイに1〜2分かかる。ユーザーには「デプロイ完了したら再読み込みしてください」と伝える。

## アーキテクチャ

### Notion API Proxy

全アプリは直接Notion APIを叩かず、Cloudflare Worker経由でアクセスする。

```
PROXY URL: https://notion-proxy.33322666666mm.workers.dev
```

**重要: Worker ProxyがNotion APIの `/v1/` プレフィックスを自動付与する。**
アプリ側のパスには `/v1/` を含めない。

```javascript
// ✅ 正しい
notionAPI('POST', `/databases/${DB_ID}/query`, body)
notionAPI('PATCH', `/pages/${pageId}`, { properties: {...} })
notionAPI('POST', '/pages', { parent: { database_id: DB_ID }, properties: {...} })

// ❌ 間違い（/v1/v1/ になってエラー）
notionAPI('POST', `/v1/databases/${DB_ID}/query`, body)
```

### notionAPI関数の標準パターン

新しいアプリを作る際は、既存アプリ（cashflow.html等）と同じパターンを使う。

```javascript
const PROXY = 'https://notion-proxy.33322666666mm.workers.dev';

async function notionAPI(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(PROXY + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data.object === 'error') throw new Error(data.message);
    return data;
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('タイムアウト');
    throw new Error('通信エラー: ' + e.message);
  }
}

// ページネーション付き全件取得
async function queryAll(dbId, body) {
  let all = [], cursor = null;
  while (true) {
    const b = { ...body, page_size: 100 };
    if (cursor) b.start_cursor = cursor;
    const res = await notionAPI('POST', `/databases/${dbId}/query`, b);
    all = all.concat(res.results || []);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return all;
}
```

### Notion DB ID の注意点

Notionには「データベースページID」と「コレクションID（collection://...）」の2種類がある。
**Notion REST APIで使えるのはデータベースページIDのみ。**

コレクションIDをAPIに渡すと `Could not find database with ID` エラーになる。
Notion MCPの `notion-fetch` でDBを取得すると、ページURLにあるIDがデータベースページID、
`<data-source url="collection://...">` にあるのがコレクションID。

IDが不明な場合は `notion-search` で検索し、`notion-fetch` で正しいIDを特定する。

### Notionインテグレーション

インテグレーション名は「タイヤアプリv2」。新しいDBを作成・接続した場合は、
Notion側でDBの「接続」に「タイヤアプリv2」を追加する必要がある。
接続されていないと `Could not find database` エラーになる。

## ポータル（index.html）の構造

### 認証フロー

1. ユーザーが名前を選択 → 6桁PINを入力
2. Notion社員マスタ（タイヤアプリ）を照合
3. 認証成功でセッションをlocalStorageに保存

```javascript
// セッションキー
localStorage key: 'foo_portal_session'
// テーマキー
localStorage key: 'foo_portal_theme'
```

セッションには `apps` オブジェクトが含まれ、各アプリの表示権限が入っている：
```javascript
{
  name: "向畑",
  apps: { tire: true, kintai: true, cashflow: true, task: true, ... },
  expires: "2026-04-21T..."
}
```

### APP_DEFS（アプリ定義）

index.htmlの `APP_DEFS` 配列で全アプリを管理。各定義のkeyが社員マスタのcheckboxプロパティ名と一致する必要がある。

```javascript
{
  key: '✅ タスク管理',      // 社員マスタのプロパティ名（完全一致必須）
  id: 'task',                // セッションのapps.XXXに対応
  label: 'タスク管理',       // 表示名
  sub: 'スポット · シーズン · 定期',  // サブテキスト
  section: 'コミュニティ',   // セクション分類
  url: 'https://mitsurumukaihata.github.io/foo-portal/task-manager-app.html',
  icon: `<svg .../>`,        // SVGアイコン
  // coming: true,           // 準備中フラグ（有効化時に削除）
}
```

**keyの注意**: 社員マスタのプロパティ名と完全一致させる。絵文字の有無も含めて正確に。
例: 社員マスタが `✅ タスク管理` なら key も `'✅ タスク管理'`、`資金繰り` なら `'資金繰り'`（絵文字なし）。

### アクセス制御パターン

各アプリHTMLでの認証チェック：

```javascript
function checkAccess() {
  try {
    const raw = localStorage.getItem('foo_portal_session');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (new Date(data.expires) < new Date()) return false;
    if (data.apps && data.apps.XXXXX === true) return true;  // ← アプリIDで判定
    return false;
  } catch(e) { return false; }
}

// init()内で使用
async function init() {
  const session = loadSession();
  if (!session || !checkAccess()) {
    document.getElementById('auth-error').style.display = 'flex';
    return;
  }
  // ... アプリ本体の初期化
}
```

## CSS / テーマ

全アプリ共通のCSS変数パターン。ダーク/ライト/自動の3モード。

```css
:root {
  --bg: #18181f; --s1: #101015; --s2: #1e1e26; --s3: #26262f;
  --border: #2c2c38; --border2: #3c3c4a; --text: #f0f0f2; --muted: #68687a;
  --accent: #f0a500; --accent2: #f5be40;
  --green: #22c55e; --red: #ef4444; --blue: #3b82f6; --purple: #a855f7;
}
/* ライトモード */
[data-theme="light"] {
  --bg: #fdf6ee; --s1: #ffffff; --s2: #fdf0e4; --s3: #f5e6d4;
  --border: #e8d8c4; --border2: #d8c4a8; --text: #1a1208; --muted: #a08060;
  --accent: #e07000; --accent2: #c05800;
}
```

テーマ同期（各アプリのhead内で実行）：
```javascript
(function(){
  const t = localStorage.getItem('foo_portal_theme') || 'auto';
  if (t !== 'auto') document.documentElement.setAttribute('data-theme', t);
})();
```

## 新しいアプリを追加する手順

1. **HTMLファイル作成**: 既存アプリ（cashflow.html等）をベースに作成
2. **必須要素**: テーマ同期、認証チェック、notionAPI関数、エラーハンドリング
3. **Notion DB接続**: データベースページIDを使用、「タイヤアプリv2」インテグレーションを接続
4. **index.htmlのAPP_DEFS追加**: key（社員マスタのプロパティ名一致）、id、url等を設定
5. **社員マスタにプロパティ追加**: checkbox型で作成、対象者にチェック
6. **Git push**: コミットしてプッシュ

## 既存アプリ一覧

詳細はreferences/app-list.mdを参照。

## よくあるトラブルと対処

| 症状 | 原因 | 対処 |
|------|------|------|
| `Could not find database` | DB IDがコレクションID / インテグレーション未接続 | notion-fetchでページID確認 / 接続追加 |
| 読み込みに失敗 | APIパスに `/v1/` が含まれている | `/v1/` を削除 |
| アプリが表示されない | APP_DEFSのkeyと社員マスタのプロパティ名が不一致 | 絵文字含め完全一致させる |
| ログイン画面に戻される | セッションにapps.XXXがない | 一度ログアウト→再ログインでセッション更新 |
| `coming: true` のまま | APP_DEFSで有効化していない | coming削除、url追加 |
