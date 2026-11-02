import { prefetchTables, SHEET_TABS } from "../sheets";
import { listBatches } from "./batches";
import { listOrdersWithItems } from "./orders";
import { listShipments } from "./shipments";
import { listWriteoffs } from "./writeoffs";
import { listStaffTakeouts } from "./staffTakeouts";
import { listPointDays } from "./point";
import { listPayments } from "./payments";
import { listPrices } from "./prices";
import { listUsers } from "./users";
import { nameIndex } from "../personName";
import { buildMonthReport, type MonthReport } from "../monthReport";

/** «Итоги месяца»: всё нужное читается одним `batchGet` (грабли 1.17) и считается `buildMonthReport`. */
export async function loadMonthReport(month: string, farm: string): Promise<MonthReport> {
  await prefetchTables([
    SHEET_TABS.BATCHES,
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.SHIPMENTS,
    SHEET_TABS.WRITEOFFS,
    SHEET_TABS.STAFF_TAKEOUTS,
    SHEET_TABS.POINT_SALES,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.PRICE_HISTORY,
  ]).catch(() => undefined);
  const [batches, orders, shipments, writeoffs, takeouts, pointDays, payments, priceRows, users] = await Promise.all([
    listBatches(),
    listOrdersWithItems(),
    listShipments(),
    listWriteoffs(),
    listStaffTakeouts().catch(() => []),
    listPointDays().catch(() => []),
    listPayments().catch(() => []),
    listPrices().catch(() => []),
    listUsers().catch(() => []),
  ]);
  const names = new Map<string, string>(Object.entries(nameIndex(users)));
  return buildMonthReport({ month, farm, batches, orders, shipments, writeoffs, takeouts, pointDays, payments, priceRows, names });
}
