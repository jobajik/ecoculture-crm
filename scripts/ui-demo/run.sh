#!/bin/bash
# Локальная демо-копия CRM для проверки интерфейса БЕЗ доступа к Google-таблице и без входа через Google.
#   scripts/ui-demo/run.sh            — скопировать исходники во временную папку, подменить данные выдуманными,
#                                        собрать боевую сборку и поднять её на http://localhost:3100
#   node scripts/ui-demo/shot.cjs …   — снимки страниц под выбранным сотрудником
#   node scripts/ui-demo/crawl.cjs …  — обход всех страниц: ошибки, боковая прокрутка, таблицы шире карточки
# В репозитории и на сайте ничего не меняется: правится только копия в $UI_DEMO_DIR (по умолчанию /tmp/ecoculture-ui-demo).
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${UI_DEMO_DIR:-/tmp/ecoculture-ui-demo}"
PORT="${PORT:-3100}"
D="$OUT/demo"
mkdir -p "$D"
pkill -f "next-server" 2>/dev/null || true
sleep 1
[ -f "$OUT/fixture.json" ] || (cd "$REPO" && npx tsx scripts/ui-demo/fixture.ts "$OUT/fixture.json")
for x in src public scripts; do rm -rf "$D/$x"; cp -r "$REPO/$x" "$D/$x"; done
cp "$REPO"/package.json "$REPO"/tsconfig.json "$REPO"/tailwind.config.ts "$REPO"/postcss.config.* "$REPO"/next.config.js "$REPO"/next-env.d.ts "$D"/ 2>/dev/null || true
[ -e "$D/node_modules" ] || ln -s "$REPO/node_modules" "$D/node_modules"
python3 "$REPO/scripts/ui-demo/patch.py" "$D"
cat > "$D/.env.local" <<ENV
NEXTAUTH_SECRET=demo-secret-not-real
NEXTAUTH_URL=http://localhost:$PORT
GOOGLE_CLIENT_ID=demo
GOOGLE_CLIENT_SECRET=demo
GOOGLE_SHEETS_SPREADSHEET_ID=demo
PAYROLL_SPREADSHEET_ID=demo2
DEMO_FIXTURE=$OUT/fixture.json
ENV
cd "$D"
npx next build > "$OUT/build.log" 2>&1 || { tail -30 "$OUT/build.log"; exit 1; }
(nohup npx next start -p "$PORT" > "$OUT/start.log" 2>&1 &)
sleep 4
tail -1 "$OUT/start.log"
