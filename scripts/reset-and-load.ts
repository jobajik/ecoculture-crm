/*
 * Разовый скрипт: очистить рабочие данные и залить настоящий склад.
 *
 * Что делает по порядку:
 *   1. Стирает всё, что мы вводили для проверки примера, — заявки, партии,
 *      отгрузки, списания, историю цен и планы. Справочники (Users, Varieties,
 *      Settings) НЕ трогает: без них система не работает.
 *   2. Дописывает недостающие сорта на вкладку Varieties.
 *   3. Заводит партии из файла scripts/stock-import.json.
 *
 * Данные разобраны заранее из двух файлов владельца:
 *   «Ассортимент Алматы» — сток на утро (дата срезки на 4 дня раньше);
 *   «Srez na 0709»       — сегодняшний срез.
 * Суммы сверены с итогами в самих файлах: 62 535 первый сорт, 4 640 второй.
 *
 * Запуск: npx tsx scripts/reset-and-load.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendRows,
  clearDataRows,
  readTable,
  rowToRecord,
  SHEET_TABS,
} from "../src/lib/sheets";
import { createBatches } from "../src/lib/repo/batches";
import { getGradesFor, FLOWER_TYPE_LABELS, type FlowerType } from "../src/lib/constants";

interface ImportRow {
  harvestDate: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  source: string;
}

/** Кто «принял» эти партии. Загрузка разовая, поэтому пишем почту владельца. */
const RECEIVED_BY = "y.sadakbayev@gmail.com";

/** Вкладки с рабочими данными. Справочников здесь нет и быть не должно. */
const TABS_TO_CLEAR = [
  SHEET_TABS.ORDERS,
  SHEET_TABS.ORDER_ITEMS,
  SHEET_TABS.BATCHES,
  SHEET_TABS.SHIPMENTS,
  SHEET_TABS.WRITEOFFS,
  SHEET_TABS.PRICE_HISTORY,
  SHEET_TABS.PLANS,
  SHEET_TABS.SHIPMENT_PLANS,
  SHEET_TABS.HARVEST_FORECAST,
  SHEET_TABS.HARVEST_MIX,
];

async function main() {
  const rows: ImportRow[] = JSON.parse(
    readFileSync(join(process.cwd(), "scripts", "stock-import.json"), "utf8")
  );

  // --- Проверяем данные ДО того, как что-то стирать ------------------------
  // Порядок важен: если в файле окажется незнакомая градация, лучше упасть на
  // целой таблице, чем на пустой.
  const problems: string[] = [];
  for (const row of rows) {
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) {
      problems.push(`${row.variety} ${row.grade}: количество ${row.quantity}`);
    }
    const grades = getGradesFor(row.flowerType) as readonly string[];
    if (!grades.includes(row.grade)) {
      problems.push(
        `${FLOWER_TYPE_LABELS[row.flowerType]} «${row.grade}» — нет в списке градаций`
      );
    }
  }
  if (problems.length > 0) {
    console.error("Не буду ничего менять, сначала это:");
    problems.forEach((p) => console.error("  ⛔ " + p));
    process.exit(1);
  }

  const total = rows.reduce((s, r) => s + r.quantity, 0);
  console.log(`В файле ${rows.length} партий, ${total.toLocaleString("ru-RU")} стеблей.`);

  // --- 1. Очистка ----------------------------------------------------------
  console.log("\n--- Чищу рабочие данные ---");
  for (const tab of TABS_TO_CLEAR) {
    const cleared = await clearDataRows(tab);
    console.log(`  ${tab}: удалено строк ${cleared}`);
  }

  // --- 2. Сорта ------------------------------------------------------------
  console.log("\n--- Справочник сортов ---");
  const varietiesTable = await readTable(SHEET_TABS.VARIETIES);
  const known = new Set(
    varietiesTable.rows.map((row) => {
      const r = rowToRecord(SHEET_TABS.VARIETIES, row);
      return `${(r.FlowerType || "").trim().toLowerCase()}|${(r.Variety || "").trim().toLowerCase()}`;
    })
  );
  const toAdd: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.flowerType}|${row.variety.toLowerCase()}`;
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    toAdd.push({ FlowerType: row.flowerType, Variety: row.variety, Active: "TRUE" });
  }
  if (toAdd.length > 0) {
    await appendRows(SHEET_TABS.VARIETIES, toAdd);
    console.log(`  добавлено сортов: ${toAdd.length} — ${toAdd.map((v) => v.Variety).join(", ")}`);
  } else {
    console.log("  все сорта уже есть");
  }

  // --- 3. Партии -----------------------------------------------------------
  console.log("\n--- Завожу партии ---");
  const ids = await createBatches(
    rows.map((row) => ({
      harvestDate: row.harvestDate,
      flowerType: row.flowerType as FlowerType,
      variety: row.variety,
      grade: row.grade,
      quantityIn: row.quantity,
      location: "",
      receivedByEmail: RECEIVED_BY,
    }))
  );
  console.log(`  создано партий: ${ids.length}`);

  // --- Итог ----------------------------------------------------------------
  const byDate = new Map<string, number>();
  for (const row of rows) byDate.set(row.harvestDate, (byDate.get(row.harvestDate) ?? 0) + row.quantity);
  console.log("\n--- Что получилось ---");
  for (const [date, qty] of [...byDate.entries()].sort()) {
    console.log(`  срезка ${date}: ${qty.toLocaleString("ru-RU")} шт.`);
  }
  const byType = new Map<string, number>();
  for (const row of rows) byType.set(row.flowerType, (byType.get(row.flowerType) ?? 0) + row.quantity);
  for (const [type, qty] of byType) {
    console.log(`  ${FLOWER_TYPE_LABELS[type]}: ${qty.toLocaleString("ru-RU")} шт.`);
  }
  console.log(`  ВСЕГО: ${total.toLocaleString("ru-RU")} шт.`);
  console.log("\nГотово.");
}

main().catch((err) => {
  console.error("Сорвалось:", err instanceof Error ? err.message : err);
  process.exit(1);
});
