import { appendRows, readTable, rowToRecord, SHEET_TABS, updateRows } from "../sheets";
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
 * Регистрирует отгрузку позиции заявки из одной или нескольких партий:
 * 1) проверяет все части разом — до первой записи,
 * 2) списывает остатки партий,
 * 3) увеличивает отгруженное по позиции,
 * 4) пересчитывает статус заявки,
 * 5) пишет по строке журнала на каждую партию.
 *
 * Таблица читается ОДИН раз на вкладку и свежей, а пишется пакетами: четыре
 * записи на всю отгрузку, сколько бы партий в ней ни было. Раньше одна партия
 * стоила десятка чтений, и отгрузка из десяти партий упиралась в лимит Google
 * (см. комментарий у `readTable` в src/lib/sheets.ts).
 *
 * Google Sheets не даёт настоящих транзакций, поэтому в случае сбоя между
 * шагами возможна рассинхронизация — она видна и легко правится вручную в
 * таблице (это осознанный компромисс для небольшой компании). Все проверки
 * сделаны до первой записи, так что обычный отказ ничего не оставляет.
 */
export async function createShipments(input: NewShipmentsInput): Promise<string[]> {
  const parts = input.parts.map((p) => ({ batchId: p.batchId, quantity: Number(p.quantity) }));

  const [batchTable, itemTable, orderTable] = await Promise.all([
    readTable(SHEET_TABS.BATCHES, { fresh: true }),
    readTable(SHEET_TABS.ORDER_ITEMS, { fresh: true }),
    readTable(SHEET_TABS.ORDERS, { fresh: true }),
  ]);

  // Партии: запись + номер строки, чтобы потом переписать ровно её.
  const batchRows = new Map<string, { record: Record<string, string>; rowNumber: number }>();
  batchTable.rows.forEach((row, i) => {
    const record = rowToRecord(SHEET_TABS.BATCHES, row);
    batchRows.set(record.BatchID, { record, rowNumber: batchTable.rowNumbers[i] });
  });
  const batches = new Map(
    Array.from(batchRows.entries()).map(([id, b]) => [id, toBatch(b.record)])
  );

  const orderItems = itemTable.rows.map((row, i) => ({
    record: rowToRecord(SHEET_TABS.ORDER_ITEMS, row),
    rowNumber: itemTable.rowNumbers[i],
  }));
  const itemRow = orderItems.find((r) => r.record.ItemID === input.itemId) ?? null;
  const item = itemRow ? toOrderItem(itemRow.record) : null;

  const refusal = shipmentPartsRefusal({ orderId: input.orderId, item, batches, parts });
  if (refusal) throw new Error(refusal);
  if (!itemRow || !item) throw new Error("Позиция заявки не найдена");

  // 1. Остатки партий — одним запросом.
  await updateRows(
    SHEET_TABS.BATCHES,
    parts.map((p) => {
      const b = batchRows.get(p.batchId)!;
      const remaining = Number(b.record.QuantityRemaining) || 0;
      return { rowNumber: b.rowNumber, record: { ...b.record, QuantityRemaining: remaining - p.quantity } };
    })
  );

  // 2. Отгружено по позиции.
  const total = parts.reduce((s, p) => s + p.quantity, 0);
  const shippedNow = item.shippedQuantity + total;
  await updateRows(SHEET_TABS.ORDER_ITEMS, [
    { rowNumber: itemRow.rowNumber, record: { ...itemRow.record, ShippedQuantity: shippedNow } },
  ]);

  // 3. Статус заявки — по свежим позициям с учётом этой отгрузки.
  const orderIndex = orderTable.rows.findIndex(
    (row) => rowToRecord(SHEET_TABS.ORDERS, row).OrderID === input.orderId
  );
  if (orderIndex >= 0) {
    const orderRecord = rowToRecord(SHEET_TABS.ORDERS, orderTable.rows[orderIndex]);
    const itemsNow = orderItems
      .filter((r) => r.record.OrderID === input.orderId)
      .map((r) => {
        const it = toOrderItem(r.record);
        return r.record.ItemID === input.itemId ? { ...it, shippedQuantity: shippedNow } : it;
      });
    const next = statusAfterShipping(orderRecord.Status, itemsNow);
    if (next !== orderRecord.Status) {
      await updateRows(SHEET_TABS.ORDERS, [
        { rowNumber: orderTable.rowNumbers[orderIndex], record: { ...orderRecord, Status: next } },
      ]);
    }
  }

  // 4. Журнал — строка на партию: так по журналу видно, из какого ведра что ушло.
  const createdAt = new Date().toISOString();
  const ids = parts.map(() => generateId("SHIP"));
  await appendRows(
    SHEET_TABS.SHIPMENTS,
    parts.map((p, i) => ({
      ShipmentID: ids[i],
      CreatedAt: createdAt,
      OrderID: input.orderId,
      ItemID: input.itemId,
      BatchID: p.batchId,
      Quantity: p.quantity,
      WarehouseEmail: input.warehouseEmail,
      Notes: "",
    }))
  );
  return ids;
}
