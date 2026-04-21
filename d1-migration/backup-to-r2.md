# D1 → R2 自動バックアップ設定手順

## 目的
D1 データベース全体を毎日 R2 バケットに自動バックアップする。
万が一の際のデータ復旧・監査証跡として。

## 手順

### 1. R2 バケット作成
```bash
cd cloudflare-worker
CLOUDFLARE_ACCOUNT_ID=0f8f7fc9f1f353c30d4407cc05954f00 npx wrangler r2 bucket create foo-portal-backup
```

### 2. wrangler.toml に R2 + Cron 追加
```toml
[[r2_buckets]]
binding = "BACKUP"
bucket_name = "foo-portal-backup"

[triggers]
crons = ["0 18 * * *"]  # 毎日 18:00 UTC = 3:00 JST
```

### 3. Worker に scheduled handler 追加
worker.js に以下のブロックを追加:

```js
async scheduled(event, env, ctx) {
  const date = new Date().toISOString().slice(0, 10);
  const tables = [
    '得意先マスタ', '顧客情報DB', '商品マスタ', '車両マスタ', '仕入先マスタ',
    '売上伝票', '売上明細', '仕入伝票', '仕入明細',
    '勤怠管理', '入金管理', '発注管理'
  ];
  for (const tbl of tables) {
    const r = await env.DB.prepare(`SELECT * FROM "${tbl}"`).all();
    const json = JSON.stringify(r.results);
    await env.BACKUP.put(`${date}/${tbl}.json`, json);
  }
  await env.BACKUP.put(`${date}/manifest.json`, JSON.stringify({
    backup_time: new Date().toISOString(),
    tables: tables,
    status: 'success'
  }));
}
```

### 4. デプロイ
```bash
npx wrangler deploy
```

### 5. 手動テスト
```bash
CLOUDFLARE_ACCOUNT_ID=0f8f7fc9f1f353c30d4407cc05954f00 npx wrangler r2 object list foo-portal-backup
```

## 料金
R2 は 10GB まで無料。バックアップサイズは推定 50MB/日 なので、
200日分（約半年）無料枠に収まる。

## 復元手順（障害時）
```bash
# 特定日のバックアップをダウンロード
npx wrangler r2 object get foo-portal-backup/2026-04-22/売上伝票.json --file=./restore.json

# D1 に復元（カスタムスクリプトで）
node d1-migration/restore-from-backup.mjs --date 2026-04-22
```
