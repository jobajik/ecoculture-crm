@echo off
chcp 1251 >nul
cd /d "%~dp0"
(
 echo ==== remove unused charts ====
 git rm -f "src/components/charts/PriceDynamicsChart.tsx" "src/components/charts/SalesByManagerChart.tsx" "src/components/charts/SalesByVarietyChart.tsx" "src/components/charts/SalesByWeekCharts.tsx" "src/components/charts/StockByVarietyChart.tsx" "src/components/charts/StorageHistogramChart.tsx" "src/components/charts/WriteoffsChart.tsx"
 echo ==== changes ====
 git add -A
 git status --short
 echo ==== commit ====
 git commit -m "Stock by grade, analytics with benchmarks"
 echo ==== push ====
 git push origin main
 echo ==== last commits ====
 git log --oneline -3
) > "_temp\rel1.txt" 2>&1
