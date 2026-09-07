import { listOrdersWithItems } from "./repo/orders";
import { listUsers } from "./repo/users";
import { ORDER_STATUSES, DEBT_OVERDUE_DAYS, getFarmFor } from "./constants";
import type { OrderWithItems } from "./types";

// ---------------------------------------------------------------------------
// Финансы для бухгалтера.
//
// Оплата в системе только целиком: заявка либо оплачена, либо нет (частичных
// сумм и предоплат нет — так решено сознательно, чтобы не плодить кликов).
// Поэтому «оплачено» — это сумма заявок с галочкой, а «долг» — сумма заявок
// без галочки. Отменённые заявки не считаются нигде.
//
// Период считается по дате ОФОРМЛЕНИЯ заявки — так же, как продажи менеджеров,
// чтобы цифры бухгалтера и цифры менеджеров сходились.
// ---------------------------------------------------------------------------

export type FinancePeriod = "day" | "week" | "month";

export interface FinanceOrderRow {
  orderId: string;
  createdAt: string;
  createdDate: string;
  deliveryDate: string;
  clientName: string;
  clientPhone: string;
  managerName: string;
  managerEmail: string;
  status: string;
  amount: number;
  stems: number;
  managerConfirmed: boolean;
  paid: boolean;
  paidAt: string;
  paymentMethod: string;
  /** Обе галочки — заявку можно собирать. */
  readyToCollect: boolean;
  positions: string;
}

export interface DebtRow {
  clientName: string;
  clientPhone: string;
  managerName: string;
  orders: number;
  amount: number;
  /** Дней с самой ранней неоплаченной даты доставки (или оформления). */
  oldestDays: number;
  overdue: boolean;
}

export interface FinanceDayPoint {
  date: string;
  label: string;
  paid: number;
  unpaid: number;
}

export interface FinanceTotals {
  amount: number;
  paidAmount: number;
  unpaidAmount: number;
  orders: number;
  paidOrders: number;
  collectPercent: number;
  avgOrder: number;
}

export interface FinanceSnapshot {
  generatedAt: string;
  period: FinancePeriod;
  periodLabel: string;
  from: string;
  to: string;
  totals: FinanceTotals;
  daily: FinanceDayPoint[];
  byMethod: { method: string; amount: number; orders: number }[];
  byManager: { managerName: string; amount: number; paidAmount: number; orders: number }[];
  byFarm: { farm: string; amount: number }[];
  orders: FinanceOrderRow[];
  /** Долги считаются по всей базе, а не за период — бухгалтеру нужны все висяки. */
  debts: DebtRow[];
  debtTotal: number;
  debtOverdueTotal: number;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Границы периода: день — сам день, неделя — Пн-Вс, месяц — календарный. */
export function periodRange(period: FinancePeriod, anchor: Date): { from: string; to: string; label: string } {
  if (period === "day") {
    const key = dayKey(anchor);
    return {
      from: key,
      to: key,
      label: anchor.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" }),
    };
  }

  if (period === "week") {
    const start = new Date(anchor);
    // getDay(): 0 = воскресенье. Неделя у нас начинается с понедельника.
    const shift = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - shift);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      from: dayKey(start),
      to: dayKey(end),
      label: `${start.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} — ${end.toLocaleDateString(
        "ru-RU",
        { day: "numeric", month: "long" }
      )}`,
    };
  }

  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return {
    from: dayKey(start),
    to: dayKey(end),
    label: start.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }),
  };
}

