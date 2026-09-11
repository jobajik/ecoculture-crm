import { listOrdersWithItems } from "./repo/orders";
import { listUsers } from "./repo/users";
import { getPlansForPeriod } from "./repo/plans";
import { ORDER_STATUSES, getFarmFor } from "./constants";
import type { OrderWithItems } from "./types";
import { hasNoClientInvoice } from "./orderKind";
import {
  PLAN_FLOWERS,
  planByFlower,
  unsplitPlanAmount,
  type ManagerPlanTotal,
} from "./managerPlans";

// ---------------------------------------------------------------------------
// Продажи менеджеров: факт за день и за месяц против плана.
//
// Продажа засчитывается по дате оформления заявки (а не отгрузки) — так принято
// считать работу менеджера. Отменённые заявки не учитываются.
// ---------------------------------------------------------------------------

export interface ManagerSalesRow {
  managerEmail: string;
  name: string;
  amountMonth: number;
  stemsMonth: number;
  ordersMonth: number;
  amountToday: number;
  ordersToday: number;
  targetAmount: number;
  targetStems: number;
  progressPercent: number;
  avgOrderAmount: number;
  /** Сколько менеджер продал цветка каждого производства за месяц. */
  byFarm: Record<string, number>;
}

/** Итог месяца по производству: Rose Farm (розы, эустома) и Есентай Агро Хим (хризантема). */
export interface FarmSalesRow {
  farm: string;
  amount: number;
  stems: number;
  share: number;
}

/**
 * План против факта по цветку.
 *
 * План менеджерам ставится по цветкам (`managerPlans.ts`), и выполнение обязано
 * считаться в том же разрезе: «сделали 90 % плана» одной розой и провалом по
 * хризантеме — это две разные новости, а в общей цифре они неразличимы.
 *
 * Фильтруются ПОЗИЦИИ заявок, а не заявки целиком: в одной заявке едут и роза,
 * и хризантема. Та же ошибка уже ловилась на странице регионов.
 */
export interface FlowerSalesRow {
  flowerType: string;
  amount: number;
  stems: number;
  targetAmount: number;
  targetStems: number;
  /** Выполнение по деньгам; null — плана по этому цветку нет, сравнивать не с чем. */
  progressPercent: number | null;
}

export interface SalesDayPoint {
  date: string;
  amount: number;
  stems: number;
  cumulative: number;
  planCumulative: number;
}

export interface SalesTotals {
  amountMonth: number;
  stemsMonth: number;
  ordersMonth: number;
  amountToday: number;
  ordersToday: number;
  targetAmount: number;
  targetStems: number;
  progressPercent: number;
  /** Прогноз на конец месяца по текущему темпу. */
  forecastAmount: number;
  daysPassed: number;
  daysInMonth: number;
  /** Сколько нужно продавать в день в оставшиеся дни, чтобы выйти на план. */
  requiredPerDay: number;
}

