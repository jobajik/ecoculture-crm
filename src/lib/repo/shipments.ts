import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { toIsoDateTime } from "../sheetDate";
import { generateId } from "../id";
import type { Shipment } from "../types";
import { toBatch } from "./batches";
import { shipmentPartsRefusal, statusAfterShipping } from "../shipRules";
import { toOrderItem } from "./orders";

function toShipment(record: Record<string, string>): Shipment {
  return {
    shipmentId: record.ShipmentID,
    createdAt: toIsoDateTime(record.CreatedAt) || record.CreatedAt || "",
    orderId: record.OrderID,
    itemId: record.ItemID,
    batchId: record.BatchID,
    quantity: Number(record.Quantity) || 0,
    warehouseEmail: (record.WarehouseEmail || "").toLowerCase(),
    notes: record.Notes || "",
  };
}

export async function listShipments(): Promise<Shipment[]> {
  const table = await readTable(SHEET_TABS.SHIPMENTS);
  return table.rows.map((row) => toShipment(rowToRecord(SHEET_TABS.SHIPMENTS, row)));
}

export interface ShipmentPart {
  batchId: string;
  quantity: number;
}

export interface NewShipmentsInput {
  orderId: string;
  itemId: string;
  parts: ShipmentPart[];
  warehouseEmail: string;
}

/**
 * Регистрирует отгрузку позиции заявки из одной или нескольких партий.
 * Тонкая обёртка над `createOrderShipments` — отгрузкой нескольких позиций разом.
 */
export async function createShipments(input: NewShipmentsInput): Promise<string[]> {
  return createOrderShipments({
    orderId: input.orderId,
    warehouseEmail: input.warehouseEmail,
    lines: [{ itemId: input.itemId, parts: input.parts }],
  });
}

export interface OrderShipmentLine {
  itemId: string;
  parts: ShipmentPart[];
}

/**
 * Отгрузка одной или нескольких позиций заявки:
 * 1) проверяет все части разом — до первой записи,
 * 2) списывает остатки партий,
 * 3) увеличивает отгруженное по позициям,
 * 4) пересчитывает статус заявки,
 * 5) пишет по строке журнала на каждую партию.
 *
 * Таблица читается один раз на вкладку и свежей, а пишется ОДНИМ атомарным
 * запросом (`commitAtomic`): все пять шагов применяются целиком или никак.
 * Раньше это были четыре отдельных записи, и при отказе Google на последней
 * склад списывался, а журнал отгрузок — нет (аудит сентября: 2 820 стеблей без
 * следа). Если один сорт идёт в двух позициях из одной партии, остаток партии
 * учитывается общий — вторая позиция не может взять то, что уже взяла первая.
 */
export async function createOrderShipments(input: {
  orderId: string;
  warehouseEmail: string;
  lines: OrderShipmentLine[];
}): Promise<string[]> {
  const lines = input.lines
    .map((l) => ({ itemId: l.itemId, parts: l.parts.map((p) => ({ batchId: p.batchId, quantity: Number(p.quantity) })) }))
    .filter((l) => l.parts.length > 0);
  if (lines.length === 0) throw new Error("Отметьте хотя бы одну партию");

  const [batchTable, itemTable, orderTable] = await Promise.all([
    readTable(SHEET_TABS.BATCHES, { fresh: true }),
    readTable(SHEET_TABS.ORDER_ITEMS, { fresh: true }),
    readTable(SHEET_TABS.ORDERS, { fresh: true }),
  ]);

  const batchRows = new Map<string, { record: Record<string, string>; rowNumber: number }>();
  batchTable.rows.forEach((row, i) => {
    const record = rowToRecord(SHEET_TABS.BATCHES, row);
    batchRows.set(record.BatchID, { record, rowNumber: batchTable.rowNumbers[i] });
  });
  // Рабочая копия остатков: уменьшается по мере проверки позиций.
  const batches = new Map(Array.from(batchRows.entries()).map(([id, b]) => [id, toBatch(b.record)]));

  const orderItems = itemTable.rows.map((row, i) => ({
    record: rowToRecord(SHEET_TABS.ORDER_ITEMS, row),
    rowNumber: itemTable.rowNumbers[i],
  }));

  const ops: WriteOp[] = [];
  const shippedNow = new Map<string, number>();
  const taken = new Map<string, number>();
  for (const line of lines) {
    const itemRow = orderItems.find((r) => r.record.ItemID === line.itemId) ?? null;
    const item = itemRow ? toOrderItem(itemRow.record) : null;
    const refusal = shipmentPartsRefusal({ orderId: input.orderId, item, batches, parts: line.parts });
    if (refusal) throw new Error(lines.length > 1 && item ? `${item.variety} ${item.grade}: ${refusal}` : refusal);
    if (!itemRow || !item) throw new Error("Позиция заявки не найдена");
    for (const p of line.parts) {
      const b = batches.get(p.batchId)!;
      batches.set(p.batchId, { ...b, quantityRemaining: b.quantityRemaining - p.quantity });
      taken.set(p.batchId, (taken.get(p.batchId) ?? 0) + p.quantity);
    }
    const total = line.parts.reduce((s, p) => s + p.quantity, 0);
    shippedNow.set(line.itemId, item.shippedQuantity + total);
    ops.push({
      kind: "update",
      tab: SHEET_TABS.ORDER_ITEMS,
      rowNumber: itemRow.rowNumber,
      changes: { ShippedQuantity: item.shippedQuantity + total },
    });
  }

  for (const [batchId, qty] of taken) {
    const b = batchRows.get(batchId)!;
    ops.push({
      kind: "update",
      tab: SHEET_TABS.BATCHES,
      rowNumber: b.rowNumber,
      changes: { QuantityRemaining: (Number(b.record.QuantityRemaining) || 0) - qty },
    });
  }

  const orderIndex = orderTable.rows.findIndex(
    (row) => rowToRecord(SHEET_TABS.ORDERS, row).OrderID === input.orderId
  );
  if (orderIndex >= 0) {
    const orderRecord = rowToRecord(SHEET_TABS.ORDERS, orderTable.rows[orderIndex]);
    const itemsNow = orderItems
      .filter((r) => r.record.OrderID === input.orderId)
      .map((r) => {
        const it = toOrderItem(r.record);
        const now = shippedNow.get(r.record.ItemID);
        return now === undefined ? it : { ...it, shippedQuantity: now };
      });
    const next = statusAfterShipping(orderRecord.Status, itemsNow);
    if (next !== orderRecord.Status) {
      ops.push({ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: orderTable.rowNumbers[orderIndex], changes: { Status: next } });
    }
  }

  const createdAt = new Date().toISOString();
  const journal = lines.flatMap((line) =>
    line.parts.map((p) => ({
      ShipmentID: generateId("SHIP"),
      CreatedAt: createdAt,
      OrderID: input.orderId,
      ItemID: line.itemId,
      BatchID: p.batchId,
      Quantity: p.quantity,
      WarehouseEmail: input.warehouseEmail,
      Notes: "",
    }))
  );
  ops.push({ kind: "append", tab: SHEET_TABS.SHIPMENTS, records: journal });

  await commitAtomic(ops);
  return journal.map((j) => j.ShipmentID);
}
