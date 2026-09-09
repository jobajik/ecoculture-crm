/*
 * Читающая проверка склада: ничего не меняет, только смотрит.
 *
 * Нужна после очистки базы. Отгрузка уменьшает остаток партии, а очистка
 * возвращает вычтенное обратно. Убедиться, что возврат состоялся, можно так:
 * если по партии не было отгрузок и списаний (а после очистки их нет ни
 * одной), остаток обязан равняться приходу. Партия, где остаток меньше
 * прихода, — это как раз тот случай, когда стебли остались вычтенными, и
 * склад показывает меньше, чем лежит в холодильнике.
 *
 * Запуск: npx tsx scripts/show-stock-state.ts
 */
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import { readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";

async function main() {
  const batches = await readTable(SHEET_TABS.BATCHES);
  const shipments = await readTable(SHEET_TABS.SHIPMENTS).catch(() => ({ rows: [] as string[][] }));
  const writeoffs = await readTable(SHEET_TABS.WRITEOFFS).catch(() => ({ rows: [] as string[][] }));

  let totalIn = 0;
  let totalRemaining = 0;
  const short: { batchId: string; variety: string; grade: string; gap: number }[] = [];

  for (const row of batches.rows) {
    const record = rowToRecord(SHEET_TABS.BATCHES, row);
    const quantityIn = Number(record.QuantityIn) || 0;
    const remaining = Number(record.QuantityRemaining) || 0;
    totalIn += quantityIn;
    totalRemaining += remaining;
    if (remaining < quantityIn) {
      short.push({
        batchId: record.BatchID || "",
        variety: record.Variety || "",
        grade: record.Grade || "",
        gap: quantityIn - remaining,
      });
    }
  }

  console.log(`Партий на складе: ${batches.rows.length}`);
  console.log(`Принято всего:    ${totalIn} стеблей`);
  console.log(`Остаток сейчас:   ${totalRemaining} стеблей`);
  console.log(`Отгрузок в базе:  ${shipments.rows.length}`);
  console.log(`Списаний в базе:  ${writeoffs.rows.length}`);

  const movements = shipments.rows.length + writeoffs.rows.length;
  const gap = totalIn - totalRemaining;

  console.log("");
  if (gap === 0) {
    console.log("Остаток равен приходу — вычтенные стебли вернулись, склад целый.");
  } else if (movements === 0) {
    console.log(`ВНИМАНИЕ: не хватает ${gap} стеблей, а ни одной отгрузки и списания в базе нет.`);
    console.log("Значит вычтенное не вернулось. Партии, где остаток меньше прихода:");
    for (const s of short) {
      console.log(`  ${s.batchId} ${s.variety} ${s.grade} — не хватает ${s.gap}`);
    }
  } else {
    console.log(`Не хватает ${gap} стеблей, но в базе есть движения (${movements}) — это норма.`);
  }
}

main().catch((error) => {
  console.error("Не получилось:", error instanceof Error ? error.message : error);
  process.exit(1);
});
