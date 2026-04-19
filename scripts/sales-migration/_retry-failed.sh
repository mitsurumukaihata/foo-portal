#!/bin/bash
# 失敗した伝票を月単位に分けて再移行
# _migrate-errors.json の失敗伝票リストから月を判定して再投入
cd "/c/Users/Mitsuru Mukaihata/Desktop/foo-portal"
LOG=_retry-failed.log
echo "=== START $(date) ===" > $LOG

# レート制限を避けるため、十分な間隔を置く
echo "レート制限クールダウン中（3分待機）..." | tee -a $LOG
sleep 180

# 2023/12 再移行
echo "===== 2023/12 RETRY START =====" >> $LOG
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2023.10-2023.12.xlsx" --target-year 2023 --target-month 12 >> $LOG 2>&1
echo "===== 2023/12 RETRY END $(date) =====" >> $LOG

# クールダウン
sleep 60

# 2024/1 再移行
echo "===== 2024/1 RETRY START =====" >> $LOG
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2024.1-2024.3.xlsx" --target-year 2024 --target-month 1 >> $LOG 2>&1
echo "===== 2024/1 RETRY END $(date) =====" >> $LOG

sleep 60

# 2024/2 再移行
echo "===== 2024/2 RETRY START =====" >> $LOG
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2024.1-2024.3.xlsx" --target-year 2024 --target-month 2 >> $LOG 2>&1
echo "===== 2024/2 RETRY END $(date) =====" >> $LOG

echo "=== ALL DONE $(date) ===" >> $LOG
