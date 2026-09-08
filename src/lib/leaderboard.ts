import { listOrdersWithItems } from "./repo/orders";
import { listUsers } from "./repo/users";
import { getPlansForPeriod } from "./repo/plans";
import { ORDER_STATUSES, bonusRateFor, getFarmFor } from "./constants";
import { periodRange, type FinancePeriod } from "./finance";
import type { OrderWithItems } from "./types";

// ---------------------------------------------------------------------------
// Лидерборд менеджеров: кто сколько продал, чего именно и какой бонус заработал.
//
// Бонус считается ПОПОЗИЦИОННО, а не от суммы заявки: ставка зависит от типа
// цветка (роза и эустома — 1,5 %, хризантема — 2 %), поэтому смешанную заявку
// нельзя умножить на один процент.
//
// База бонуса — только ОПЛАЧЕННЫЕ заявки. Оформленные, но не оплаченные, видны
// отдельной колонкой «в работе», чтобы менеджер понимал, что он недозаработал.
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  rank: number;
  managerEmail: string;
  name: string;
  /** Оплаченная выручка — то, с чего считается бонус. */
  paidAmount: number;
  /** Оформлено всего, включая неоплаченное. */
  totalAmount: number;
  /** Оформлено, но деньги ещё не пришли. */
  pendingAmount: number;
  paidStems: number;
  orders: number;
  paidOrders: number;
  /** Оплаченная выручка по типам цветка — из неё складывается бонус. */
  paidByFlowerType: Record<string, number>;
  /** Бонус по типам цветка: сколько дала роза, сколько хризантема. */
  bonusByFlowerType: Record<string, number>;
  bonus: number;
  /** Сколько бонуса «висит» в неоплаченных заявках. */
  pendingBonus: number;
  /** План месяца из вкладки Plans (только для периода «месяц»). */
  targetAmount: number;
  progressPercent: number;
  avgOrder: number;
}

export interface LeaderboardSnapshot {
  generatedAt: string;
  period: FinancePeriod;
  periodLabel: string;
  from: string;
  to: string;
  /** План показываем только на месяце — планы в таблице месячные. */
  hasPlans: boolean;
  rows: LeaderboardRow[];
  totals: {
    paidAmount: number;
    totalAmount: number;
    pendingAmount: number;
    bonus: number;
    orders: number;
    targetAmount: number;
  };
  /** Ставки бонуса — показываем прямо в интерфейсе, чтобы не было вопросов. */
  rates: { flowerType: string; percent: number }[];
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function monthKey(key: string): string {
  return key.slice(0, 7);
}

export async function getLeaderboard(
  period: FinancePeriod = "month",
  anchorDate?: string,
  now: Date = new Date(),
  injected?: {
    orders: OrderWithItems[];
    users: Awaited<ReturnType<typeof listUsers>>;
    plans: Map<string, { targetAmount: number; targetStems: number }>;
  }
): Promise<LeaderboardSnapshot> {
  const anchor =
    anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)
      ? new Date(Number(anchorDate.slice(0, 4)), Number(anchorDate.slice(5, 7)) - 1, Number(anchorDate.slice(8, 10)))
      : new Date(now);

  const { from, to, label } = periodRange(period, anchor);

