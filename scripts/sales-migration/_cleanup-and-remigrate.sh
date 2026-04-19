#!/bin/bash
# Rate-limit で壊れた 2023/12 〜 2024/3 を修復
# 各月で大きなクールダウンを挟んで確実に処理
cd "/c/Users/Mitsuru Mukaihata/Desktop/foo-portal"
LOG=_cleanup-remigrate.log
echo "=== START $(date) ===" > $LOG

# Step 1: 破壊された伝票（明細0件）を削除
echo "===== STEP 1: 破壊伝票のクリーンアップ =====" | tee -a $LOG
node scripts/sales-migration/_cleanup-broken-slips.mjs --year 2023 --month 12 >> $LOG 2>&1
sleep 30
node scripts/sales-migration/_cleanup-broken-slips.mjs --year 2024 --month 3 >> $LOG 2>&1
sleep 60  # 大きめクールダウン

# Step 2: 2024/1 全件再移行
echo "===== STEP 2: 2024/1 再移行 =====" | tee -a $LOG
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2024.1-2024.3.xlsx" --target-year 2024 --target-month 1 >> $LOG 2>&1
sleep 90  # 各月間でクールダウン

# Step 3: 2024/2 全件再移行
echo "===== STEP 3: 2024/2 再移行 =====" | tee -a $LOG
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2024.1-2024.3.xlsx" --target-year 2024 --target-month 2 >> $LOG 2>&1
sleep 90

# Step 4: 2024/3 全件再移行
echo "===== STEP 4: 2024/3 再移行 =====" | tee -a $LOG
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2024.1-2024.3.xlsx" --target-year 2024 --target-month 3 >> $LOG 2>&1
sleep 90

# Step 5: 2023/12 失敗分を再移行（94成功分は既存のまま）
# _fix-all-missing-2024-11.mjs スタイルで失敗伝票のみ再移行
echo "===== STEP 5: 2023/12 失敗分再移行 =====" | tee -a $LOG
node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2023.10-2023.12.xlsx" --target-year 2023 --target-month 12 >> $LOG 2>&1

echo "=== ALL DONE $(date) ===" >> $LOG
