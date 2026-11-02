import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Склад Астаны появился 02.11.2026 — а фура, отгруженная раньше, на него не пришла (приход идёт только с новых отгрузок
 * «объёма на город», `regionArrivalWrites`). Этот скрипт кладёт на склад региона то, что было отгружено «объёмом на город»
 * с указанного дня: по журналу отгрузок, минус то, что уже пришло (журнал перемещений `to_region`), — повтор ничего не
 * задвоит. Без --yes — только показ; с --yes — копия таблицы и одна атомарная запись.
 *
 *   npx tsx scripts/region-store-backfill.ts <с ГГГГ-ММ-ДД> [astana] [--yes]
 */
import { commitAtomic, prefetchTables, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listStockMoves } from "../src/lib/repo/stockMoves";
import { toBatch } from "../src/lib/repo/batches";
import { isRegionOrder } from "../src/lib/orderKind";
import { normalizeStore, regionArrivalWrites, regionStoreForCity, storeLabel, type MoveBatchRow } from "../src/lib/officeStore";
import { generateId } from "../src/lib/id";
import { createBackup } from "../src/lib/backup";
import { localDayKey } from "../src/lib/timezone";
import { FLOWER_TYPE_LABELS, formatGrade, ORDER_STATUSES } from "../src/lib/constants";

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  const from = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const store = normalizeStore(args.find((a) => !a.startsWith("--") && !/^\d/.test(a)) || "astana");
  if (!from) throw new Error("Укажите день, с которого взять отгрузки: ГГГГ-ММ-ДД");
  if (!store) throw new Error("Склад региона не понят");

  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.SHIPMENTS, SHEET_TABS.STOCK_MOVES]);
  const [orders, shipments, moves] = await Promise.all([listOrdersWithItems(), listShipments(), listStockMoves()]);
  const regionOrders = new Map(
    orders.filter((o) => isRegionOrder(o) && o.status !== ORDER_STATUSES.CANCELLED && regionStoreForCity(o.direction) === store).map((o) => [o.orderId, o])
  );
  const shipped = new Map<string, number>();
  for (const s of shipments) {
    if (!regionOrders.has(s.orderId) || localDayKey(new Date(s.createdAt)) < from) continue;
    shipped.set(s.batchId, (shipped.get(s.batchId) ?? 0) + s.quantity);
  }
  // Уже пришло на склад региона из этих партий (новые отгрузки после включения склада и прошлые запуски скрипта).
  const batchTable = await readTable(SHEET_TABS.BATCHES, { fresh: true });
  const rows: MoveBatchRow[] = batchTable.rows.map((row, i) => ({ ...toBatch(rowToRecord(SHEET_TABS.BATCHES, row)), rowNumber: batchTable.rowNumbers[i] }));
  const regionIds = new Set(rows.filter((r) => normalizeStore(r.store) === store).map((r) => r.batchId));
  const arrived = new Map<string, number>();
  for (const m of moves) if (m.direction === "to_region" && regionIds.has(m.toBatchId)) arrived.set(m.fromBatchId, (arrived.get(m.fromBatchId) ?? 0) + m.quantity);

  const taken = Array.from(shipped.entries())
    .map(([batchId, q]) => ({ batchId, quantity: q - (arrived.get(batchId) ?? 0) }))
    .filter((t) => t.quantity > 0);
  const byId = new Map(rows.map((r) => [r.batchId, r]));
  const total = taken.reduce((s, t) => s + t.quantity, 0);
  console.log(`Склад «${storeLabel(store)}»: «объём на город» с ${from} — заявок ${regionOrders.size}, к приходу ${total.toLocaleString("ru-RU")} шт. из ${taken.length} партий.`);
  const byPos = new Map<string, number>();
  for (const t of taken) {
    const b = byId.get(t.batchId);
    const k = b ? `${FLOWER_TYPE_LABELS[b.flowerType] ?? b.flowerType} ${b.variety} · ${formatGrade(b.grade)}` : t.batchId;
    byPos.set(k, (byPos.get(k) ?? 0) + t.quantity);
  }
  for (const [k, q] of Array.from(byPos.entries()).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(40)} ${q.toLocaleString("ru-RU").padStart(8)}`);
  if (!taken.length) return console.log("Нечего добавлять.");
  if (!yes) return console.log("\nТолько показ. Записать — с --yes (сначала копия таблицы).");

  const backup = await createBackup(new Date(), () => undefined);
  console.log(`Копия таблицы: ${backup.url}`);
  const w = regionArrivalWrites({ store, taken, rows, byEmail: "backfill", newId: () => generateId("BATCH") });
  const ops: WriteOp[] = w.updates.map((u) => ({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: u.rowNumber, changes: { QuantityRemaining: u.quantityRemaining } }));
  if (w.appends.length) ops.push({ kind: "append", tab: SHEET_TABS.BATCHES, records: w.appends });
  const at = new Date().toISOString();
  ops.push({
    kind: "append",
    tab: SHEET_TABS.STOCK_MOVES,
    records: w.moves.map((m) => ({
      MoveID: generateId("MOVE"),
      CreatedAt: at,
      Direction: "to_region",
      FlowerType: m.flowerType,
      Variety: m.variety,
      Grade: m.grade,
      Quantity: m.quantity,
      FromBatchID: m.fromBatchId,
      ToBatchID: m.toBatchId,
      ByEmail: "backfill",
      Note: `Приход фуры до включения склада (отгрузки с ${from})`,
    })),
  });
  await commitAtomic(ops);
  console.log(`Записано: на склад «${storeLabel(store)}» ${total.toLocaleString("ru-RU")} шт.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