  const [orders, users, plans] = injected
    ? [injected.orders, injected.users, injected.plans]
    : await Promise.all([listOrdersWithItems(), listUsers(), getPlansForPeriod(monthKey(from))]);

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const counted = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && o.createdAt);
  const inPeriod = counted.filter((o) => {
    const key = dayKey(new Date(o.createdAt));
    return key >= from && key <= to;
  });

  const map = new Map<string, LeaderboardRow>();
  const blank = (email: string): LeaderboardRow => ({
    rank: 0,
    managerEmail: email,
    name: nameByEmail.get(email) ?? email,
    paidAmount: 0,
    totalAmount: 0,
    pendingAmount: 0,
    paidStems: 0,
    orders: 0,
    paidOrders: 0,
    paidByFlowerType: {},
    bonusByFlowerType: {},
    bonus: 0,
    pendingBonus: 0,
    targetAmount: 0,
    progressPercent: 0,
    avgOrder: 0,
  });

  // Менеджеры с планом попадают в таблицу даже без продаж — виден ноль против плана.
  for (const user of users) {
    if (user.active && user.role === "manager") map.set(user.email, blank(user.email));
  }

  for (const order of inPeriod) {
    const email = order.managerEmail;
    const row = map.get(email) ?? blank(email);
    row.orders += 1;

    // Оплата бывает частичной, поэтому бонус начисляется от ОПЛАЧЕННОЙ ДОЛИ
    // заявки, а не от флага «оплачено». Клиент внёс половину — менеджер заработал
    // половину бонуса, вторая половина ждёт в «бонус ждёт». При полной оплате
    // доля равна единице, и всё считается как раньше.
    const total = order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const share = total > 0 ? Math.min(1, Math.max(0, order.paidAmount / total)) : 0;

    for (const item of order.items) {
      const amount = item.quantity * item.unitPrice;
      const rate = bonusRateFor(item.flowerType);
      row.totalAmount += amount;

      const paidPart = amount * share;
      const pendingPart = amount - paidPart;

      if (paidPart > 0) {
        row.paidAmount += paidPart;
        row.paidStems += item.quantity * share;
        row.paidByFlowerType[item.flowerType] =
          (row.paidByFlowerType[item.flowerType] ?? 0) + paidPart;
        row.bonusByFlowerType[item.flowerType] =
          (row.bonusByFlowerType[item.flowerType] ?? 0) + paidPart * rate;
        row.bonus += paidPart * rate;
      }
      if (pendingPart > 0) {
        row.pendingAmount += pendingPart;
        row.pendingBonus += pendingPart * rate;
      }
    }

    if (order.paid) row.paidOrders += 1;
    map.set(email, row);
  }

  const isMonth = period === "month";
  const rows = Array.from(map.values())
    .map((row) => {
      const target = isMonth ? plans.get(row.managerEmail)?.targetAmount ?? 0 : 0;
      return {
        ...row,
        // Доля оплаты даёт дробные стебли — показывать «1249,6 шт» незачем.
        paidStems: Math.round(row.paidStems),
        targetAmount: target,
        progressPercent: target > 0 ? (row.paidAmount / target) * 100 : 0,
        avgOrder: row.orders > 0 ? row.totalAmount / row.orders : 0,
      };
    })
    // Менеджеров без продаж и без плана в таблице не держим — она про результат.
    .filter((row) => row.orders > 0 || row.targetAmount > 0)
    .sort((a, b) => b.paidAmount - a.paidAmount || b.totalAmount - a.totalAmount)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  return {
    generatedAt: now.toISOString(),
    period,
    periodLabel: label,
    from,
    to,
    hasPlans: isMonth && rows.some((r) => r.targetAmount > 0),
    rows,
    totals: {
      paidAmount: rows.reduce((s, r) => s + r.paidAmount, 0),
      totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0),
      pendingAmount: rows.reduce((s, r) => s + r.pendingAmount, 0),
      bonus: rows.reduce((s, r) => s + r.bonus, 0),
      orders: rows.reduce((s, r) => s + r.orders, 0),
      targetAmount: rows.reduce((s, r) => s + r.targetAmount, 0),
    },
    rates: Object.entries({ rose: 0, eustoma: 0, chrysanthemum: 0 }).map(([flowerType]) => ({
      flowerType,
      percent: bonusRateFor(flowerType) * 100,
    })),
  };
}

/** Проверка правила бонуса отдельно — используется в тестовом скрипте. */
export function bonusForItem(flowerType: string, amount: number): number {
  return amount * bonusRateFor(flowerType);
}

export { getFarmFor };
