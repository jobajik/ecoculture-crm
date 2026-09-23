/*
 * Проверка атомарной записи на ЖИВОЙ таблице — безопасная.
 *
 * `commitAtomic` пишет через `spreadsheets.batchUpdate` (updateCells +
 * appendCells), а не через привычный `values.update`. Чистые проверки
 * (`check-integrity`) видят только то, ЧТО мы отправим; отправится ли это —
 * покажет только Google. Ошибка здесь сломала бы отгрузку на сайте, поэтому
 * путь прогоняется на настоящей таблице до того, как по нему пойдёт склад.
 *
 * Что делает: берёт одну строку вкладки Settings и записывает в её ячейку
 * Value ТО ЖЕ САМОЕ значение, что там уже лежит, — ничего не меняется, но
 * запрос проходит весь путь (номер листа, адрес ячейки, тип значения). Потом
 * читает заново и сверяет. Плюс чтение нескольких вкладок одним запросом
 * (`prefetchTables`). Ничего не дописывает и не стирает.
 *
 * Запуск: npx tsx scripts/check-live-write.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { commitAtomic, forgetReads, prefetchTables, readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";

async function main() {
  forgetReads();
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.SETTINGS]);
  const orders = await readTable(SHEET_TABS.ORDERS);
  console.log(`Пакетное чтение: заявок ${orders.rows.length} — OK`);

  const table = await readTable(SHEET_TABS.SETTINGS, { fresh: true });
  if (table.rows.length === 0) throw new Error("Во вкладке Settings нет строк — проверять не на чем");
  const record = rowToRecord(SHEET_TABS.SETTINGS, table.rows[0]);
  const rowNumber = table.rowNumbers[0];
  console.log(`Строка ${rowNumber}: ${record.Key} = «${record.Value}»`);

  await commitAtomic([{ kind: "update", tab: SHEET_TABS.SETTINGS, rowNumber, changes: { Value: record.Value } }]);

  const after = rowToRecord(SHEET_TABS.SETTINGS, (await readTable(SHEET_TABS.SETTINGS, { fresh: true })).rows[0]);
  if (after.Key !== record.Key || after.Value !== record.Value) {
    throw new Error(`Значение изменилось: было «${record.Value}», стало «${after.Value}»`);
  }
  console.log("Атомарная запись ячейки: значение то же — OK");
  console.log("\nВсе проверки прошли");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
