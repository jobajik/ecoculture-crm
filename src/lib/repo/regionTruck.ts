import { sheetNumber } from "../sheetCell";
import { commitAtomic, prefetchTables, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { toIsoDateTime } from "../sheetDate";
import { generateId } from "../id";
import { regionArrivalWrites, regionStoreInfo, type MoveBatchRow, type StoreCode } from "../officeStore";
import {
  pendingReceipt,
  planTruckReceipt,
  retailCardsOf,
  truckKindOf,
  RECEIPT_MOVE_PREFIX,
  type ReceiptLineInput,
  type ReceiptPlan,
  type RegionAccess,
  type TruckMoveRow,
  type TruckReceiptRow,
  type TruckShipRow,
} from "../regionTruck";
import { toBatch } from "./batches";
import { buildNewOrder, toOrder, toOrderItem, type NewOrderInput } from "./orders";
import { listClients } from "./clients";
import { ORDER_KINDS, ORDER_STATUSES } from "../constants";
import { normalizeStore } from "../officeStore";
import { nextItemIds } from "../orderEdit";
import { orderCode } from "../paymentStage";
import { statusAfterShipping } from "../shipRules";
import { planTruckLoad, type LoadExtra, type LoadLine } from "../truckLoad";

/**
 * Приёмка фуры в регионе — чтение и запись (правила — `src/lib/regionTruck.ts`).
 *
 * Запись читает всё СВЕЖИМ (грабли 1.15: проверка перед записью) и пишет ОДНИМ атомарным запросом (грабли 1.16): строки
 * приёмки, остатки и новые партии склада города, журнал перемещений. Половина приёмки — запись «принято 500» без
 * прихода на склад — это цветок, которого нет ни в пути, ни в городе.
 */

function toReceipt(r: Record<string, string>): TruckReceiptRow & { receiptId: string; store: string } {
  return {
    receiptId: r.ReceiptID || "",
    createdAt: toIsoDateTime(r.CreatedAt) || r.CreatedAt || "",
    orderId: r.OrderID || "",
    store: r.Store || "",
    itemId: r.ItemID || "",
    shipped: sheetNumber(r.Shipped),
    accepted: sheetNumber(r.Accepted),
    byEmail: (r.ByEmail || "").toLowerCase(),
    note: r.Note || "",
  };
}

/** Все записи приёмки. Вкладки ещё нет (до `setup-sheet`) или сбой — пусто: страница покажет фуру «ждёт приёмки». */
export async function listRegionReceipts(): Promise<(TruckReceiptRow & { receiptId: string; store: string })[]> {
  try {
    const table = await readTable(SHEET_TABS.REGION_RECEIPTS);
    return table.rows.map((row) => toReceipt(rowToRecord(SHEET_TABS.REGION_RECEIPTS, row)));
  } catch {
    return [];
  }
}

export async function commitTruckReceipt(input: {
  orderId: string;
  store: StoreCode;
  access: RegionAccess;
  byEmail: string;
  lines: ReceiptLineInput[];
  note: string;
}): Promise<ReceiptPlan & { kind: "wholesale" | "retail" }> {
  const info = regionStoreInfo(input.store);
  if (!info) throw new Error("Город не из списка регионов");
  const clients = await listClients();
  // Приёмка не должна молча пройти без записи о ней: вкладки нет — говорим прямо, а не кладём цветок на склад без следа.
  const receiptTable = await readTable(SHEET_TABS.REGION_RECEIPTS, { fresh: true }).catch(() => null);
  if (!receiptTable) throw new Error("Вкладка приёмок ещё не создана в таблице — напишите администратору");
  const [orderTable, itemTable, shipTable, moveTable, batchTable] = await Promise.all([
    readTable(SHEET_TABS.ORDERS, { fresh: true }),
    readTable(SHEET_TABS.ORDER_ITEMS, { fresh: true }),
    readTable(SHEET_TABS.SHIPMENTS, { fresh: true }),
    readTable(SHEET_TABS.STOCK_MOVES, { fresh: true }),
    readTable(SHEET_TABS.BATCHES, { fresh: true }),
  ]);
  const orderRec = orderTable.rows.map((row) => rowToRecord(SHEET_TABS.ORDERS, row)).find((r) => r.OrderID === input.orderId);
  if (!orderRec) throw new Error("Заказ не найден");
  const order = toOrder(orderRec);
  const items = itemTable.rows
    .map((row) => rowToRecord(SHEET_TABS.ORDER_ITEMS, row))
    .filter((r) => r.OrderID === input.orderId)
    .map(toOrderItem);
  const kind = truckKindOf(order, input.store, new Set(retailCardsOf(clients, input.store).map((c) => c.clientId)));

  const shipments: TruckShipRow[] = shipTable.rows
    .map((row) => rowToRecord(SHEET_TABS.SHIPMENTS, row))
    .filter((r) => r.OrderID === input.orderId)
    .map((r) => ({ orderId: r.OrderID, itemId: r.ItemID, batchId: r.BatchID, quantity: sheetNumber(r.Quantity), createdAt: toIsoDateTime(r.CreatedAt) || r.CreatedAt || "" }));
  const moves: TruckMoveRow[] = moveTable.rows
    .map((row) => rowToRecord(SHEET_TABS.STOCK_MOVES, row))
    .map((r) => ({ direction: r.Direction || "", fromBatchId: r.FromBatchID || "", quantity: sheetNumber(r.Quantity), note: r.Note || "", createdAt: toIsoDateTime(r.CreatedAt) || r.CreatedAt || "" }));
  const receipts = receiptTable.rows.map((row) => toReceipt(rowToRecord(SHEET_TABS.REGION_RECEIPTS, row)));

  const pending = pendingReceipt({ order, shipments, moves, receipts });
  const plan = planTruckReceipt({ access: input.access, kind, pending, lines: input.lines, note: input.note });
  if (typeof plan === "string") throw new Error(plan);

  const now = new Date().toISOString();
  const itemOf = new Map(items.map((i) => [i.itemId, i]));
  const ops: WriteOp[] = [
    {
      kind: "append",
      tab: SHEET_TABS.REGION_RECEIPTS,
      records: plan.lines.map((l) => ({
        ReceiptID: generateId("RCPT"),
        CreatedAt: now,
        OrderID: input.orderId,
        Store: input.store,
        ItemID: l.itemId,
        FlowerType: itemOf.get(l.itemId)?.flowerType ?? "",
        Variety: itemOf.get(l.itemId)?.variety ?? "",
        Grade: itemOf.get(l.itemId)?.grade ?? "",
        Shipped: l.shipped,
        Accepted: l.accepted,
        ByEmail: input.byEmail,
        Note: l.accepted < l.shipped ? plan.note : "",
      })),
    },
  ];
  if (plan.landing.length > 0) {
    const rows: MoveBatchRow[] = batchTable.rows.map((row, i) => ({ ...toBatch(rowToRecord(SHEET_TABS.BATCHES, row)), rowNumber: batchTable.rowNumbers[i] }));
    const known = new Set(rows.map((r) => r.batchId));
    const missing = plan.landing.find((p) => !known.has(p.batchId));
    if (missing) throw new Error(`Партии ${missing.batchId}, из которой уехал цветок, уже нет в таблице — приёмку проведёт администратор`);
    const arrival = regionArrivalWrites({ store: input.store, taken: plan.landing, rows, byEmail: input.byEmail, newId: () => generateId("BATCH") });
    for (const u of arrival.updates) ops.push({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: u.rowNumber, changes: { QuantityRemaining: u.quantityRemaining } });
    if (arrival.appends.length) ops.push({ kind: "append", tab: SHEET_TABS.BATCHES, records: arrival.appends });
    if (arrival.moves.length) {
      ops.push({
        kind: "append",
        tab: SHEET_TABS.STOCK_MOVES,
        records: arrival.moves.map((m) => ({
          MoveID: generateId("MOVE"),
          CreatedAt: now,
          Direction: "to_region",
          FlowerType: m.flowerType,
          Variety: m.variety,
          Grade: m.grade,
          Quantity: m.quantity,
          FromBatchID: m.fromBatchId,
          ToBatchID: m.toBatchId,
          ByEmail: input.byEmail,
          Note: `${RECEIPT_MOVE_PREFIX}: ${info.label} · заявка ${input.orderId}`,
        })),
      });
    }
  }
  await commitAtomic(ops);
  return { ...plan, kind: kind! };
}

/** Всё, что нужно страницам раздела «Регион», — одним пакетным чтением (грабли 1.17). */
export async function prefetchRegion(): Promise<void> {
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.BATCHES,
    SHEET_TABS.SHIPMENTS,
    SHEET_TABS.STOCK_MOVES,
    SHEET_TABS.REGION_RECEIPTS,
    SHEET_TABS.SETTINGS,
    SHEET_TABS.USERS,
  ]).catch(() => undefined);
}

