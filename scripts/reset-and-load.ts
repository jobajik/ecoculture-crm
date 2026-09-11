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
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ключи доступа лежат в .env.local и подтягиваются до первого обращения к
// таблице — как в setup-sheet.ts. Без этой пары строк скрипт падает с
// «Не настроен доступ к Google Sheets», хотя ключи на месте.
dotenv.config({ path: ".env.local" });
dotenv.config();

import {
  appendRows,
  clearDataRows,
  readTable,
  rowToRecord,
  SHEET_TABS,
} from "../src/lib/sheets";
import { createBatches } from "../src/lib/repo/batches";
import {
  getGradesFor,
  DEFAULT_VARIETIES,
  FLOWER_TYPE_LABELS,
  type FlowerType,
} from "../src/lib/constants";

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
  // Выдачи сотрудникам ссылаются на партии, а партии здесь заводятся заново:
  // оставить старые выдачи значило бы получить строки, указывающие в пустоту.
  SHEET_TABS.STAFF_TAKEOUTS,
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

  // --- Предохранитель ------------------------------------------------------
  // Скрипт стирает рабочие данные — это было нужно один раз, чтобы убрать
  // примеры. Дальше он опасен: запустить его через месяц значит потерять все
  // заявки и отгрузки. Поэтому при непустых заявках он останавливается и просит
  // подтвердить это явно: `npx tsx scripts/reset-and-load.ts --force`.
  const force = process.argv.includes("--force");
  const [orders, shipments] = await Promise.all([
    readTable(SHEET_TABS.ORDERS),
    readTable(SHEET_TABS.SHIPMENTS),
  ]);
  if (!force && (orders.rows.length > 0 || shipments.rows.length > 0)) {
    console.error(
      `\nСТОП. В таблице уже есть заявки (${orders.rows.length}) и отгрузки ` +
        `(${shipments.rows.length}) — это живая работа, а не примеры.\n` +
        "Скрипт сотрёт их вместе с остальным. Если это действительно нужно, " +
        "запустите его с ключом --force.\nНичего не изменено."
    );
    process.exit(1);
  }

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
  const wanted: { flowerType: string; variety: string }[] = [
    // Сначала всё из справочника по умолчанию: склад выбирает сорт из списка, и
    // сорт с нулевым остатком в списке всё равно нужен.
    ...Object.entries(DEFAULT_VARIETIES).flatMap(([flowerType, list]) =>
      list.map((variety) => ({ flowerType, variety }))
    ),
    // Потом то, что пришло с данными.
    ...rows.map((row) => ({ flowerType: row.flowerType, variety: row.variety })),
  ];
  for (const item of wanted) {
    const key = `${item.flowerType}|${item.variety.toLowerCase()}`;
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    toAdd.push({ FlowerType: item.flowerType, Variety: item.variety, Active: "TRUE" });
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