export interface SalesSnapshot {
  generatedAt: string;
  period: string;
  periodLabel: string;
  today: string;
  totals: SalesTotals;
  managers: ManagerSalesRow[];
  byFarm: FarmSalesRow[];
  byFlower: FlowerSalesRow[];
  /** Сколько плана ещё стоит старым числом, без разбивки по цветку. */
  unsplitTargetAmount: number;
  daily: SalesDayPoint[];
  availablePeriods: string[];
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function orderAmount(order: OrderWithItems): number {
  return order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
}

function orderStems(order: OrderWithItems): number {
  return order.items.reduce((sum, i) => sum + i.quantity, 0);
}

export async function getSalesSnapshot(
  period?: string,
  now: Date = new Date(),
  injected?: {
    orders: OrderWithItems[];
    users: Awaited<ReturnType<typeof listUsers>>;
    plans: Map<string, ManagerPlanTotal>;
  }
): Promise<SalesSnapshot> {
  const targetPeriod = period && /^\d{4}-\d{2}$/.test(period) ? period : monthKey(now);

  const [orders, users, plans] = injected
    ? [injected.orders, injected.users, injected.plans]
    : await Promise.all([listOrdersWithItems(), listUsers(), getPlansForPeriod(targetPeriod)]);

  // Внутренние перемещения в наши магазины продажами не считаются — иначе
  // план-факт менеджеров выполнялся бы за счёт собственной розницы.
  const counted = orders.filter(
    (o) => o.status !== ORDER_STATUSES.CANCELLED && o.createdAt && !hasNoClientInvoice(o)
  );
  const monthOrders = counted.filter((o) => monthKey(new Date(o.createdAt)) === targetPeriod);
  const todayKey = dayKey(now);

  // Список месяцев, за которые вообще есть данные — для переключателя периода.
  const availablePeriods = Array.from(
    new Set([targetPeriod, ...counted.map((o) => monthKey(new Date(o.createdAt)))])
  ).sort((a, b) => (a > b ? -1 : 1));

  const [year, month] = targetPeriod.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = targetPeriod === monthKey(now);
  const daysPassed = isCurrentMonth ? now.getDate() : daysInMonth;

  // --- По менеджерам ---
  const rowsByEmail = new Map<string, ManagerSalesRow>();

  const ensureRow = (email: string): ManagerSalesRow => {
    const key = email.toLowerCase();
    let row = rowsByEmail.get(key);
    if (!row) {
      const user = users.find((u) => u.email === key);
      const plan = plans.get(key);
      row = {
        managerEmail: key,
        name: user?.name || key,
        amountMonth: 0,
        stemsMonth: 0,
        ordersMonth: 0,
        amountToday: 0,
        ordersToday: 0,
        targetAmount: plan?.targetAmount ?? 0,
        targetStems: plan?.targetStems ?? 0,
        progressPercent: 0,
        avgOrderAmount: 0,
        byFarm: {},
      };
      rowsByEmail.set(key, row);
    }
    return row;
  };

  // Менеджеры и админы попадают в отчёт даже без продаж — чтобы был виден ноль против плана.
  for (const user of users) {
    if (!user.active) continue;
    if (user.role === "manager" || user.role === "admin") ensureRow(user.email);
  }
  for (const email of plans.keys()) ensureRow(email);

  // Итоги месяца по производствам и по цветкам.
  const farmMap = new Map<string, { amount: number; stems: number }>();
  const flowerMap = new Map<string, { amount: number; stems: number }>();

  for (const order of monthOrders) {
    const row = ensureRow(order.managerEmail);
    const amount = orderAmount(order);
    const stems = orderStems(order);
    row.amountMonth += amount;
    row.stemsMonth += stems;
    row.ordersMonth += 1;
    if (dayKey(new Date(order.createdAt)) === todayKey) {
      row.amountToday += amount;
      row.ordersToday += 1;
    }

    for (const item of order.items) {
      const itemAmount = item.quantity * item.unitPrice;
      const farm = getFarmFor(item.flowerType) ?? "";
      row.byFarm[farm] = (row.byFarm[farm] ?? 0) + itemAmount;
      const farmRow = farmMap.get(farm) ?? { amount: 0, stems: 0 };
      farmRow.amount += itemAmount;
      farmRow.stems += item.quantity;
      farmMap.set(farm, farmRow);

      const flowerRow = flowerMap.get(item.flowerType) ?? { amount: 0, stems: 0 };
      flowerRow.amount += itemAmount;
      flowerRow.stems += item.quantity;
      flowerMap.set(item.flowerType, flowerRow);
    }
  }

  // План по цветкам берётся у ВСЕХ менеджеров месяца, а не только у тех, кто
  // попал в таблицу продаж: план уволенного или заболевшего — это всё ещё план
  // отдела, и молча вычесть его значило бы показать выполнение лучше, чем есть.
  const planFlowers = planByFlower(plans.values());
  const byFlower: FlowerSalesRow[] = PLAN_FLOWERS.map((flowerType) => {
    const fact = flowerMap.get(flowerType) ?? { amount: 0, stems: 0 };
    const plan = planFlowers[flowerType] ?? { targetAmount: 0, targetStems: 0 };
    return {
      flowerType,
      amount: fact.amount,
      stems: fact.stems,
      targetAmount: plan.targetAmount,
      targetStems: plan.targetStems,
      progressPercent:
        plan.targetAmount > 0 ? (fact.amount / plan.targetAmount) * 100 : null,
    };
  }).filter((row) => row.amount > 0 || row.targetAmount > 0 || row.targetStems > 0);

  const managers = Array.from(rowsByEmail.values())
    .map((row) => ({
      ...row,
      progressPercent: row.targetAmount > 0 ? (row.amountMonth / row.targetAmount) * 100 : 0,
      avgOrderAmount: row.ordersMonth > 0 ? row.amountMonth / row.ordersMonth : 0,
    }))
    // Сначала те, кто продаёт; менеджеры без продаж и без плана — в конце.
    .filter((row) => row.amountMonth > 0 || row.targetAmount > 0 || row.ordersMonth > 0)
    .sort((a, b) => b.amountMonth - a.amountMonth);

  // --- Итоги ---
  const amountMonth = managers.reduce((sum, r) => sum + r.amountMonth, 0);
  const stemsMonth = managers.reduce((sum, r) => sum + r.stemsMonth, 0);
  const ordersMonth = managers.reduce((sum, r) => sum + r.ordersMonth, 0);
  const amountToday = managers.reduce((sum, r) => sum + r.amountToday, 0);
  const ordersToday = managers.reduce((sum, r) => sum + r.ordersToday, 0);
  const targetAmount = managers.reduce((sum, r) => sum + r.targetAmount, 0);
  const targetStems = managers.reduce((sum, r) => sum + r.targetStems, 0);

  const forecastAmount = daysPassed > 0 ? (amountMonth / daysPassed) * daysInMonth : 0;
  const daysLeft = Math.max(0, daysInMonth - daysPassed);
  const requiredPerDay =
    targetAmount > amountMonth && daysLeft > 0 ? (targetAmount - amountMonth) / daysLeft : 0;

  // --- По дням месяца ---
  const dailyMap = new Map<string, { amount: number; stems: number }>();
  for (const order of monthOrders) {
    const key = dayKey(new Date(order.createdAt));
    const point = dailyMap.get(key) ?? { amount: 0, stems: 0 };
    point.amount += orderAmount(order);
    point.stems += orderStems(order);
    dailyMap.set(key, point);
  }

  const daily: SalesDayPoint[] = [];
  let cumulative = 0;
  const planPerDay = targetAmount / daysInMonth;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${targetPeriod}-${String(d).padStart(2, "0")}`;
    const point = dailyMap.get(key) ?? { amount: 0, stems: 0 };
    cumulative += point.amount;
    // Для будущих дней текущего месяца накопительный факт не рисуем.
    const isFuture = isCurrentMonth && d > now.getDate();
    daily.push({
      date: key,
      amount: point.amount,
      stems: point.stems,
      cumulative: isFuture ? NaN : cumulative,
      planCumulative: planPerDay * d,
    });
  }

  const periodLabel = new Date(year, month - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });

  return {
    generatedAt: now.toISOString(),
    period: targetPeriod,
    periodLabel,
    today: todayKey,
    totals: {
      amountMonth,
      stemsMonth,
      ordersMonth,
      amountToday,
      ordersToday,
      targetAmount,
      targetStems,
      progressPercent: targetAmount > 0 ? (amountMonth / targetAmount) * 100 : 0,
      forecastAmount,
      daysPassed,
      daysInMonth,
      requiredPerDay,
    },
    managers,
    byFarm: Array.from(farmMap.entries())
      .map(([farm, v]) => ({
        farm,
        amount: v.amount,
        stems: v.stems,
        share: amountMonth > 0 ? (v.amount / amountMonth) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    byFlower,
    unsplitTargetAmount: unsplitPlanAmount(plans.values()),
    daily,
    availablePeriods,
  };
}