/**
 * Погрузка фуры в город одной записью (22.11.2026, правила — `src/lib/truckLoad.ts`): зав. складом отвечает на заказы
 * города на день фуры — что грузит, чего нет, что добавил сам. Читает заявки, позиции и партии СВЕЖИМИ и пишет ОДНИМ
 * атомарным запросом (грабли 1.15, 1.16): остатки партий основного склада, «отгружено» и ответ склада по позициям,
 * дописанные складом позиции (заказа города нет — заявка «объём на город» заводится тут же), статусы заявок и журнал
 * отгрузок. На склад города цветок ляжет приёмкой (`commitTruckReceipt`).
 */
export async function commitTruckLoad(input: {
  store: StoreCode;
  /** День фуры — день отгрузки заказов города. */
  day: string;
  lines: LoadLine[];
  extras: LoadExtra[];
  /** Производство зав. складом; у администратора — null. */
  farm: string | null;
  byEmail: string;
  note?: string;
}): Promise<{ total: number; closedShort: number; added: number; newOrderId: string; refused: string[]; orderIds: string[] }> {
  const info = regionStoreInfo(input.store);
  if (!info) throw new Error("Город не из списка регионов");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new Error("Не указан день фуры");
  const clients = await listClients();
  const retailIds = new Set(retailCardsOf(clients, input.store).map((c) => c.clientId));
  const [orderTable, itemTable, batchTable] = await Promise.all([
    readTable(SHEET_TABS.ORDERS, { fresh: true }),
    readTable(SHEET_TABS.ORDER_ITEMS, { fresh: true }),
    readTable(SHEET_TABS.BATCHES, { fresh: true }),
  ]);
  const live = orderTable.rows
    .map((row, i) => {
      const record = rowToRecord(SHEET_TABS.ORDERS, row);
      return { record, rowNumber: orderTable.rowNumbers[i], order: toOrder(record) };
    })
    .filter((o) => o.order.status !== ORDER_STATUSES.CANCELLED && o.order.deliveryDate === input.day)
    .map((o) => ({ ...o, kind: truckKindOf(o.order, input.store, retailIds) }))
    .filter((o) => o.kind !== null);
  const liveIds = new Set(live.map((o) => o.order.orderId));
  const allItemRows = itemTable.rows.map((row, i) => ({ record: rowToRecord(SHEET_TABS.ORDER_ITEMS, row), rowNumber: itemTable.rowNumbers[i] }));
  const itemRows = allItemRows.filter((r) => liveIds.has(r.record.OrderID)).map((r) => ({ ...r, item: toOrderItem(r.record) }));
  const batchRows = batchTable.rows.map((row, i) => ({ record: rowToRecord(SHEET_TABS.BATCHES, row), rowNumber: batchTable.rowNumbers[i] })).map((r) => ({ ...r, batch: toBatch(r.record) }));
  const main = batchRows.filter((r) => normalizeStore(r.batch.store) === "").map((r) => r.batch);

  const plan = planTruckLoad({ items: itemRows.map((r) => r.item), batches: main, lines: input.lines ?? [], extras: input.extras ?? [], farm: input.farm });
  if (typeof plan === "string") throw new Error(plan);
  for (const s of plan.ship) {
    const o = live.find((x) => x.order.orderId === s.orderId)!;
    if (!o.order.managerConfirmed) throw new Error(`Заказ № ${orderCode(s.orderId)} ещё не подтверждён — отгружать его рано`);
  }

  const now = new Date().toISOString();
  const ops: WriteOp[] = [];
  const journal: Record<string, unknown>[] = [];
  const ship = (orderId: string, itemId: string, parts: { batchId: string; quantity: number }[]) => {
    for (const p of parts) journal.push({ ShipmentID: generateId("SHIP"), CreatedAt: now, OrderID: orderId, ItemID: itemId, BatchID: p.batchId, Quantity: p.quantity, WarehouseEmail: input.byEmail, Notes: "" });
  };

  // Остатки партий основного склада.
  const taken = new Map<string, number>();
  for (const part of [...plan.ship.flatMap((s) => s.parts), ...plan.extras.flatMap((e) => e.parts)]) taken.set(part.batchId, (taken.get(part.batchId) ?? 0) + part.quantity);
  const batchById = new Map(batchRows.map((r) => [r.batch.batchId, r]));
  for (const [batchId, qty] of taken) {
    const b = batchById.get(batchId)!;
    ops.push({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: b.rowNumber, changes: { QuantityRemaining: b.batch.quantityRemaining - qty } });
  }

  // Позиции заказов: отгружено и ответ склада. Рабочая копия — для пересчёта статусов.
  const after = new Map(itemRows.map((r) => [r.item.itemId, { orderId: r.item.orderId, quantity: r.item.quantity, shippedQuantity: r.item.shippedQuantity }]));
  const changes = new Map<string, Record<string, unknown>>();
  for (const s of plan.ship) {
    const total = s.parts.reduce((sum, p) => sum + p.quantity, 0);
    const a = after.get(s.itemId)!;
    a.shippedQuantity += total;
    changes.set(s.itemId, { ...(changes.get(s.itemId) ?? {}), ShippedQuantity: a.shippedQuantity });
    ship(s.orderId, s.itemId, s.parts);
  }
  for (const t of plan.trims) {
    const a = after.get(t.itemId)!;
    a.quantity = t.quantity;
    changes.set(t.itemId, { ...(changes.get(t.itemId) ?? {}), Quantity: t.quantity, AskedQuantity: t.asked, StockNote: t.note });
  }
  for (const [itemId, change] of changes) {
    const row = itemRows.find((r) => r.item.itemId === itemId)!;
    ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: row.rowNumber, changes: change });
  }

  // Позиции склада — в заявку «объём на город» этого дня; её нет — заводим.
  const note = String(input.note ?? "").trim().slice(0, 200);
  let newOrderId = "";
  const appendedItems: Record<string, unknown>[] = [];
  const extraAfter = new Map<string, { quantity: number; shippedQuantity: number }[]>();
  if (plan.extras.length > 0) {
    const spelled = plan.extras.map((e) => {
      // Сорт и длина — как записаны в партии, откуда едет цветок: приёмка города сверяет позицию с партией.
      const from = batchById.get(e.parts[0]?.batchId ?? "")?.batch;
      return { ...e, variety: from?.variety ?? e.variety, grade: from?.grade ?? e.grade };
    });
    const target = live.filter((o) => o.kind === "wholesale").sort((a, b) => (a.order.createdAt < b.order.createdAt ? -1 : 1))[0];
    if (target) {
      const ids = nextItemIds(target.order.orderId, allItemRows.filter((r) => r.record.OrderID === target.order.orderId).map((r) => r.record.ItemID), spelled.length);
      spelled.forEach((e, i) => {
        appendedItems.push({ OrderID: target.order.orderId, ItemID: ids[i], FlowerType: e.flowerType, Variety: e.variety, Grade: e.grade, Quantity: e.quantity, UnitPrice: 0, ShippedQuantity: e.quantity, PriceRub: "", AskedQuantity: "", StockNote: e.note });
        ship(target.order.orderId, ids[i], e.parts);
      });
      extraAfter.set(target.order.orderId, spelled.map((e) => ({ quantity: e.quantity, shippedQuantity: e.quantity })));
    } else {
      const built = buildNewOrder({
        kind: ORDER_KINDS.REGION,
        direction: info.label,
        clientId: "",
        clientName: info.label,
        clientPhone: "",
        deliveryDate: input.day,
        notes: `Отгрузка в ${info.label} без заказа города — завёл склад.${note ? ` ${note}` : ""}`,
        confirmed: true,
        items: spelled.map((e) => ({ flowerType: e.flowerType as NewOrderInput["items"][number]["flowerType"], variety: e.variety, grade: e.grade, quantity: e.quantity, unitPrice: 0 })),
        managerEmail: input.byEmail,
      });
      newOrderId = built.orderId;
      ops.push({ kind: "append", tab: SHEET_TABS.ORDERS, records: [{ ...built.orderRecord, Status: ORDER_STATUSES.SHIPPED }] });
      built.itemRecords.forEach((rec, i) => {
        appendedItems.push({ ...rec, Variety: spelled[i].variety, Grade: spelled[i].grade, ShippedQuantity: spelled[i].quantity, AskedQuantity: "", StockNote: spelled[i].note });
        ship(built.orderId, String(rec.ItemID), spelled[i].parts);
      });
    }
  }
  if (appendedItems.length > 0) ops.push({ kind: "append", tab: SHEET_TABS.ORDER_ITEMS, records: appendedItems });

  // Статусы заявок. Заказ, по которому склад не отгрузил НИЧЕГО и закрыл все позиции, — отменён: в очередях и отчётах
  // ему делать нечего, а город видит ответ склада по позициям.
  const touched = new Set<string>([...plan.ship.map((s) => s.orderId), ...plan.trims.map((t) => t.orderId), ...extraAfter.keys()]);
  const refused: string[] = [];
  for (const o of live) {
    if (!touched.has(o.order.orderId)) continue;
    const items = [...Array.from(after.values()).filter((a) => a.orderId === o.order.orderId), ...(extraAfter.get(o.order.orderId) ?? [])];
    const done = items.length > 0 && items.every((i) => i.shippedQuantity >= i.quantity);
    const nothing = items.reduce((s, i) => s + i.shippedQuantity, 0) === 0;
    const next = done && nothing ? ORDER_STATUSES.CANCELLED : statusAfterShipping(o.order.status, items);
    const change: Record<string, unknown> = {};
    if (next !== o.order.status) change.Status = next;
    const stamps: string[] = [];
    if (done && nothing) {
      stamps.push("Склад не отгрузил: позиций нет на складе.");
      refused.push(o.order.orderId);
    }
    if (note) stamps.push(`Склад: ${note}`);
    if (stamps.length > 0) change.Notes = [o.order.notes, ...stamps].filter(Boolean).join(" ").slice(0, 900);
    if (Object.keys(change).length > 0) ops.push({ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: o.rowNumber, changes: change });
  }
  if (journal.length > 0) ops.push({ kind: "append", tab: SHEET_TABS.SHIPMENTS, records: journal });

  await commitAtomic(ops);
  return {
    total: plan.total,
    closedShort: plan.closedShort,
    added: plan.extras.reduce((s, e) => s + e.quantity, 0),
    newOrderId,
    refused,
    orderIds: Array.from(new Set([...touched, ...(newOrderId ? [newOrderId] : [])])),
  };
}
