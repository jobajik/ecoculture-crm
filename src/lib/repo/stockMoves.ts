import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { toIsoDateTime } from "../sheetDate";
import { generateId } from "../id";
import { toBatch } from "./batches";
import { inStore, moveWrites, planStockMove, type MoveDirection, type MoveLine, type MoveBatchRow } from "../officeStore";
import type { WriteoffPlan } from "../writeoffPlan";

export interface StockMove {
  moveId: string;
  createdAt: string;
  direction: MoveDirection;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  fromBatchId: string;
  toBatchId: string;
  byEmail: string;
  note: string;
}

export async function listStockMoves(): Promise<StockMove[]> {
  try {
    const table = await readTable(SHEET_TABS.STOCK_MOVES);
    return table.rows
      .map((row) => rowToRecord(SHEET_TABS.STOCK_MOVES, row))
      .map((r) => ({
        moveId: r.MoveID,
        createdAt: toIsoDateTime(r.CreatedAt) || r.CreatedAt || "",
        direction: (r.Direction === "to_main" ? "to_main" : "to_office") as MoveDirection,
        flowerType: r.FlowerType || "",
        variety: r.Variety || "",
        grade: r.Grade || "",
        quantity: Number(r.Quantity) || 0,
        fromBatchId: r.FromBatchID || "",
        toBatchId: r.ToBatchID || "",
        byEmail: (r.ByEmail || "").toLowerCase(),
        note: r.Note || "",
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

async function freshRows(): Promise<MoveBatchRow[]> {
  const table = await readTable(SHEET_TABS.BATCHES, { fresh: true });
  return table.rows.map((row, i) => {
    const b = toBatch(rowToRecord(SHEET_TABS.BATCHES, row));
    return { ...b, rowNumber: table.rowNumbers[i] };
  });
}

/** Раскладка перемещения по СВЕЖЕМУ складу — для показа до записи. */
export async function previewStockMove(direction: MoveDirection, lines: MoveLine[]): Promise<WriteoffPlan> {
  const rows = await freshRows();
  return planStockMove(lines, inStore(rows, direction === "to_office" ? "" : "office"));
}

/**
 * Перемещение основной склад ⇄ офис. Склад читается свежим, раскладка
 * считается заново, остатки, новые офисные партии и журнал — одной атомарной
 * записью (грабли 1.16). Любая ошибка — до первой записи.
 */
export async function moveStock(input: {
  direction: MoveDirection;
  lines: MoveLine[];
  byEmail: string;
  note?: string;
}): Promise<{ total: number; batches: number }> {
  const rows = await freshRows();
  const plan = planStockMove(input.lines, inStore(rows, input.direction === "to_office" ? "" : "office"));
  const firstError = plan.errors.findIndex(Boolean);
  if (firstError >= 0) throw new Error(`Строка ${firstError + 1}: ${plan.errors[firstError]}. Ничего не перемещено.`);
  if (plan.parts.length === 0) throw new Error("Нечего перемещать");
  const writes = moveWrites({
    direction: input.direction,
    parts: plan.parts,
    rows,
    byEmail: input.byEmail,
    newId: () => generateId("BATCH"),
  });
  if (writes.error) throw new Error(`${writes.error}. Ничего не перемещено.`);

  const createdAt = new Date().toISOString();
  const note = String(input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const ops: WriteOp[] = writes.updates.map((u) => ({
    kind: "update",
    tab: SHEET_TABS.BATCHES,
    rowNumber: u.rowNumber,
    changes: { QuantityRemaining: u.quantityRemaining },
  }));
  if (writes.appends.length) ops.push({ kind: "append", tab: SHEET_TABS.BATCHES, records: writes.appends });
  ops.push({
    kind: "append",
    tab: SHEET_TABS.STOCK_MOVES,
    records: writes.moves.map((m) => ({
      MoveID: generateId("MOVE"),
      CreatedAt: createdAt,
      Direction: input.direction,
      FlowerType: m.flowerType,
      Variety: m.variety,
      Grade: m.grade,
      Quantity: m.quantity,
      FromBatchID: m.fromBatchId,
      ToBatchID: m.toBatchId,
      ByEmail: input.byEmail,
      Note: note,
    })),
  });
  await commitAtomic(ops);
  return { total: plan.total, batches: writes.moves.length };
}
