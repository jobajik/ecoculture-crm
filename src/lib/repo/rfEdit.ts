import { sheetNumber } from "../sheetCell";
import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { generateId } from "../id";
import { ORDER_STATUSES, gradeForVariety } from "../constants";
import { nextItemIds } from "../orderEdit";
import { batchesToReturn } from "../orderReturn";
import { planRfCancel, planRfEdit, type RfCancelPlan, type RfEditInput, type RfEditPlan } from "../rfEdit";
import type { RubBatch } from "../rubShipment";
import { formatPhone } from "../phone";
import type { Client } from "../types";
import { toBatch } from "./batches";
import { toOrder, toOrderItem } from "./orders";

/**
 * Запись правки и отмены отгрузки в РФ (правила — `src/lib/rfEdit.ts`).
 *
 * Всё читается СВЕЖИМ (проверка перед записью — грабли 1.15) и пишется ОДНИМ атомарным запросом (грабли 1.16): шапка
 * заявки, её строки, партии и журнал отгрузок. Половина правки — количество в заявке уменьшили, а стебли в партию не
 * вернулись — это цветок, пропавший без следа.
 */
async function load(orderId: string) {
  const [orderTable, itemTable, batchTable, shipTable] = await Promise.all([
    readTable(SHEET_TABS.ORDERS, { fresh: true }),
    readTable(SHEET_TABS.ORDER_ITEMS, { fresh: true }),
    readTable(SHEET_TABS.BATCHES, { fresh: true }),
    readTable(SHEET_TABS.SHIPMENTS, { fresh: true }),
  ]);
  const orderIndex = orderTable.rows.findIndex((row) => rowToRecord(SHEET_TABS.ORDERS, row).OrderID === orderId);
  if (orderIndex < 0) throw new Error("Заявка не найдена");
  const head = toOrder(rowToRecord(SHEET_TABS.ORDERS, orderTable.rows[orderIndex]));
  const itemRows = itemTable.rows
    .map((row, i) => ({ record: rowToRecord(SHEET_TABS.ORDER_ITEMS, row), rowNumber: itemTable.rowNumbers[i] }))
    .filter((r) => r.record.OrderID === orderId);
  const allItemIds = itemTable.rows.map((row) => rowToRecord(SHEET_TABS.ORDER_ITEMS, row)).filter((r) => r.OrderID === orderId).map((r) => r.ItemID);
  const batchRows = new Map<string, { record: Record<string, string>; rowNumber: number }>();
  batchTable.rows.forEach((row, i) => {
    const record = rowToRecord(SHEET_TABS.BATCHES, row);
    batchRows.set(record.BatchID, { record, rowNumber: batchTable.rowNumbers[i] });
  });
  const journal = shipTable.rows.map((row) => rowToRecord(SHEET_TABS.SHIPMENTS, row)).filter((r) => r.OrderID === orderId);
  return {
    head,
    order: { ...head, items: itemRows.map((r) => toOrderItem(r.record)) },
    orderRow: orderTable.rowNumbers[orderIndex],
    itemRows,
    allItemIds,
    batchRows,
    journal,
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Возврат отгруженного в партии: что прибавить к остаткам и какие строки с минусом положить в журнал. */
function returnsToStock(
  data: Loaded,
  orderId: string,
  lines: { itemId: string; variety: string; quantity: number }[],
  byEmail: string,
  note: string,
  now: string
): { delta: Map<string, number>; journal: Record<string, unknown>[] } {
  const delta = new Map<string, number>();
  const journal: Record<string, unknown>[] = [];
  for (const line of lines.filter((l) => l.quantity > 0)) {
    const own = data.journal
      .filter((r) => r.ItemID === line.itemId)
      .map((r) => ({ batchId: r.BatchID, quantity: sheetNumber(r.Quantity), createdAt: r.CreatedAt || "" }));
    const { parts, missing } = batchesToReturn(own, line.quantity);
    if (missing > 0) {
      throw new Error(
        `«${line.variety}»: по журналу отгрузок нашлось только ${line.quantity - missing} шт. из ${line.quantity} — остальное верните приёмкой на склад`
      );
    }
    for (const p of parts) {
      if (!data.batchRows.has(p.batchId)) throw new Error(`Партии ${p.batchId} уже нет на складе — верните цветок приёмкой`);
      delta.set(p.batchId, (delta.get(p.batchId) ?? 0) + p.quantity);
      journal.push({
        ShipmentID: generateId("SHIP"),
        CreatedAt: now,
        OrderID: orderId,
        ItemID: line.itemId,
        BatchID: p.batchId,
        Quantity: -p.quantity,
        WarehouseEmail: byEmail,
        Notes: note,
      });
    }
  }
  return { delta, journal };
}

function batchOps(data: Loaded, delta: Map<string, number>): WriteOp[] {
  const ops: WriteOp[] = [];
  for (const [batchId, change] of delta) {
    if (change === 0) continue;
    const b = data.batchRows.get(batchId)!;
    const quantityIn = Number(b.record.QuantityIn) || 0;
    const next = toBatch(b.record).quantityRemaining + change;
    if (next < 0) throw new Error(`В партии ${batchId} не хватает стеблей — обновите страницу`);
    // Больше, чем приняли, в партии оказаться не может: если данные уже разъехались, упираемся в приход.
    ops.push({
      kind: "update",
      tab: SHEET_TABS.BATCHES,
      rowNumber: b.rowNumber,
      changes: { QuantityRemaining: change > 0 && quantityIn > 0 ? Math.min(quantityIn, next) : next },
    });
  }
  return ops;
}

export async function commitRfEdit(input: {
  orderId: string;
  actor: { email: string; role: string | null | undefined; farm: string | null | undefined };
  edit: RfEditInput;
  /** Карточка по `edit.clientId`, прочитанная сервером. */
  client: Client | null;
  today: string;
}): Promise<RfEditPlan> {
  const data = await load(input.orderId);
  const batches = new Map<string, RubBatch>(Array.from(data.batchRows.values()).map((b) => [b.record.BatchID, toBatch(b.record)]));
  const plan = planRfEdit({
    order: data.order,
    edit: input.edit,
    client: input.client,
    role: input.actor.role,
    farm: input.actor.farm,
    batches,
    today: input.today,
  });
  if (typeof plan === "string") throw new Error(plan);
  if (plan.describe.length === 0) return plan;

  const ops: WriteOp[] = [];
  const now = new Date().toISOString();

  // --- Шапка ---------------------------------------------------------------------
  const head: Record<string, unknown> = {};
  if (plan.deliveryDate !== data.head.deliveryDate) head.DeliveryDate = plan.deliveryDate;
  if (plan.notes !== data.head.notes) head.Notes = plan.notes;
  if (plan.newStatus !== data.head.status) head.Status = plan.newStatus;
  if (plan.client) {
    head.ClientID = plan.client.clientId;
    head.ClientName = plan.client.name;
    head.ClientPhone = formatPhone(plan.client.phone);
  }
  if (Object.keys(head).length > 0) ops.push({ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: data.orderRow, changes: head });

  // --- Позиции --------------------------------------------------------------------
  const rowOf = new Map(data.itemRows.map((r) => [r.record.ItemID, r.rowNumber]));
  const removed: number[] = [];
  for (const line of plan.lines) {
    const rowNumber = rowOf.get(line.was.itemId)!;
    if (line.remove) {
      removed.push(rowNumber);
      continue;
    }
    const extra = plan.more.filter((m) => m.itemId === line.was.itemId).reduce((s, m) => s + m.quantity, 0);
    const changes: Record<string, unknown> = {};
    if (line.quantity + extra !== line.was.quantity) changes.Quantity = line.quantity + extra;
    if (line.shipped + extra !== line.was.shippedQuantity) changes.ShippedQuantity = line.shipped + extra;
    if (line.priceRub !== (line.was.priceRub ?? 0)) changes.PriceRub = line.priceRub > 0 ? line.priceRub : "";
    if (Object.keys(changes).length > 0) ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber, changes });
  }
  const newIds = nextItemIds(input.orderId, data.allItemIds, plan.created.length);
  if (plan.created.length > 0) {
    ops.push({
      kind: "append",
      tab: SHEET_TABS.ORDER_ITEMS,
      records: plan.created.map((c, i) => ({
        OrderID: input.orderId,
        ItemID: newIds[i],
        FlowerType: c.flowerType,
        Variety: c.variety,
        Grade: gradeForVariety(c.flowerType, c.variety, c.grade),
        Quantity: c.quantity,
        UnitPrice: 0,
        ShippedQuantity: c.quantity,
        PriceRub: c.priceRub > 0 ? c.priceRub : "",
      })),
    });
  }

  // --- Склад и журнал ---------------------------------------------------------------
  const back = returnsToStock(
    data,
    input.orderId,
    plan.lines.map((l) => ({ itemId: l.was.itemId, variety: l.was.variety, quantity: l.backToStock })),
    input.actor.email,
    "Правка отгрузки в РФ: возврат на склад",
    now
  );
  const delta = back.delta;
  const journal = back.journal;
  const taken = [
    ...plan.more.map((m) => ({ itemId: m.itemId, parts: m.parts })),
    ...plan.created.map((c, i) => ({ itemId: newIds[i], parts: c.parts })),
  ];
  for (const line of taken) {
    for (const p of line.parts) {
      delta.set(p.batchId, (delta.get(p.batchId) ?? 0) - p.quantity);
      journal.push({
        ShipmentID: generateId("SHIP"),
        CreatedAt: now,
        OrderID: input.orderId,
        ItemID: line.itemId,
        BatchID: p.batchId,
        Quantity: p.quantity,
        WarehouseEmail: input.actor.email,
        Notes: "Дописано правкой отгрузки в РФ",
      });
    }
  }
  ops.push(...batchOps(data, delta));
  if (journal.length > 0) ops.push({ kind: "append", tab: SHEET_TABS.SHIPMENTS, records: journal });
  // Удаление — последним: оно сдвигает строки, и номера, собранные до него, стали бы чужими.
  if (removed.length > 0) ops.push({ kind: "delete", tab: SHEET_TABS.ORDER_ITEMS, rowNumbers: removed });

  await commitAtomic(ops);
  return plan;
}

