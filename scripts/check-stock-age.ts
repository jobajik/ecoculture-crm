/*
 * Проверка разбивки склада по времени хранения: 1–3, 4–7, 8–13, 14+ дней.
 *
 * Здесь легко ошибиться на границах (день 3 и день 4 обязаны попасть в разные
 * диапазоны) и потерять стебли при склейке сортов, поэтому проверяем и то и
 * другое на выдуманном складе с известными числами.
 *
 * Запуск: npx tsx scripts/check-stock-age.ts
 */
import { getStockSnapshot, ageBucketKeyOf, AGE_BUCKETS } from "../src/lib/stock";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

const NOW = new Date("2026-09-20T12:00:00");

/** Дата срезки «столько-то дней назад». */
function daysAgo(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const batches = [
  // Розы Freedom: две партии в первом диапазоне — должны сложиться в одну строку
  // (длины разные, но в разбивке по дням длина не участвует).
  { batchId: "B1", harvestDate: daysAgo(0), flowerType: "rose", variety: "Freedom", grade: "60", quantityIn: 200, quantityRemaining: 200, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  { batchId: "B2", harvestDate: daysAgo(3), flowerType: "rose", variety: "Freedom", grade: "80", quantityIn: 300, quantityRemaining: 300, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // День 4 — уже следующий диапазон.
  { batchId: "B3", harvestDate: daysAgo(4), flowerType: "rose", variety: "Explorer", grade: "60", quantityIn: 100, quantityRemaining: 100, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // Роза 9 дней — при сроке 7 это просрочка.
  { batchId: "B4", harvestDate: daysAgo(9), flowerType: "rose", variety: "Red Naomi", grade: "70", quantityIn: 50, quantityRemaining: 50, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // Хризантема 9 дней — при сроке 18 она ещё в норме. Тот же диапазон, другой цвет.
  { batchId: "B5", harvestDate: daysAgo(9), flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", quantityIn: 400, quantityRemaining: 400, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // 20 дней — последний диапазон.
  { batchId: "B6", harvestDate: daysAgo(20), flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantityIn: 70, quantityRemaining: 70, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // Пустая партия не должна попасть никуда.
  { batchId: "B7", harvestDate: daysAgo(5), flowerType: "rose", variety: "Freedom", grade: "60", quantityIn: 500, quantityRemaining: 0, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/batches").listBatches>>;

const settings = {
  shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 },
  warningThreshold: 0.7,
} as never as Awaited<ReturnType<typeof import("../src/lib/repo/settings").getSettings>>;

async function main() {
  // --- Границы диапазонов --------------------------------------------------
  check("день 0 — первый диапазон", ageBucketKeyOf(0), "1-3");
  check("день 3 — ещё первый", ageBucketKeyOf(3), "1-3");
  check("день 4 — уже второй", ageBucketKeyOf(4), "4-7");
  check("день 7 — ещё второй", ageBucketKeyOf(7), "4-7");
  check("день 8 — третий", ageBucketKeyOf(8), "8-13");
  check("день 13 — ещё третий", ageBucketKeyOf(13), "8-13");
  check("день 14 — последний", ageBucketKeyOf(14), "14+");
  check("день 400 — тоже последний", ageBucketKeyOf(400), "14+");
  check("диапазонов всего", AGE_BUCKETS.length, 4);
  check(
    "диапазоны идут подряд без дыр",
    AGE_BUCKETS.slice(1).every((b, i) => b.minDays === AGE_BUCKETS[i].maxDays + 1),
    true
  );

  const snap = await getStockSnapshot(NOW, { batches, settings }, null);
  const bucket = (key: string) => snap.ageBuckets.find((b) => b.key === key)!;

  // --- Количества ----------------------------------------------------------
  check("всего на складе", snap.totalStems, 200 + 300 + 100 + 50 + 400 + 70);
  check(
    "сумма диапазонов = складу",
    snap.ageBuckets.reduce((s, b) => s + b.quantity, 0),
    snap.totalStems
  );
  check("1–3 дня", bucket("1-3").quantity, 500);
  check("4–7 дней", bucket("4-7").quantity, 100);
  check("8–13 дней", bucket("8-13").quantity, 450);
  check("14+ дней", bucket("14+").quantity, 70);

  // --- Склейка сортов ------------------------------------------------------
  check("две партии Freedom слились в одну строку", bucket("1-3").varieties.length, 1);
  check("Freedom: количество", bucket("1-3").varieties[0].quantity, 500);
  check("Freedom: партий", bucket("1-3").varieties[0].batches, 2);
  check("пустая партия никуда не попала", bucket("4-7").varieties.length, 1);

  // --- Цвета: один диапазон, разные цветки, разные статусы ------------------
  const nine = bucket("8-13").varieties;
  check(
    "роза 9 дней — просрочена",
    nine.find((v) => v.variety === "Red Naomi")?.status,
    "critical"
  );
  check("хризантема 9 дней — в норме", nine.find((v) => v.variety === "Altaj")?.status, "ok");
  check("диапазон красится по худшему", bucket("8-13").status, "critical");
  check("свежий диапазон — зелёный", bucket("1-3").status, "ok");

  // --- Сортировка и доли ---------------------------------------------------
  check(
    "внутри диапазона сначала крупное",
    nine.map((v) => v.quantity),
    [400, 50]
  );
  check(
    "доли складываются в единицу",
    Math.round(snap.ageBuckets.reduce((s, b) => s + b.share, 0) * 1000) / 1000,
    1
  );

  // --- Пустой склад --------------------------------------------------------
  const empty = await getStockSnapshot(NOW, { batches: [], settings }, null);
  check("пустой склад: диапазоны всё равно есть", empty.ageBuckets.length, 4);
  check("пустой склад: без деления на ноль", empty.ageBuckets.every((b) => b.share === 0), true);

  // --- Фильтр по производству ----------------------------------------------
  const roseFarm = await getStockSnapshot(NOW, { batches, settings }, "rose_farm");
  check(
    "у Rose Farm хризантемы в диапазонах нет",
    roseFarm.ageBuckets.every((b) => b.varieties.every((v) => v.flowerType !== "chrysanthemum")),
    true
  );
  check(
    "у Rose Farm сумма диапазонов = его складу",
    roseFarm.ageBuckets.reduce((s, b) => s + b.quantity, 0),
    roseFarm.totalStems
  );

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
