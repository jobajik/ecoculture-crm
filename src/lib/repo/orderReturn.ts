import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { generateId } from "../id";
import { ORDER_STATUSES, type FlowerType } from "../constants";
import { batchesToReturn, planReturn, returnAccess, type ReturnLineInput, type ReturnPlan } from "../orderReturn";
import { planWholeOrderShipment } from "../shipRules";
import { priceFor, type PriceRow } from "../priceList";
import type { Client } from "../types";
import { toBatch } from "./batches";
import { buildNewOrder, toOrder, toOrderItem } from "./orders";

export interface ReturnResult {
  plan: ReturnPlan;
  /** Номер новой заявки магазину, если что-то переместили. */
  shopOrderId: string;
  /** Сколько стеблей сразу списано со склада под заявку магазину. */
  shippedNow: number;
}

/**
 * Записывает возврат и перемещение (правила — `src/lib/orderReturn.ts`).
 *
 * Всё читается СВЕЖИМ (проверка перед записью — грабли 1.15) и пишется ОДНИМ
 * атомарным запросом (грабли 1.16): клиентская заявка, её строки, партии,
 * журнал отгрузок и новая заявка магазину. Половина перемещения — стебли ушли
 * из клиентской заявки, а заявки магазину нет — хуже, чем ничего.
 */