export async function commitRfCancel(input: {
  orderId: string;
  actor: { email: string; role: string | null | undefined; farm: string | null | undefined };
  reason: string;
}): Promise<RfCancelPlan> {
  const data = await load(input.orderId);
  const plan = planRfCancel({ order: data.order, role: input.actor.role, farm: input.actor.farm, reason: input.reason });
  if (typeof plan === "string") throw new Error(plan);

  const now = new Date().toISOString();
  const back = returnsToStock(
    data,
    input.orderId,
    plan.lines.map((l) => ({ itemId: l.itemId, variety: l.variety, quantity: l.backToStock })),
    input.actor.email,
    `Отмена отгрузки в РФ: ${input.reason.trim()}`,
    now
  );
  const ops: WriteOp[] = [{ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: data.orderRow, changes: { Status: ORDER_STATUSES.CANCELLED } }];
  // Отменённая заявка сохраняет, ЧТО уезжало: количество остаётся, обнуляется только «отгружено».
  const rowOf = new Map(data.itemRows.map((r) => [r.record.ItemID, r.rowNumber]));
  for (const line of plan.lines) {
    ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: rowOf.get(line.itemId)!, changes: { ShippedQuantity: 0 } });
  }
  ops.push(...batchOps(data, back.delta));
  if (back.journal.length > 0) ops.push({ kind: "append", tab: SHEET_TABS.SHIPMENTS, records: back.journal });
  await commitAtomic(ops);
  return plan;
}
