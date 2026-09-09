import { appendRow, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { toIsoDateTime } from "../sheetDate";
import { generateId } from "../id";
import type { Shipment } from "../types";
import { deductBatchQuantity, getBatchById } from "./batches";
import { shipmentRefusal } from "../shipRules";
import { getOrderById, incrementItemShippedQuantity, recomputeOrderStatusFromItems } from "./orders";

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

export interface NewShipmentInput {
  orderId: string;
  itemId: string;
  batchId: string;
  quantity: number;
  warehouseEmail: string;
  notes?: string;
}

/**
 * Регистрирует отгрузку конкретной партии по конкретной позиции заявки:
 * 1) проверяет и списывает остаток партии,
 * 2) увеличивает отгруженное количество по позиции заявки,
 * 3) пересчитывает статус заявки (в работе / отгружена),
 * 4) добавляет запись в журнал отгрузок.
 *
 * Google Sheets не даёт настоящих транзакций, поэтому в случае сбоя между
 * шагами возможна рассинхронизация — она видна и легко правится вручную в
 * таблице (это осознанный компромисс для небольшой компании).
 */
export async function createShipment(input: NewShipmentInput): Promise<string> {
  const [batch, order] = await Promise.all([
    getBatchById(input.batchId),
    getOrderById(input.orderId),
  ]);
  if (!order) throw new Error("Заявка не найдена");

  // Все проверки — на сервере и до первой записи: браузерная проверка считает
  // остаток по странице, отрисованной когда-то раньше (см. src/lib/shipRules.ts).
  const item = order.items.find((i) => i.itemId === input.itemId);
  const refusal = shipmentRefusal({
    orderId: input.orderId,
    item: item ? { ...item, orderId: order.orderId } : null,
    batch,
    quantity: input.quantity,
  });
  if (refusal) throw new Error(refusal);

  await deductBatchQuantity(input.batchId, input.quantity);
  await incrementItemShippedQuantity(input.itemId, input.quantity);
  await recomputeOrderStatusFromItems(input.orderId);

  const shipmentId = generateId("SHIP");
  await appendRow(SHEET_TABS.SHIPMENTS, {
    ShipmentID: shipmentId,
    CreatedAt: new Date().toISOString(),
    OrderID: input.orderId,
    ItemID: input.itemId,
    BatchID: input.batchId,
    Quantity: input.quantity,
    WarehouseEmail: input.warehouseEmail,
    Notes: input.notes ?? "",
  });

  return shipmentId;
}
