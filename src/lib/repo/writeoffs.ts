import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { generateId } from "../id";
import { toIsoDateTime } from "../sheetDate";
import type { Writeoff } from "../types";
import { batchDeduction, toBatch } from "./batches";
import { planWriteoffs, type WriteoffLine, type WriteoffPlan } from "../writeoffPlan";

function toWriteoff(record: Record<string, string>): Writeoff {
  return {
    writeoffId: record.WriteoffID,
    createdAt: toIsoDateTime(record.CreatedAt) || record.CreatedAt || "",
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
  // Остаток партии и строка журнала — одной атомарной записью: раньше это были
  // два запроса, и при отказе Google на втором стебли пропадали без следа.
  const { op } = await batchDeduction(input.batchId, input.quantity);
  const writeoffId = generateId("WO");
  await commitAtomic([
    op,
    {
      kind: "append",
      tab: SHEET_TABS.WRITEOFFS,
      records: [
        {
          WriteoffID: writeoffId,
          CreatedAt: new Date().toISOString(),
          BatchID: input.batchId,
          Quantity: input.quantity,
          Reason: input.reason,
          WarehouseEmail: input.warehouseEmail,
        },
      ],
    },
  ]);
  return writeoffId;
}

/**
 * Списание общим количеством: разложить по партиям (от старых к свежим) и
 * записать. Склад читается СВЕЖИМ одним запросом, остатки пишутся пакетом,
 * журнал — строкой на партию (грабли 1.15). Любая ошибка — до первой записи.
 */
export async function planWriteoffsFromSheet(input: {
  lines: WriteoffLine[];
  farm: string | null;
  note?: string;
}): Promise<WriteoffPlan> {
  const table = await readTable(SHEET_TABS.BATCHES, { fresh: true });
  const batches = table.rows.map((row) => toBatch(rowToRecord(SHEET_TABS.BATCHES, row)));
  return planWriteoffs({ ...input, batches });
}

export async function createWriteoffsByPlan(input: {
  lines: WriteoffLine[];
  farm: string | null;
  note?: string;
  warehouseEmail: string;
}): Promise<{ plan: WriteoffPlan; ids: string[] }> {
  const table = await readTable(SHEET_TABS.BATCHES, { fresh: true });
  const rows = table.rows.map((row, i) => ({
    record: rowToRecord(SHEET_TABS.BATCHES, row),
    rowNumber: table.rowNumbers[i],
  }));
  const plan = planWriteoffs({
    lines: input.lines,
    farm: input.farm,
    note: input.note,
    batches: rows.map((r) => toBatch(r.record)),
  });
  const firstError = plan.errors.findIndex(Boolean);
  if (firstError >= 0) {
    throw new Error(`Строка ${firstError + 1}: ${plan.errors[firstError]}. Ничего не списано.`);
  }
  if (plan.parts.length === 0) throw new Error("Нечего списывать");

  const byBatch = new Map<string, number>();
  for (const p of plan.parts) byBatch.set(p.batchId, (byBatch.get(p.batchId) ?? 0) + p.quantity);
  const createdAt = new Date().toISOString();
  const ids = plan.parts.map(() => generateId("WO"));
  // Остатки партий и журнал — одной атомарной записью (см. `commitAtomic`).
  await commitAtomic([
    ...Array.from(byBatch.entries()).map(([batchId, qty]): WriteOp => {
      const r = rows.find((x) => x.record.BatchID === batchId)!;
      const remaining = Number(r.record.QuantityRemaining) || 0;
      return { kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: r.rowNumber, changes: { QuantityRemaining: remaining - qty } };
    }),
    {
      kind: "append",
      tab: SHEET_TABS.WRITEOFFS,
      records: plan.parts.map((p, i) => ({
        WriteoffID: ids[i],
        CreatedAt: createdAt,
        BatchID: p.batchId,
        Quantity: p.quantity,
        Reason: p.reason,
        WarehouseEmail: input.warehouseEmail,
      })),
    },
  ]);
  return { plan, ids };
}
