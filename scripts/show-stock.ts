/*
 * Показывает склад так, как его увидит владелец на главной странице: итог,
 * диапазоны по времени хранения и что в них лежит. Ничего не меняет.
 *
 * Нужен, чтобы проверять загрузку по факту, а не по обещанию скрипта записи.
 *
 * Запуск: npx tsx scripts/show-stock.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getStockSnapshot } from "../src/lib/stock";
import { FLOWER_TYPE_LABELS_PLURAL } from "../src/lib/constants";

const n = (v: number) => v.toLocaleString("ru-RU");

async function main() {
  const snap = await getStockSnapshot(new Date());

  console.log(
    `Всего на складе: ${n(snap.totalStems)} шт · сортов ${snap.varietyCount} · партий ${snap.totalBatches}`
  );
  console.log(`Средний возраст: ${snap.avgAgeDays.toFixed(1)} дн.`);
  console.log(
    `Скоро истечёт: ${n(snap.warningStems)} · просрочено: ${n(snap.criticalStems)}`
  );

  console.log("\nПо цветку:");
  for (const t of snap.byFlowerType) {
    console.log(`  ${FLOWER_TYPE_LABELS_PLURAL[t.flowerType] ?? t.flowerType}: ${n(t.quantity)}`);
  }

  console.log("\nСколько дней лежит:");
  for (const b of snap.ageBuckets) {
    console.log(
      `  ${b.label}: ${n(b.quantity)} шт (${Math.round(b.share * 100)}%), статус ${b.status}`
    );
    for (const v of b.varieties.slice(0, 6)) {
      console.log(`      ${v.variety} — ${n(v.quantity)} (${v.oldestDays} дн., ${v.status})`);
    }
    if (b.varieties.length > 6) console.log(`      … ещё сортов: ${b.varieties.length - 6}`);
  }

  const sum = snap.ageBuckets.reduce((s, b) => s + b.quantity, 0);
  console.log(
    `\nСумма диапазонов ${n(sum)} ${sum === snap.totalStems ? "= складу, сходится" : "НЕ СХОДИТСЯ со складом"}`
  );
}

main().catch((err) => {
  console.error("Сорвалось:", err instanceof Error ? err.message : err);
  process.exit(1);
});
