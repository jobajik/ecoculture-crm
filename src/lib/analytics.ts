import { format, startOfWeek } from "date-fns";
import { listOrdersWithItems } from "./repo/orders";
import { listBatches } from "./repo/batches";
import { listWriteoffs } from "./repo/writeoffs";
import { listPriceHistory } from "./repo/priceHistory";
import { getSettings } from "./repo/settings";
import { computeBatchStorageInfo } from "./shelfLife";
import { getFarmFor } from "./constants";
import type { OrderWithItems } from "./types";

export interface StockByVarietyRow {
  key: string;
  flowerType: string;
  variety: string;
  quantity: number;
}

export interface StorageAlertRow {
  batchId: string;
  flowerType: string;
  variety: string;
  harvestDate: string;
  daysInStorage: number;
  maxDays: number;
  percentUsed: number;
  status: string;
  quantityRemaining: number;
}

export interface SalesWeekRow {
  weekStart: string;
  totalAmount: number;
  totalQuantity: number;
}

export interface SalesByManagerRow {
  managerEmail: string;
  orderCount: number;
  totalAmount: number;
  totalQuantity: number;
}

export interface SalesByVarietyRow {
  key: string;
  flowerType: string;
  variety: string;
  totalAmount: number;
  totalQuantity: number;
}

export interface PricePointRow {
  date: string;
  key: string;
  flowerType: string;
  variety: string;
  price: number;
}

export interface WriteoffSummary {
  totalWriteoffQuantity: number;
  totalReceivedQuantity: number;
  percentOfReceived: number;
  byReason: { reason: string; quantity: number }[];
  byMonth: { month: string; quantity: number }[];
}

export interface AnalyticsSummary {
  generatedAt: string;
  stockByVariety: StockByVarietyRow[];
  storage: {
    avgDaysInStorage: number;
    activeBatchCount: number;
    histogram: { label: string; count: number }[];
    alerts: StorageAlertRow[];
  };
  sales: {
    byWeek: SalesWeekRow[];
    byManager: SalesByManagerRow[];
    byVariety: SalesByVarietyRow[];
    totalOrders: number;
    totalRevenue: number;
    totalShippedStems: number;
  };
  priceDynamics: PricePointRow[];
  writeoffs: WriteoffSummary;
}

function varietyKey(flowerType: string, variety: string) {
  return `${flowerType}:${variety}`;
}

function computeStockByVariety(batches: Awaited<ReturnType<typeof listBatches>>): StockByVarietyRow[] {
  const map = new Map<string, StockByVarietyRow>();
  for (const b of batches) {
    if (b.quantityRemaining <= 0) continue;
    const key = varietyKey(b.flowerType, b.variety);
    const existing = map.get(key);
    if (existing) existing.quantity += b.quantityRemaining;
    else map.set(key, { key, flowerType: b.flowerType, variety: b.variety, quantity: b.quantityRemaining });
  }
  return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
}

function computeSales(orders: OrderWithItems[]) {
  const byWeekMap = new Map<string, SalesWeekRow>();
  const byManagerMap = new Map<string, SalesByManagerRow>();
  const byVarietyMap = new Map<string, SalesByVarietyRow>();
  let totalRevenue = 0;
  let totalShippedStems = 0;

  for (const order of orders) {
    if (order.status === "cancelled") continue;
    const created = new Date(order.createdAt);
    const weekStart = format(startOfWeek(created, { weekStartsOn: 1 }), "yyyy-MM-dd");

    const weekRow = byWeekMap.get(weekStart) ?? { weekStart, totalAmount: 0, totalQuantity: 0 };
    const managerRow = byManagerMap.get(order.managerEmail) ?? {
      managerEmail: order.managerEmail,
      orderCount: 0,
      totalAmount: 0,
      totalQuantity: 0,
    };
    managerRow.orderCount += 1;

    for (const item of order.items) {
      const amount = item.quantity * item.unitPrice;
      totalRevenue += amount;
      totalShippedStems += item.shippedQuantity;

      weekRow.totalAmount += amount;
      weekRow.totalQuantity += item.quantity;

      managerRow.totalAmount += amount;
      managerRow.totalQuantity += item.quantity;

      const vKey = varietyKey(item.flowerType, item.variety);
      const varietyRow = byVarietyMap.get(vKey) ?? {
        key: vKey,
        flowerType: item.flowerType,
        variety: item.variety,
        totalAmount: 0,
        totalQuantity: 0,
      };
      varietyRow.totalAmount += amount;
      varietyRow.totalQuantity += item.quantity;
      byVarietyMap.set(vKey, varietyRow);
    }

    byWeekMap.set(weekStart, weekRow);
    byManagerMap.set(order.managerEmail, managerRow);
  }

  return {
    byWeek: Array.from(byWeekMap.values()).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)),
    byManager: Array.from(byManagerMap.values()).sort((a, b) => b.totalAmount - a.totalAmount),
    byVariety: Array.from(byVarietyMap.values()).sort((a, b) => b.totalQuantity - a.totalQuantity),
    totalOrders: orders.filter((o) => o.status !== "cancelled").length,
    totalRevenue,
    totalShippedStems,
  };
}

