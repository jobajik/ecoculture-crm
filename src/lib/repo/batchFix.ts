import { commitAtomic, forgetReads, prefetchTables, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { toBatch } from "./batches";
import { listShipments } from "./shipments";
import { listWriteoffs } from "./writeoffs";
import { listStaffTakeouts } from "./staffTakeouts";
import { listStockMoves } from "./stockMoves";
import { batchTouches, type BatchJournals } from "../batchFix";
import type { Batch } from "../types";

/**
 * Партия и всё, что с ней было, — свежим чтением (одним пакетом, грабли 1.17): правка решает,
 * нетронута ли партия, и три секунды старины здесь стоили бы удалённой партии с отгрузкой.
 */
export async function loadBatchForFix(
  batchId: string
): Promise<{ batch: Batch; rowNumber: number; touches: string[]; all: Batch[] } | null> {
  forgetReads();
  await prefetchTables([
    SHEET_TABS.BATCHES,
    SHEET_TABS.SHIPMENTS,
    SHEET_TABS.WRITEOFFS,
    SHEET_TABS.STAFF_TAKEOUTS,
    SHEET_TABS.STOCK_MOVES,
  ]);
  const table = await readTable(SHEET_TABS.BATCHES);
  const all = table.rows.map((row) => toBatch(rowToRecord(SHEET_TABS.BATCHES, row)));
  const i = all.findIndex((b) => b.batchId === batchId);
  if (i < 0) return null;
  const [shipments, writeoffs, takeouts, moves] = await Promise.all([
    listShipments(),
    listWriteoffs(),
    listStaffTakeouts(),
    listStockMoves(),
  ]);
  const journals: BatchJournals = { shipments, writeoffs, takeouts, moves, batches: all };
  return { batch: all[i], rowNumber: table.rowNumbers[i], touches: batchTouches(all[i], journals), all };
}

export async function deleteBatchRow(rowNumber: number): Promise<void> {
  await commitAtomic([{ kind: "delete", tab: SHEET_TABS.BATCHES, rowNumbers: [rowNumber] }]);
}

export async function updateBatchRow(rowNumber: number, changes: Record<string, unknown>): Promise<void> {
  await commitAtomic([{ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber, changes }]);
}
