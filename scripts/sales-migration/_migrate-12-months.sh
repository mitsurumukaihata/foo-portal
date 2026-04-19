#!/bin/bash
cd "/c/Users/Mitsuru Mukaihata/Desktop/foo-portal"
LOG=_migrate-12-months.log
echo "=== START $(date) ===" > $LOG

# 2023.4-2023.6 → 月別
for M in 4 5 6; do
  echo "===== 2023/$M START =====" >> $LOG
  node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2023.4-2023.6.xlsx" --target-year 2023 --target-month $M >> $LOG 2>&1
  echo "===== 2023/$M END $(date) =====" >> $LOG
done

# 2023.7-2023.9
for M in 7 8 9; do
  echo "===== 2023/$M START =====" >> $LOG
  node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2023.7-2023.9.xlsx" --target-year 2023 --target-month $M >> $LOG 2>&1
  echo "===== 2023/$M END $(date) =====" >> $LOG
done

# 2023.10-2023.12
for M in 10 11 12; do
  echo "===== 2023/$M START =====" >> $LOG
  node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2023.10-2023.12.xlsx" --target-year 2023 --target-month $M >> $LOG 2>&1
  echo "===== 2023/$M END $(date) =====" >> $LOG
done

# 2024.1-2024.3
for M in 1 2 3; do
  echo "===== 2024/$M START =====" >> $LOG
  node scripts/sales-migration/migrate-sales.mjs --file "売上明細　2024.1-2024.3.xlsx" --target-year 2024 --target-month $M >> $LOG 2>&1
  echo "===== 2024/$M END $(date) =====" >> $LOG
done

echo "=== ALL DONE $(date) ===" >> $LOG