export async function commitReturn(input: {
  orderId: string;
  actor: { email: string; role: string | null | undefined; farm: string | null | undefined };
  lines: ReturnLineInput[];
  reason: string;
  shop: Client | null;
  shipNow: boolean;
  /** Внутренний прайс на сегодня — цена в заявке магазину. */
  retailPrices: Map<string, PriceRow>;
  today: string;
}): Promise<ReturnResult> {
  const [orderTable, itemTable, batchTable, shipTable] = await Promise.all([
    readTable(SHEET_TABS.ORDERS, { fresh: true }),
    readTable(SHEET_TABS.ORDER_ITEMS, { fresh: true }),
    readTable(SHEET_TABS.BATCHES, { fresh: true }),
    readTable(SHEET_TABS.SHIPMENTS, { fresh: true }),
  ]);

  const orderIndex = orderTable.rows.findIndex(
    (row) => rowToRecord(SHEET_TABS.ORDERS, row).OrderID === input.orderId
  );
  if (orderIndex < 0) throw new Error("Заявка не найдена");
  const orderRow = orderTable.rowNumbers[orderIndex];
  const orderRecord = rowToRecord(SHEET_TABS.ORDERS, orderTable.rows[orderIndex]);
  const head = toOrder(orderRecord);

  const itemRows = itemTable.rows
    .map((row, i) => ({ record: rowToRecord(SHEET_TABS.ORDER_ITEMS, row), rowNumber: itemTable.rowNumbers[i] }))
    .filter((r) => r.record.OrderID === input.orderId);
  const items = itemRows.map((r) => toOrderItem(r.record));
  const order = { ...head, items };

  const access = returnAccess(order, input.actor.role, input.actor.email, input.actor.farm);
  const shopOk = !!input.shop && !!(input.shop.retail || "").trim() && input.shop.active;
  const plan = planReturn({ order, lines: input.lines, access, reason: input.reason, shopChosen: shopOk });
  if (typeof plan === "string") throw new Error(plan);
  if (input.shipNow && plan.moved.length > 0 && !access.canShipNow) {
    throw new Error("Списать со склада сразу может зав. складом или администратор — склад отгрузит заявку магазину сам");
  }

  const ops: WriteOp[] = [];
  const reason = input.reason.trim();
  const now = new Date().toISOString();

  // --- Клиентская заявка ------------------------------------------------------
  const orderChanges: Record<string, unknown> = {};
  if (plan.newStatus !== head.status) orderChanges.Status = plan.newStatus;
  if (plan.outcome === "partial" && head.paidAmount > 0 && plan.paid !== head.paid) {
    orderChanges.Paid = plan.paid ? "TRUE" : "FALSE";
  }
  if (Object.keys(orderChanges).length > 0) {
    ops.push({ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: orderRow, changes: orderChanges });
  }

  const rowOf = new Map(itemRows.map((r) => [r.record.ItemID, r.rowNumber]));
  for (const line of plan.lines) {
    const rowNumber = rowOf.get(line.itemId)!;
    if (plan.deleteItemIds.includes(line.itemId)) continue;
    const changes: Record<string, unknown> = {};
    // Отменённая заявка сохраняет, ЧТО заказывали: строки остаются как были,
    // меняется только отгруженное (если вернули уехавшее).
    if (plan.outcome === "partial" && line.newQuantity !== line.quantity) changes.Quantity = line.newQuantity;
    if (line.newShipped !== line.shippedQuantity) changes.ShippedQuantity = line.newShipped;
    if (Object.keys(changes).length > 0) ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber, changes });
  }

  // --- Отгруженное — обратно в партии ------------------------------------------
  const batchRows = new Map<string, { record: Record<string, string>; rowNumber: number }>();
  batchTable.rows.forEach((row, i) => {
    const record = rowToRecord(SHEET_TABS.BATCHES, row);
    batchRows.set(record.BatchID, { record, rowNumber: batchTable.rowNumbers[i] });
  });
  const remaining = new Map(Array.from(batchRows.entries()).map(([id, b]) => [id, toBatch(b.record).quantityRemaining]));
  const touchedBatches = new Set<string>();
  const journalRows = shipTable.rows.map((row) => rowToRecord(SHEET_TABS.SHIPMENTS, row));
  const journal: Record<string, unknown>[] = [];

  for (const line of plan.lines.filter((l) => l.fromShipped > 0)) {
    const own = journalRows
      .filter((r) => r.ItemID === line.itemId)
      .map((r) => ({ batchId: r.BatchID, quantity: Number(r.Quantity) || 0, createdAt: r.CreatedAt || "" }));
    const { parts, missing } = batchesToReturn(own, line.fromShipped);
    if (missing > 0) {
      throw new Error(
        `«${line.variety}»: по журналу отгрузок нашлось только ${line.fromShipped - missing} шт. из ${line.fromShipped} — ` +
          "остальное оформите приёмкой на склад"
      );
    }
    for (const p of parts) {
      if (!batchRows.has(p.batchId)) {
        throw new Error(`Партии ${p.batchId} уже нет на складе — верните цветок приёмкой`);
      }
      remaining.set(p.batchId, (remaining.get(p.batchId) ?? 0) + p.quantity);
      touchedBatches.add(p.batchId);
      journal.push({
        ShipmentID: generateId("SHIP"),
        CreatedAt: now,
        OrderID: input.orderId,
        ItemID: line.itemId,
        BatchID: p.batchId,
        Quantity: -p.quantity,
        WarehouseEmail: input.actor.email,
        Notes: `Возврат: ${reason}`,
      });
    }
  }

  // --- Заявка магазину ----------------------------------------------------------
  let shopOrderId = "";
  let shippedNow = 0;
  if (plan.moved.length > 0 && input.shop) {
    const shop = input.shop;
    const built = buildNewOrder({
      managerEmail: input.actor.email,
      confirmed: true,
      retail: shop.retail,
      clientId: shop.clientId,
      clientName: shop.name,
      clientPhone: shop.phone || "",
      deliveryDate: input.today,
      notes: `Перемещено из заявки ${input.orderId} (${head.clientName}): ${reason}`,
      items: plan.moved.map((m) => ({
        flowerType: m.flowerType as FlowerType,
        variety: m.variety,
        grade: m.grade,
        quantity: m.quantity,
        unitPrice: priceFor(input.retailPrices, m.flowerType, m.variety, m.grade),
      })),
    });
    shopOrderId = built.orderId;

    if (input.shipNow) {
      const shipItems = built.itemRecords.map((r) => ({
        itemId: String(r.ItemID),
        flowerType: String(r.FlowerType),
        variety: String(r.Variety),
        grade: String(r.Grade),
        quantity: Number(r.Quantity),
        shippedQuantity: 0,
      }));
      const stock = Array.from(batchRows.values()).map((b) => {
        const batch = toBatch(b.record);
        return { ...batch, quantityRemaining: remaining.get(batch.batchId) ?? batch.quantityRemaining };
      });
      const ship = planWholeOrderShipment(shipItems, stock);
      if (ship.shortages.length > 0) {
        throw new Error(
          `На складе не хватает: ${ship.shortages.map((s) => `${s.label} — ${s.missing} шт.`).join("; ")}. ` +
            "Снимите галочку «сразу списать» — склад отгрузит заявку магазину, когда проверит остаток."
        );
      }
      for (const line of ship.lines) {
        for (const p of line.parts) {
          remaining.set(p.batchId, (remaining.get(p.batchId) ?? 0) - p.quantity);
          touchedBatches.add(p.batchId);
          journal.push({
            ShipmentID: generateId("SHIP"),
            CreatedAt: now,
            OrderID: shopOrderId,
            ItemID: line.itemId,
            BatchID: p.batchId,
            Quantity: p.quantity,
            WarehouseEmail: input.actor.email,
            Notes: `Перемещение из ${input.orderId}`,
          });
        }
      }
      for (const r of built.itemRecords) r.ShippedQuantity = r.Quantity;
      built.orderRecord.Status = ORDER_STATUSES.SHIPPED;
      shippedNow = ship.total;
    }

    ops.push({ kind: "append", tab: SHEET_TABS.ORDERS, records: [built.orderRecord] });
    ops.push({ kind: "append", tab: SHEET_TABS.ORDER_ITEMS, records: built.itemRecords });
  }

  for (const batchId of touchedBatches) {
    const b = batchRows.get(batchId)!;
    const quantityIn = Number(b.record.QuantityIn) || 0;
    const next = remaining.get(batchId) ?? 0;
    // Больше, чем приняли, в партии оказаться не может (как в returnBatchQuantity):
    // если данные уже разъехались, упираемся в приход, а не раздуваем склад.
    ops.push({
      kind: "update",
      tab: SHEET_TABS.BATCHES,
      rowNumber: b.rowNumber,
      changes: { QuantityRemaining: quantityIn > 0 ? Math.min(quantityIn, next) : next },
    });
  }
  if (journal.length > 0) ops.push({ kind: "append", tab: SHEET_TABS.SHIPMENTS, records: journal });

  if (plan.deleteItemIds.length > 0) {
    ops.push({
      kind: "delete",
      tab: SHEET_TABS.ORDER_ITEMS,
      rowNumbers: plan.deleteItemIds.map((id) => rowOf.get(id)!).filter(Boolean),
    });
  }

  await commitAtomic(ops);
  return { plan, shopOrderId, shippedNow };
}
