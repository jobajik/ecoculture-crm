import { appendRow, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import type { Writeoff } from "../types";
import { deductBatchQuantity, getBatchById } from "./batches";

function toWriteoff(record: Record<string, string>): Writeoff {
  return {
    writeoffId: record.WriteoffID,
    createdAt: record.CreatedAt,
    batchId: record.BatchID,
    quantity: Number(record.Quantity) || 0,
    reason: record.Reason || "",
    warehouseEmail: (record.WarehouseEmail || "").toLowerCase(),
  };
}

export async function listWriteoffs(): Promise<Writeoff[]> {
  const table = await readTable(SHEET_TABS.WRITEOFFS);
  return table.rows.map((row) => toWriteoff(rowToRecord(SHEET_TABS.WRITEOFFS, row)));
}

export interface NewWriteoffInput {
  batchId: string;
  quantity: number;
  reason: string;
  warehouseEmail: string;
}

/** Списание испорченного/просроченного цветка из партии (порча, брак, истёк срок хранения). */
export async function createWriteoff(input: NewWriteoffInput): Promise<string> {
  const batch = await getBatchById(input.batchId);
  if (!batch) throw new Error("Партия не найдена");
  if (batch.quantityRemaining < input.quantity) {
    throw new Error(
      `В партии ${input.batchId} осталось ${batch.quantityRemaining} шт., к списанию запрошено ${input.quantity}`
    );
  }

  await deductBatchQuantity(input.batchId, input.quantity);

  const writeoffId = generateId("WO");
  await appendRow(SHEET_TABS.WRITEOFFS, {
    WriteoffID: writeoffId,
    CreatedAt: new Date().toISOString(),
    BatchID: input.batchId,
    Quantity: input.quantity,
    Reason: input.reason,
    WarehouseEmail: input.warehouseEmail,
  });

  return writeoffId;
}
