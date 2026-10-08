import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Убрать повтор приёмки: по каждой указанной партии ищется её «двойник» (тот же день срезки, цветок,
 * сорт, градация и приход, `receiptKey`). Удаляется НЕТРОНУТАЯ из пары — указанная, а если она уже
 * в работе, то двойник (`batchTouches`). Без двойника не удаляется ничего: это не повтор. Перед
 * удалением — копия всей таблицы, в журнал действий — что удалено. Без --yes — показ.
 *
 *   npx tsx scripts/batch-dedupe.ts <BATCH-…> [<BATCH-…> …] [--yes]
 *
 * 08.10.2026, Разия: «эустома от 5.10 внесена дважды — удалите» (её приёмка и моя, задание 194).
 */
import { commitAtomic, forgetReads, prefetchTables, readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { toBatch } from "../src/lib/repo/batches";
import { listShipments } from "../src/lib/repo/shipments";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listStaffTakeouts } from "../src/lib/repo/staffTakeouts";
import { listStockMoves } from "../src/lib/repo/stockMoves";
import { logMoney } from "../src/lib/repo/moneyLog";
import { batchLine, batchTouches, receiptKey, type BatchJournals } from "../src/lib/batchFix";
import { createBackup } from "../src/lib/backup";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";

async function main() {
  const ids = process.argv.slice(2).filter((a) => a.startsWith("BATCH-"));
  const apply = process.argv.includes("--yes");
  if (!ids.length) throw new Error("Укажите партии");
  forgetReads();
  await prefetchTables([SHEET_TABS.BATCHES, SHEET_TABS.SHIPMENTS, SHEET_TABS.WRITEOFFS, SHEET_TABS.STAFF_TAKEOUTS, SHEET_TABS.STOCK_MOVES]);
  const table = await readTable(SHEET_TABS.BATCHES);
  const all = table.rows.map((row, i) => ({ batch: toBatch(rowToRecord(SHEET_TABS.BATCHES, row)), rowNumber: table.rowNumbers[i] }));
  const [shipments, writeoffs, takeouts, moves] = await Promise.all([listShipments(), listWriteoffs(), listStaffTakeouts(), listStockMoves()]);
  const j: BatchJournals = { shipments, writeoffs, takeouts, moves, batches: all.map((x) => x.batch) };

  const toDelete: typeof all = [];
  for (const id of ids) {
    const me = all.find((x) => x.batch.batchId === id);
    if (!me) {
      console.log(`${id}: не найдена`);
      continue;
    }
    const twins = all.filter((x) => x.batch.batchId !== id && !x.batch.store && receiptKey(x.batch) === receiptKey(me.batch));
    console.log(`\n${batchLine(me.batch)} · остаток ${me.batch.quantityRemaining} · ${batchTouches(me.batch, j).join(", ") || "нетронутая"}`);
    for (const t of twins) {
      console.log(`  двойник ${batchLine(t.batch)} · остаток ${t.batch.quantityRemaining} · принял ${t.batch.receivedByEmail} ${t.batch.receivedAt.slice(0, 16)} · ${batchTouches(t.batch, j).join(", ") || "нетронутая"}`);
    }
    if (twins.length === 0) {
      console.log("  двойника нет — не повтор, не трогаю");
      continue;
    }
    const pick = [me, ...twins].find((x) => batchTouches(x.batch, j).length === 0 && !toDelete.includes(x));
    if (!pick) {
      console.log("  обе в работе — удалить нельзя, только списание");
      continue;
    }
    console.log(`  → удалить ${pick.batch.batchId}`);
    toDelete.push(pick);
  }
  console.log(`\nК удалению: ${toDelete.length} партий, ${toDelete.reduce((s, x) => s + x.batch.quantityIn, 0)} стеблей`);
  if (!apply || toDelete.length === 0) return console.log(apply ? "Нечего удалять." : "Только показ. Удалить: --yes");

  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  await commitAtomic([{ kind: "delete", tab: SHEET_TABS.BATCHES, rowNumbers: toDelete.map((x) => x.rowNumber) }]);
  for (const x of toDelete) {
    await logMoney({
      actorEmail: OWNER,
      orderId: "",
      action: MONEY_LOG_ACTIONS.BATCH_FIXED,
      details: `удалена партия ${batchLine(x.batch)} · повтор приёмки (внесли дважды)`,
      amountBefore: 0,
      amountAfter: 0,
    });
  }
  console.log(`Удалено: ${toDelete.map((x) => x.batch.batchId).join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
