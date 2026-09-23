/*
 * Диагностика прайса: как он заполнен на самом деле. НИЧЕГО НЕ МЕНЯЕТ.
 * Печатает по каждому прайсу и цветку: какие длины заняты, сколько сортов с
 * ценой, и какие сорта стоят ОДИНАКОВО (одна и та же цена по всем длинам) —
 * чтобы экран прайса строился под живые данные, а не под придуманные.
 *
 * Запуск: npx tsx scripts/diag-prices.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getCurrentPrices } from "../src/lib/repo/prices";
import { listVarietiesByType } from "../src/lib/repo/varieties";
import { PRICE_KINDS } from "../src/lib/priceList";
import { FLOWER_TYPES, getGradesFor } from "../src/lib/constants";

async function main() {
  const varieties = await listVarietiesByType();
  for (const kind of [PRICE_KINDS.CLIENT, PRICE_KINDS.RETAIL]) {
    const prices = await getCurrentPrices(undefined, kind);
    console.log(`\n===== прайс «${kind || "клиентский"}»: позиций с ценой ${[...prices.values()].filter((p) => p.price > 0).length}`);
    for (const flower of [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA]) {
      const grades = getGradesFor(flower);
      const rows = [...prices.values()].filter((p) => p.flowerType === flower && p.price > 0);
      const names = varieties[flower] ?? [];
      const usedGrades = grades.filter((g) => rows.some((r) => r.grade === g));
      console.log(`\n--- ${flower}: сортов в справочнике ${names.length}, с ценой ${new Set(rows.filter((r) => r.variety).map((r) => r.variety)).size}, строк ${rows.length}`);
      console.log(`    длины с ценой: ${usedGrades.join(", ") || "нет"}`);
      const base = usedGrades.map((g) => rows.find((r) => !r.variety && r.grade === g)?.price ?? 0);
      console.log(`    «Все сорта»: ${base.join(" / ")}`);
      const groups = new Map<string, string[]>();
      for (const name of names) {
        const vec = usedGrades.map((g) => rows.find((r) => r.variety === name && r.grade === g)?.price ?? 0).join(" / ");
        groups.set(vec, [...(groups.get(vec) ?? []), name]);
      }
      const extra = new Set(rows.filter((r) => r.variety && !names.includes(r.variety)).map((r) => r.variety));
      if (extra.size) console.log(`    сорта с ценой, но без справочника: ${[...extra].join(", ")}`);
      for (const [vec, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`    [${list.length}] ${vec}  ←  ${list.slice(0, 6).join(", ")}${list.length > 6 ? " …" : ""}`);
      }
    }
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
