import { listOrdersWithItems } from "./repo/orders";
import { listUsers } from "./repo/users";
import { ORDER_STATUSES, getFarmFor } from "./constants";
import type { OrderWithItems } from "./types";
import { isRetailOrder } from "./retail";

// ---------------------------------------------------------------------------
// Дневной срез продаж: кто из менеджеров что продал сегодня, каких цветов и
// сколько. Обновляется в реальном времени на странице «Продажи за день».
// ---------------------------------------------------------------------------

export interface DailyManagerRow {
  managerEmail: string;
  name: string;
  amount: number;
  stems: number;
  orders: number;
  /** Разбивка по типам цветка — видно, кто на чём делает выручку. */
  byFlowerType: Record<string, number>;
}

export interface DailyFarmRow {
  farm: string;
  amount: number;
  stems: number;
  share: number;
}

export interface DailyFlowerTypeRow {
  flowerType: string;
  amount: number;
  stems: number;
  share: number;
}

export interface DailyVarietyRow {
  key: string;
  flowerType: string;
  variety: string;
  grade: string;
  stems: number;
  amount: number;
}

export interface DailyOrderRow {
  orderId: string;
  time: string;
  managerName: string;
  clientName: string;
  stems: number;
  amount: number;
  positions: string;
  status: string;
}

export interface DailySalesSnapshot {
  generatedAt: string;
  date: string;
  dateLabel: string;
  isToday: boolean;
  totals: {
    amount: number;
    stems: number;
    orders: number;
    avgOrder: number;
    /** Тот же день неделей ранее не берём — сравниваем с предыдущим днём. */
    prevAmount: number;
    changePercent: number;
  };
  managers: DailyManagerRow[];
  byFlowerType: DailyFlowerTypeRow[];
  byFarm: DailyFarmRow[];
  varieties: DailyVarietyRow[];
  orders: DailyOrderRow[];
  hourly: { hour: string; amount: number }[];
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export async function getDailySalesSnapshot(
  date?: string,
  now: Date = new Date(),
  injected?: { orders: OrderWithItems[]; users: Awaited<ReturnType<typeof listUsers>> }
): Promise<DailySalesSnapshot> {
  const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dayKey(now);

  const [orders, users] = injected
    ? [injected.orders, injected.users]
    : await Promise.all([listOrdersWithItems(), listUsers()]);

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  // «Сколько продали сегодня» — про продажи наружу. Розница считается
  // отдельно, в своём разделе.
  const counted = orders.filter(
    (o) => o.status !== ORDER_STATUSES.CANCELLED && o.createdAt && !isRetailOrder(o)
  );

  const dayOrders = counted.filter((o) => dayKey(new Date(o.createdAt)) === targetDate);

  // Предыдущий день — для сравнения «больше/меньше вчерашнего».
  const prevDate = new Date(targetDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevKey = dayKey(prevDate);
  const prevAmount = counted
    .filter((o) => dayKey(new Date(o.createdAt)) === prevKey)
    .reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0), 0);

  const managerMap = new Map<string, DailyManagerRow>();
  const typeMap = new Map<string, { amount: number; stems: number }>();
  const farmMap = new Map<string, { amount: number; stems: number }>();
  const varietyMap = new Map<string, DailyVarietyRow>();
  const hourMap = new Map<number, number>();

  let amount = 0;
  let stems = 0;

  for (const order of dayOrders) {
    const created = new Date(order.createdAt);
    const managerKey = order.managerEmail;
    const managerRow =
      managerMap.get(managerKey) ??
      ({
        managerEmail: managerKey,
        name: nameByEmail.get(managerKey) ?? managerKey,
        amount: 0,
        stems: 0,
        orders: 0,
        byFlowerType: {},
      } satisfies DailyManagerRow);
    managerRow.orders += 1;

    let orderAmount = 0;
    for (const item of order.items) {
      const itemAmount = item.quantity * item.unitPrice;
      orderAmount += itemAmount;
      amount += itemAmount;
      stems += item.quantity;

      managerRow.amount += itemAmount;
      managerRow.stems += item.quantity;
      managerRow.byFlowerType[item.flowerType] =
        (managerRow.byFlowerType[item.flowerType] ?? 0) + itemAmount;

      const typeRow = typeMap.get(item.flowerType) ?? { amount: 0, stems: 0 };
      typeRow.amount += itemAmount;
      typeRow.stems += item.quantity;
      typeMap.set(item.flowerType, typeRow);

      const farmKey = getFarmFor(item.flowerType) ?? "";
      const farmRow = farmMap.get(farmKey) ?? { amount: 0, stems: 0 };
      farmRow.amount += itemAmount;
      farmRow.stems += item.quantity;
      farmMap.set(farmKey, farmRow);

      const vKey = `${item.flowerType}|${item.variety}|${item.grade}`;
      const varietyRow = varietyMap.get(vKey) ?? {
        key: vKey,
        flowerType: item.flowerType,
        variety: item.variety,
        grade: item.grade,
        stems: 0,
        amount: 0,
      };
      varietyRow.stems += item.quantity;
      varietyRow.amount += itemAmount;
      varietyMap.set(vKey, varietyRow);
    }

    managerMap.set(managerKey, managerRow);
    hourMap.set(created.getHours(), (hourMap.get(created.getHours()) ?? 0) + orderAmount);
  }

  const ordersFeed: DailyOrderRow[] = dayOrders
    .map((order) => ({
      orderId: order.orderId,
      time: new Date(order.createdAt).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      managerName: nameByEmail.get(order.managerEmail) ?? order.managerEmail,
      clientName: order.clientName,
      stems: order.items.reduce((s, i) => s + i.quantity, 0),
      amount: order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
      positions: order.items.map((i) => `${i.variety} ${i.grade}`).join(", "),
      status: order.status,
    }))
    .sort((a, b) => (a.time < b.time ? 1 : -1));

  const [y, m, d] = targetDate.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });

  return {
    generatedAt: now.toISOString(),
    date: targetDate,
    dateLabel,
    isToday: targetDate === dayKey(now),
    totals: {
      amount,
      stems,
      orders: dayOrders.length,
      avgOrder: dayOrders.length > 0 ? amount / dayOrders.length : 0,
      prevAmount,
      changePercent: prevAmount > 0 ? ((amount - prevAmount) / prevAmount) * 100 : 0,
    },
    managers: Array.from(managerMap.values()).sort((a, b) => b.amount - a.amount),
    byFarm: Array.from(farmMap.entries())
      .map(([farm, v]) => ({
        farm,
        amount: v.amount,
        stems: v.stems,
        share: amount > 0 ? (v.amount / amount) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    byFlowerType: Array.from(typeMap.entries())
      .map(([flowerType, v]) => ({
        flowerType,
        amount: v.amount,
        stems: v.stems,
        share: amount > 0 ? (v.amount / amount) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    varieties: Array.from(varietyMap.values()).sort((a, b) => b.stems - a.stems),
    orders: ordersFeed,
    hourly: Array.from({ length: 24 }, (_, h) => ({
      hour: `${String(h).padStart(2, "0")}:00`,
      amount: hourMap.get(h) ?? 0,
    })).filter((point, idx) => idx >= 6 && idx <= 21),
  };
}
