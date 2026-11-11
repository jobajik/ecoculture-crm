import { prefetchTables, SHEET_TABS } from "../sheets";
import { listBatches } from "./batches";
import { listOrdersWithItems } from "./orders";
import { listShipments } from "./shipments";
import { listWriteoffs } from "./writeoffs";
import { listStaffTakeouts } from "./staffTakeouts";
import { listStockMoves } from "./stockMoves";
import { listHarvestForecast } from "./harvestForecast";
import { listPrices } from "./prices";
import { listUsers } from "./users";
import { nameIndex } from "../personName";
import { localDayKey } from "../timezone";
import { buildFlowReport, planMonthOf, type FlowReport } from "../flowReport";
import { listPlans } from "./plans";
import { aggregateManagerPlans } from "../managerPlans";

/** «Срез · продажи · списания»: всё нужное читается одним `batchGet` (грабли 1.17) и считается `buildFlowReport`. */
export async function loadFlowReport(from: string, to: string, farm: string, flower: string): Promise<FlowReport> {
  await prefetchTables([
    SHEET_TABS.BATCHES,
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.SHIPMENTS,
    SHEET_TABS.WRITEOFFS,
    SHEET_TABS.STAFF_TAKEOUTS,
    SHEET_TABS.STOCK_MOVES,
    SHEET_TABS.HARVEST_FORECAST,
    SHEET_TABS.PRICE_HISTORY,
    SHEET_TABS.PLANS,
  ]).catch(() => undefined);
  const planMonth = planMonthOf(from, to);
  const [batches, orders, shipments, writeoffs, takeouts, moves, forecast, priceRows, users, planRows] = await Promise.all([
    listBatches(),
    listOrdersWithItems(),
    listShipments(),
    listWriteoffs(),
    listStaffTakeouts().catch(() => []),
    listStockMoves().catch(() => []),
    listHarvestForecast().catch(() => []),
    listPrices().catch(() => []),
    listUsers().catch(() => []),
    planMonth ? listPlans().catch(() => []) : Promise.resolve([]),
  ]);
  const names = new Map<string, string>(Object.entries(nameIndex(users)));
  return buildFlowReport({ from, to, farm, flower, today: localDayKey(), batches, orders, shipments, writeoffs, takeouts, moves, forecast, priceRows, names, plans: planMonth ? aggregateManagerPlans(planRows, planMonth) : undefined });
}
