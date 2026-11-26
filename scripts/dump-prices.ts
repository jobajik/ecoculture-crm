/*
 * Действующий прайс для клиентов целиком — одной строкой JSON (для документа «Прайс-лист»). НИЧЕГО НЕ МЕНЯЕТ.
 * По каждому цветку: длины или категории в порядке справочника, общая цена («Все сорта») и сорта со своей ценой.
 * Запуск: npx tsx scripts/dump-prices.ts [retail]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getCurrentPrices } from "../src/lib/repo/prices";
import { cleanPriceKind } from "../src/lib/priceList";
import { FLOWER_ORDER_ALL, FLOWER_TYPE_LABELS, compareGrades, formatGrade } from "../src/lib/constants";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const kind = cleanPriceKind(process.argv[2]);
  const day = localDayKey();
  const prices = Array.from((await getCurrentPrices(day, kind)).values()).filter((p) => p.price > 0);
  const flowers = FLOWER_ORDER_ALL.map((flower) => {
    const rows = prices.filter((p) => p.flowerType === flower);
    const grades = Array.from(new Set(rows.map((r) => r.grade))).sort((a, b) => compareGrades(flower, a, b));
    const varieties = Array.from(new Set(rows.map((r) => r.variety))).sort((a, b) => Number(!!a) - Number(!!b) || a.localeCompare(b, "ru"));
    return {
      flower,
      label: FLOWER_TYPE_LABELS[flower] ?? flower,
      grades: grades.map((g) => ({ grade: g, label: formatGrade(g) })),
      rows: varieties.map((v) => ({
        variety: v,
        borrowed: rows.some((r) => r.variety === v && r.borrowedFrom),
        since: rows.filter((r) => r.variety === v).map((r) => r.date).sort().pop() ?? "",
        prices: grades.map((g) => rows.find((r) => r.variety === v && r.grade === g)?.price ?? 0),
      })),
    };
  });
  console.log(`PRICES_JSON:${JSON.stringify({ day, kind, flowers })}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