export async function getFinanceSnapshot(
  period: FinancePeriod = "day",
  anchorDate?: string,
  now: Date = new Date(),
  injected?: { orders: OrderWithItems[]; users: Awaited<ReturnType<typeof listUsers>> }
): Promise<FinanceSnapshot> {
  const anchor =
    anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate) ? parseKey(anchorDate) : new Date(now);

  const [orders, users] = injected
    ? [injected.orders, injected.users]
    : await Promise.all([listOrdersWithItems(), listUsers()]);

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const counted = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && o.createdAt);

  const { from, to, label } = periodRange(period, anchor);

  const toRow = (order: OrderWithItems): FinanceOrderRow => {
    const amount = order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    return {
      orderId: order.orderId,
      createdAt: order.createdAt,
      createdDate: dayKey(new Date(order.createdAt)),
      deliveryDate: order.deliveryDate || "",
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      managerName: nameByEmail.get(order.managerEmail) ?? order.managerEmail,
      managerEmail: order.managerEmail,
      status: order.status,
      amount,
      stems: order.items.reduce((s, i) => s + i.quantity, 0),
      managerConfirmed: order.managerConfirmed,
      paid: order.paid,
      paidAt: order.paidAt,
      paymentMethod: order.paymentMethod,
      readyToCollect: order.managerConfirmed && order.paid,
      positions: order.items.map((i) => `${i.variety} ${i.grade}`).join(", "),
    };
  };

  const allRows = counted.map(toRow);
  const periodRows = allRows.filter((r) => r.createdDate >= from && r.createdDate <= to);

  // --- Итоги периода ---
  const amount = periodRows.reduce((s, r) => s + r.amount, 0);
  const paidAmount = periodRows.filter((r) => r.paid).reduce((s, r) => s + r.amount, 0);
  const paidOrders = periodRows.filter((r) => r.paid).length;

  // --- По дням внутри периода ---
  const dayMap = new Map<string, { paid: number; unpaid: number }>();
  for (const r of periodRows) {
    const point = dayMap.get(r.createdDate) ?? { paid: 0, unpaid: 0 };
    if (r.paid) point.paid += r.amount;
    else point.unpaid += r.amount;
    dayMap.set(r.createdDate, point);
  }

  const daily: FinanceDayPoint[] = [];
  for (let d = parseKey(from); dayKey(d) <= to; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    const point = dayMap.get(key) ?? { paid: 0, unpaid: 0 };
    daily.push({
      date: key,
      label: parseKey(key).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
      paid: point.paid,
      unpaid: point.unpaid,
    });
  }

  // --- Разрезы периода ---
  const methodMap = new Map<string, { amount: number; orders: number }>();
  for (const r of periodRows.filter((x) => x.paid)) {
    const key = r.paymentMethod || "не указан";
    const m = methodMap.get(key) ?? { amount: 0, orders: 0 };
    m.amount += r.amount;
    m.orders += 1;
    methodMap.set(key, m);
  }

  const managerMap = new Map<string, { managerName: string; amount: number; paidAmount: number; orders: number }>();
  for (const r of periodRows) {
    const m = managerMap.get(r.managerEmail) ?? {
      managerName: r.managerName,
      amount: 0,
      paidAmount: 0,
      orders: 0,
    };
    m.amount += r.amount;
    if (r.paid) m.paidAmount += r.amount;
    m.orders += 1;
    managerMap.set(r.managerEmail, m);
  }

  const farmMap = new Map<string, number>();
  for (const order of counted) {
    const key = dayKey(new Date(order.createdAt));
    if (key < from || key > to) continue;
    for (const item of order.items) {
      const farm = getFarmFor(item.flowerType) ?? "";
      farmMap.set(farm, (farmMap.get(farm) ?? 0) + item.quantity * item.unitPrice);
    }
  }

  // --- Долги: по всей базе, не только за период ---
  const debtMap = new Map<string, DebtRow & { oldest: string }>();
  for (const r of allRows) {
    if (r.paid) continue;
    const key = r.clientName.trim().toLowerCase() || r.orderId;
    // Возраст долга считаем от даты доставки; если её нет — от даты оформления.
    const basis = r.deliveryDate || r.createdDate;
    const row = debtMap.get(key) ?? {
      clientName: r.clientName || "(без названия)",
      clientPhone: r.clientPhone,
      managerName: r.managerName,
      orders: 0,
      amount: 0,
      oldestDays: 0,
      overdue: false,
      oldest: basis,
    };
    row.orders += 1;
    row.amount += r.amount;
    if (basis < row.oldest) row.oldest = basis;
    if (!row.clientPhone && r.clientPhone) row.clientPhone = r.clientPhone;
    debtMap.set(key, row);
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const debts: DebtRow[] = Array.from(debtMap.values())
    .map(({ oldest, ...row }) => {
      const days = Math.max(0, daysBetween(parseKey(oldest), today));
      return { ...row, oldestDays: days, overdue: days > DEBT_OVERDUE_DAYS };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    generatedAt: now.toISOString(),
    period,
    periodLabel: label,
    from,
    to,
    totals: {
      amount,
      paidAmount,
      unpaidAmount: amount - paidAmount,
      orders: periodRows.length,
      paidOrders,
      collectPercent: amount > 0 ? (paidAmount / amount) * 100 : 0,
      avgOrder: periodRows.length > 0 ? amount / periodRows.length : 0,
    },
    daily,
    byMethod: Array.from(methodMap.entries())
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.amount - a.amount),
    byManager: Array.from(managerMap.values()).sort((a, b) => b.amount - a.amount),
    byFarm: Array.from(farmMap.entries())
      .map(([farm, amt]) => ({ farm, amount: amt }))
      .sort((a, b) => b.amount - a.amount),
    orders: periodRows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    debts,
    debtTotal: debts.reduce((s, d) => s + d.amount, 0),
    debtOverdueTotal: debts.filter((d) => d.overdue).reduce((s, d) => s + d.amount, 0),
  };
}
