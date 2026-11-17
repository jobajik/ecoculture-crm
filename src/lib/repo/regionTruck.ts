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
import { toOrder, toOrderItem } from "./orders";
import { listClients } from "./clients";

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
