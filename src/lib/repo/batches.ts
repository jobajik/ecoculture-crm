import { appendRow, appendRows, readTable, rowToRecord, SHEET_TABS, updateWhere } from "../sheets";
import { generateId } from "../id";
import type { FlowerType } from "../constants";
import type { Batch } from "../types";

function toBatch(record: Record<string, string>): Batch {
  return {
    batchId: record.BatchID,
    receivedAt: record.ReceivedAt,
    harvestDate: record.HarvestDate,
    flowerType: (record.FlowerType || "rose") as FlowerType,
    variety: record.Variety || "",
    grade: record.Grade || "",
    quantityIn: Number(record.QuantityIn) || 0,
    quantityRemaining: Number(record.QuantityRemaining) || 0,
    location: record.Location || "",
    receivedByEmail: (record.ReceivedByEmail || "").toLowerCase(),
  };
}

export async function listBatches(): Promise<Batch[]> {
  const table = await readTable(SHEET_TABS.BATCHES);
  return table.rows
    .map((row) => toBatch(rowToRecord(SHEET_TABS.BATCHES, row)))
    .sort((a, b) => (a.harvestDate < b.harvestDate ? -1 : 1));
}

export async function getBatchById(batchId: string): Promise<Batch | null> {
  const batches = await listBatches();
  return batches.find((b) => b.batchId === batchId) ?? null;
}

export interface NewBatchInput {
  harvestDate: string;
  flowerType: FlowerType;
  variety: string;
  grade: string;
  quantityIn: number;
  location?: string;
  receivedByEmail: string;
}

export async function createBatch(input: NewBatchInput): Promise<string> {
  const batchId = generateId("BATCH");
  await appendRow(SHEET_TABS.BATCHES, {
    BatchID: batchId,
    ReceivedAt: new Date().toISOString(),
    HarvestDate: input.harvestDate,
    FlowerType: input.flowerType,
    Variety: input.variety,
    Grade: input.grade,
    QuantityIn: input.quantityIn,
    QuantityRemaining: input.quantityIn,
    Location: input.location ?? "",
    ReceivedByEmail: input.receivedByEmail,
  });
  return batchId;
}

/**
 * Создаёт сразу несколько партий одним запросом к таблице — используется при
 * загрузке приёмки из Excel, чтобы не делать по обращению на каждую строку.
 */
export async function createBatches(inputs: NewBatchInput[]): Promise<string[]> {
  if (inputs.length === 0) return [];
  const receivedAt = new Date().toISOString();
  const batchIds: string[] = [];

  const records = inputs.map((input) => {
    const batchId = generateId("BATCH");
    batchIds.push(batchId);
    return {
      BatchID: batchId,
      ReceivedAt: receivedAt,
      HarvestDate: input.harvestDate,
      FlowerType: input.flowerType,
      Variety: input.variety,
      Grade: input.grade,
      QuantityIn: input.quantityIn,
      QuantityRemaining: input.quantityIn,
      Location: input.location ?? "",
      ReceivedByEmail: input.receivedByEmail,
    };
  });

  await appendRows(SHEET_TABS.BATCHES, records);
  return batchIds;
}

/** Списывает (уменьшает остаток) количество у партии — используется и при отгрузке, и при списании порчи. Бросает ошибку, если остатка не хватает. */
export async function deductBatchQuantity(batchId: string, quantity: number): Promise<void> {
  const ok = await updateWhere(
    SHEET_TABS.BATCHES,
    (record) => record.BatchID === batchId,
    (record) => {
      const remaining = Number(record.QuantityRemaining) || 0;
      if (remaining < quantity) {
        throw new Error(
          `Недостаточно остатка в партии ${batchId}: доступно ${remaining}, требуется ${quantity}`
        );
      }
      return { QuantityRemaining: remaining - quantity };
    }
  );
  if (!ok) throw new Error(`Партия ${batchId} не найдена`);
}

/** Партии с положительным остатком для конкретного сорта/типа, отсортированные по дате сбора (сначала самые старые — FIFO, чтобы в первую очередь отгружать то, что дольше лежит). */
export async function listAvailableBatchesFor(
  flowerType: FlowerType,
  variety: string,
  grade?: string
): Promise<Batch[]> {
  const batches = await listBatches();
  return batches
    .filter(
      (b) =>
        b.quantityRemaining > 0 &&
        b.flowerType === flowerType &&
        b.variety.trim().toLowerCase() === variety.trim().toLowerCase() &&
        (!grade || b.grade.trim().toLowerCase() === grade.trim().toLowerCase())
    )
    .sort((a, b) => (a.harvestDate < b.harvestDate ? -1 : 1));
}
