import { appendRow, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import type { Shipment } from "../types";
import { deductBatchQuantity, getBatchById } from "./batches";
import { incrementItemShippedQuantity, recomputeOrderStatusFromItems } from "./orders";

function toShipment(record: Record<string, string>): Shipment {
  return {
    shipmentId: record.ShipmentID,
    createdAt: record.CreatedAt,
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
  const batch = await getBatchById(input.batchId);
  if (!batch) throw new Error("Партия не найдена");
  if (batch.quantityRemaining < input.quantity) {
    throw new Error(
      `В партии ${input.batchId} осталось ${batch.quantityRemaining} шт., запрошено ${input.quantity}`
    );
  }

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