function computeWriteoffSummary(
  writeoffs: Awaited<ReturnType<typeof listWriteoffs>>,
  batches: Awaited<ReturnType<typeof listBatches>>
): WriteoffSummary {
  const totalWriteoffQuantity = writeoffs.reduce((sum, w) => sum + w.quantity, 0);
  const totalReceivedQuantity = batches.reduce((sum, b) => sum + b.quantityIn, 0);
  const percentOfReceived = totalReceivedQuantity > 0 ? (totalWriteoffQuantity / totalReceivedQuantity) * 100 : 0;

  const byReasonMap = new Map<string, number>();
  const byMonthMap = new Map<string, number>();
  for (const w of writeoffs) {
    const reasonKey = w.reason?.trim() || "Не указана";
    byReasonMap.set(reasonKey, (byReasonMap.get(reasonKey) ?? 0) + w.quantity);
    const month = w.createdAt ? format(new Date(w.createdAt), "yyyy-MM") : "—";
    byMonthMap.set(month, (byMonthMap.get(month) ?? 0) + w.quantity);
  }

  return {
    totalWriteoffQuantity,
    totalReceivedQuantity,
    percentOfReceived,
    byReason: Array.from(byReasonMap.entries())
      .map(([reason, quantity]) => ({ reason, quantity }))
      .sort((a, b) => b.quantity - a.quantity),
    byMonth: Array.from(byMonthMap.entries())
      .map(([month, quantity]) => ({ month, quantity }))
      .sort((a, b) => (a.month < b.month ? -1 : 1)),
  };
}

/**
 * Сводная аналитика. `farmFilter` ограничивает всё производством: зав. складом
 * не должен видеть чужой цветок ни в остатках, ни в продажах, ни в ценах.
 * Фильтруем на входе — тогда все расчёты ниже автоматически считаются по своему.
 */
export async function getAnalyticsSummary(
  farmFilter?: string | null,
  /** Для тестов: подставить данные вместо чтения из Google-таблицы. */
  injected?: {
    orders: OrderWithItems[];
    batches: Awaited<ReturnType<typeof listBatches>>;
    writeoffs: Awaited<ReturnType<typeof listWriteoffs>>;
    priceHistory: Awaited<ReturnType<typeof listPriceHistory>>;
    settings: Awaited<ReturnType<typeof getSettings>>;
  }
): Promise<AnalyticsSummary> {
  const [allOrders, allBatches, allWriteoffs, allPriceHistory, settings] = injected
    ? [injected.orders, injected.batches, injected.writeoffs, injected.priceHistory, injected.settings]
    : await Promise.all([
        listOrdersWithItems(),
        listBatches(),
        listWriteoffs(),
        listPriceHistory(),
        getSettings(),
      ]);

  const mine = (flowerType: string) => !farmFilter || getFarmFor(flowerType) === farmFilter;

  const batches = allBatches.filter((b) => mine(b.flowerType));
  const priceHistory = allPriceHistory.filter((p) => mine(p.flowerType));

  // В заявке оставляем только свои позиции; заявки, где своего цветка нет, выпадают.
  const orders = farmFilter
    ? allOrders
        .map((o) => {
          const items = o.items.filter((i) => mine(i.flowerType));
          return {
            ...o,
            items,
            totalAmount: items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
          };
        })
        .filter((o) => o.items.length > 0)
    : allOrders;

  // Списание привязано к партии — берём тип цветка оттуда.
  const batchTypeById = new Map(allBatches.map((b) => [b.batchId, b.flowerType]));
  const writeoffs = farmFilter
    ? allWriteoffs.filter((w) => {
        const type = batchTypeById.get(w.batchId);
        return type ? mine(type) : false;
      })
    : allWriteoffs;

  const activeBatches = batches.filter((b) => b.quantityRemaining > 0);
  const storageInfos = activeBatches.map((b) => computeBatchStorageInfo(b, settings));
  const avgDaysInStorage =
    storageInfos.length > 0
      ? storageInfos.reduce((sum, s) => sum + s.daysInStorage, 0) / storageInfos.length
      : 0;

  const bucketDefs = [
    { label: "0-2 дня", max: 2 },
    { label: "3-5 дней", max: 5 },
    { label: "6-9 дней", max: 9 },
    { label: "10-14 дней", max: 14 },
    { label: "15+ дней", max: Infinity },
  ];
  const histogram = bucketDefs.map((b) => ({ label: b.label, count: 0 }));
  for (const info of storageInfos) {
    const idx = bucketDefs.findIndex((b) => info.daysInStorage <= b.max);
    histogram[idx === -1 ? histogram.length - 1 : idx].count += 1;
  }

  const alerts: StorageAlertRow[] = storageInfos
    .filter((s) => s.status === "warning" || s.status === "critical")
    .sort((a, b) => b.percentUsed - a.percentUsed)
    .map((s) => ({
      batchId: s.batch.batchId,
      flowerType: s.batch.flowerType,
      variety: s.batch.variety,
      harvestDate: s.batch.harvestDate,
      daysInStorage: s.daysInStorage,
      maxDays: s.maxDays,
      percentUsed: s.percentUsed,
      status: s.status,
      quantityRemaining: s.batch.quantityRemaining,
    }));

  const priceDynamics: PricePointRow[] = priceHistory.map((p) => ({
    date: p.date,
    key: varietyKey(p.flowerType, p.variety),
    flowerType: p.flowerType,
    variety: p.variety,
    price: p.price,
  }));

  return {
    generatedAt: new Date().toISOString(),
    stockByVariety: computeStockByVariety(batches),
    storage: {
      avgDaysInStorage,
      activeBatchCount: activeBatches.length,
      histogram,
      alerts,
    },
    sales: computeSales(orders),
    priceDynamics,
    writeoffs: computeWriteoffSummary(writeoffs, allBatches),
  };
}
