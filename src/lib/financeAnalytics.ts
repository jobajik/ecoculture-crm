import {
  DEBT_OVERDUE_DAYS,
  FARM_ORDER,
  MONEY_EPSILON,
  ORDER_STATUSES,
  farmLabel,
  getFarmFor,
  periodShift,
  weeksOfMonth,
} from "./constants";
import { hasNoClientInvoice, isConsignment, isRegionOrder } from "./orderKind";
import { invoiceByFarm, paidByFarm } from "./orderMoney";
import { splitPaymentByFlower } from "./cashByFlower";
import { toIsoDate } from "./sheetDate";
import type { OrderWithItems, Payment } from "./types";

// ---------------------------------------------------------------------------
// «Оплаты → Аналитика»: деньги за месяц в сравнении с прошлым.
//
// Две оси времени, и путать их нельзя (как в «Кассе по цветкам»):
//
// - **выставлено** — счета заявок, ОФОРМЛЕННЫХ в месяце (как продажи менеджеров
//   и остальные цифры «Оплат»); «собрано» — сколько по ним уже пришло;
// - **поступило** — деньги, ПРИШЕДШИЕ в месяце, за какие угодно заявки. Берётся
//   из журнала платежей по дню поступления. Деньги, внесённые до журнала одной
//   суммой (итог заявки больше суммы её платежей), ставятся на день первой
//   оплаты `PaidAt` — другого дня у них нет.
//
// Долг — СЕЙЧАС, по всей базе (как в «Долгах и звонках»): остаток по заявке,
// реализация (пожарка) долгом не считается, просрочка — от дня доставки (нет —
// от дня оформления) дольше `DEBT_OVERDUE_DAYS`.
//
// Считаются только заявки со счётом: отменённые, наши магазины и опт на город
// не выставляются. Поступления по опту на город в «поступило» входят (деньги-то
// пришли) и показываются отдельной строкой.
// ---------------------------------------------------------------------------

export interface FinanceMonth {
  /** Счета заявок, оформленных в месяце. */
  billed: number;
  orders: number;
  /** Из них уже пришло (не больше счёта). */
  collected: number;
  /** Пришло за месяц по дню поступления. */
  cashIn: number;
  /** Из него — поступления по опту на город. */
  cashInRegions: number;
  /** Строк журнала (поступлений) за месяц. */
  paymentLines: number;
  /** Медиана дней от доставки до полной оплаты по заявкам, закрытым в месяце. */
  daysToPay: number | null;
  /** Закрыто оплатой в месяце. */
  closedOrders: number;
  /** Из них оплачено до дня доставки. */
  prepaidOrders: number;
}

export interface FinanceBreakdownRow {
  key: string;
  label: string;
  orders: number;
  billed: number;
  prevBilled: number;
  /** Доля в выставленном, 0–100. */
  share: number;
  collected: number;
  /** Собрано от выставленного за месяц, 0–100; null — счетов нет. */
  collectedPercent: number | null;
  /** Поступило за месяц по дню поступления. */
  cashIn: number;
  prevCashIn: number;
  /** Долг сейчас (по всей базе). */
  debt: number;
  overdue: number;
  daysToPay: number | null;
}

export interface AgingBucket {
  key: string;
  label: string;
  amount: number;
  orders: number;
}

export interface DebtorRow {
  clientKey: string;
  clientId: string;
  name: string;
  managerName: string;
  orders: number;
  debt: number;
  overdue: number;
  /** Сколько дней самой старой неоплаченной заявке (от доставки). */
  oldestDays: number;
  /** Обещал заплатить: самая поздняя дата из обещаний по его долгам. */
  promisedAt: string;
  brokenPromise: boolean;
  terms: string;
}

export interface FinanceWeek {
  label: string;
  billed: number;
  cashIn: number;
  future: boolean;
}

export interface FinanceAnalytics {
  period: string;
  prevPeriod: string;
  current: FinanceMonth;
  previous: FinanceMonth;
  debt: {
    total: number;
    overdue: number;
    orders: number;
    clients: number;
    /** Остаток по реализации (пожарка) — не долг, но деньги ещё не пришли. */
    onConsignment: number;
    /** Обещали и не заплатили. */
    brokenPromises: number;
    brokenAmount: number;
    /** Отгружено целиком, а денег нет. */
    shippedUnpaid: number;
    aging: AgingBucket[];
  };
  byManager: FinanceBreakdownRow[];
  byCompany: FinanceBreakdownRow[];
  byMethod: FinanceBreakdownRow[];
  byTerms: FinanceBreakdownRow[];
  weeks: FinanceWeek[];
  debtors: DebtorRow[];
  /** Переплата по всей базе. */
  overpaid: number;
  /** Счёт отправлен (отметка есть) у заявок месяца. */
  invoiceMarked: number;
}

export const AGING_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: "ahead", label: "доставка впереди", min: -Infinity, max: -1 },
  { key: "0-3", label: "0–3 дня", min: 0, max: DEBT_OVERDUE_DAYS },
  { key: "4-7", label: "4–7 дней", min: DEBT_OVERDUE_DAYS + 1, max: 7 },
  { key: "8-14", label: "8–14 дней", min: 8, max: 14 },
  { key: "15-30", label: "15–30 дней", min: 15, max: 30 },
  { key: "30+", label: "больше 30", min: 31, max: Infinity },
];

const NO_METHOD = "не указан";
const NO_TERMS = "условия не указаны";

const day = (s: string | null | undefined) => toIsoDate(s || "").slice(0, 10);
const monthOf = (d: string) => d.slice(0, 7);
const amountOf = (o: OrderWithItems) => o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Поступление — деньги с днём, заявкой, способом и компанией. */
interface Inflow {
  orderId: string;
  day: string;
  amount: number;
  method: string;
  /** Пусто — делить по долям счёта. */
  farm: string;
}

export function buildFinanceAnalytics(input: {
  orders: OrderWithItems[];
  payments: Payment[];
  nameByEmail: Map<string, string>;
  period: string;
  today: string;
}): FinanceAnalytics {
  const { orders, payments, nameByEmail, period, today } = input;
  const prevPeriod = periodShift(period, -1);
  const who = (email: string) => nameByEmail.get((email || "").toLowerCase()) ?? (email || "без менеджера");

  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED);
  const sales = live.filter((o) => !hasNoClientInvoice(o) && day(o.createdAt));
  const moneyOrders = new Map(live.filter((o) => !hasNoClientInvoice(o) || isRegionOrder(o)).map((o) => [o.orderId, o]));

  // --- Поступления: журнал + то, что внесено до него одной суммой ------------
  const inflows: Inflow[] = [];
  const journalSum = new Map<string, number>();
  const lastPayDay = new Map<string, string>();
  for (const p of payments) {
    const o = moneyOrders.get(p.orderId);
    if (!o) continue;
    const d = day(p.date) || day(p.createdAt);
    if (!d) continue;
    inflows.push({ orderId: p.orderId, day: d, amount: p.amount, method: p.method || o.paymentMethod || NO_METHOD, farm: p.farm });
    journalSum.set(p.orderId, (journalSum.get(p.orderId) ?? 0) + p.amount);
    if (p.amount > 0 && (!lastPayDay.has(p.orderId) || d > lastPayDay.get(p.orderId)!)) lastPayDay.set(p.orderId, d);
  }
  for (const o of moneyOrders.values()) {
    const rest = o.paidAmount - (journalSum.get(o.orderId) ?? 0);
    const d = day(o.paidAt);
    if (rest > MONEY_EPSILON && d) {
      inflows.push({ orderId: o.orderId, day: d, amount: rest, method: o.paymentMethod || NO_METHOD, farm: "" });
      if (!lastPayDay.has(o.orderId) || d > lastPayDay.get(o.orderId)!) lastPayDay.set(o.orderId, d);
    }
  }

  /** Деньги поступления по компаниям: у платежа компания своя, иначе — по долям счёта. */
  function inflowByFarm(f: Inflow): Map<string, number> {
    if (f.farm) return new Map([[f.farm, f.amount]]);
    const o = moneyOrders.get(f.orderId)!;
    const byFlower = splitPaymentByFlower({ status: o.status, paidAt: "", paidAmount: Math.abs(f.amount), items: o.items });
    const out = new Map<string, number>();
    const sign = f.amount < 0 ? -1 : 1;
    for (const [flower, amt] of byFlower) {
      const farm = getFarmFor(flower) ?? "";
      out.set(farm, (out.get(farm) ?? 0) + sign * amt);
    }
    if (out.size === 0) out.set("", f.amount);
    return out;
  }

  // --- Когда заявку закрыли оплатой ------------------------------------------
  const closedOn = new Map<string, string>();
  for (const o of sales) {
    const amt = amountOf(o);
    if (amt <= MONEY_EPSILON || amt - o.paidAmount > MONEY_EPSILON) continue;
    const d = lastPayDay.get(o.orderId) ?? day(o.paidAt);
    if (d) closedOn.set(o.orderId, d);
  }
  const payLag = (o: OrderWithItems) => daysBetween(o.deliveryDate || day(o.createdAt), closedOn.get(o.orderId)!);

  function month(p: string, filter: (o: OrderWithItems) => boolean = () => true): FinanceMonth {
    const billedOrders = sales.filter((o) => monthOf(day(o.createdAt)) === p && filter(o));
    const flows = inflows.filter((f) => monthOf(f.day) === p && filter(moneyOrders.get(f.orderId)!));
    const closed = sales.filter((o) => closedOn.has(o.orderId) && monthOf(closedOn.get(o.orderId)!) === p && filter(o));
    const lags = closed.map(payLag);
    return {
      billed: billedOrders.reduce((s, o) => s + amountOf(o), 0),
      orders: billedOrders.length,
      collected: billedOrders.reduce((s, o) => s + Math.min(Math.max(0, o.paidAmount), amountOf(o)), 0),
      cashIn: flows.reduce((s, f) => s + f.amount, 0),
      cashInRegions: flows.filter((f) => isRegionOrder(moneyOrders.get(f.orderId))).reduce((s, f) => s + f.amount, 0),
      paymentLines: flows.length,
      daysToPay: median(lags.map((d) => Math.max(0, d))),
      closedOrders: closed.length,
      prepaidOrders: lags.filter((d) => d < 0).length,
    };
  }

  // --- Долг сейчас -------------------------------------------------------------
  const debtOf = (o: OrderWithItems) => {
    const rest = amountOf(o) - o.paidAmount;
    return !isConsignment(o) && rest > MONEY_EPSILON ? rest : 0;
  };
  const ageOf = (o: OrderWithItems) => daysBetween(o.deliveryDate || day(o.createdAt), today);
  const isOverdue = (o: OrderWithItems) => ageOf(o) > DEBT_OVERDUE_DAYS;
  const debtors = sales.filter((o) => debtOf(o) > 0);
  const broken = debtors.filter((o) => o.promisedAt && o.promisedAt < today);

  const aging: AgingBucket[] = AGING_BUCKETS.map((b) => {
    const inB = debtors.filter((o) => ageOf(o) >= b.min && ageOf(o) <= b.max);
    return { key: b.key, label: b.label, amount: inB.reduce((s, o) => s + debtOf(o), 0), orders: inB.length };
  });

  // --- Разрезы -------------------------------------------------------------------
  type Acc = Omit<FinanceBreakdownRow, "share" | "collectedPercent" | "daysToPay"> & { lags: number[] };
  const blank = (key: string, label: string): Acc => ({
    key, label, orders: 0, billed: 0, prevBilled: 0, collected: 0, cashIn: 0, prevCashIn: 0, debt: 0, overdue: 0, lags: [],
  });
  function finish(map: Map<string, Acc>, order?: string[]): FinanceBreakdownRow[] {
    const total = [...map.values()].reduce((s, r) => s + r.billed, 0);
    const rows = [...map.values()]
      .filter((r) => r.billed || r.prevBilled || r.cashIn || r.prevCashIn || r.debt)
      .map(({ lags, ...r }) => ({
        ...r,
        share: total > 0 ? (r.billed / total) * 100 : 0,
        collectedPercent: r.billed > 0 ? (r.collected / r.billed) * 100 : null,
        daysToPay: median(lags.map((d) => Math.max(0, d))),
      }));
    if (order) return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return rows.sort((a, b) => b.billed - a.billed || b.cashIn - a.cashIn || b.debt - a.debt);
  }

  /** Разрез, где заявка целиком принадлежит одной строке. */
  function byOrderKey(keyOf: (o: OrderWithItems) => { key: string; label: string }): FinanceBreakdownRow[] {
    const map = new Map<string, Acc>();
    const acc = (o: OrderWithItems) => {
      const k = keyOf(o);
      if (!map.has(k.key)) map.set(k.key, blank(k.key, k.label));
      return map.get(k.key)!;
    };
    for (const o of sales) {
      const m = monthOf(day(o.createdAt));
      const r = acc(o);
      if (m === period) {
        r.orders += 1;
        r.billed += amountOf(o);
        r.collected += Math.min(Math.max(0, o.paidAmount), amountOf(o));
      } else if (m === prevPeriod) r.prevBilled += amountOf(o);
      const debt = debtOf(o);
      if (debt > 0) {
        r.debt += debt;
        if (isOverdue(o)) r.overdue += debt;
      }
      const closed = closedOn.get(o.orderId);
      if (closed && monthOf(closed) === period) r.lags.push(payLag(o));
    }
    for (const f of inflows) {
      const o = moneyOrders.get(f.orderId)!;
      if (hasNoClientInvoice(o)) continue;
      const m = monthOf(f.day);
      if (m === period) acc(o).cashIn += f.amount;
      else if (m === prevPeriod) acc(o).prevCashIn += f.amount;
    }
    return finish(map);
  }

  const byManager = byOrderKey((o) => ({ key: (o.managerEmail || "").toLowerCase(), label: who(o.managerEmail) }));
  const byTerms = byOrderKey((o) => {
    const t = (o.clientPaymentTerms || "").trim();
    return { key: t || NO_TERMS, label: t || NO_TERMS };
  });

  // По компаниям: счёт — по позициям, оплата — по разбивке заявки (paidByFarm).
  const companyMap = new Map<string, Acc>(FARM_ORDER.map((f) => [f, blank(f, farmLabel(f))]));
  for (const o of sales) {
    const invoice = invoiceByFarm(o.items);
    const paid = paidByFarm(o, invoice);
    const amt = amountOf(o);
    const m = monthOf(day(o.createdAt));
    const debt = debtOf(o);
    for (const part of invoice) {
      const r = companyMap.get(part.farm) ?? blank(part.farm, farmLabel(part.farm));
      companyMap.set(part.farm, r);
      const got = Math.min(Math.max(0, paid.find((x) => x.farm === part.farm)?.amount ?? 0), part.amount);
      if (m === period) {
        r.orders += 1;
        r.billed += part.amount;
        r.collected += got;
      } else if (m === prevPeriod) r.prevBilled += part.amount;
      if (debt > 0 && amt > 0) {
        const share = Math.max(0, part.amount - got);
        r.debt += share;
        if (isOverdue(o)) r.overdue += share;
      }
    }
  }
  for (const f of inflows) {
    const m = monthOf(f.day);
    if (m !== period && m !== prevPeriod) continue;
    for (const [farm, amt] of inflowByFarm(f)) {
      if (!farm) continue;
      const r = companyMap.get(farm) ?? blank(farm, farmLabel(farm));
      companyMap.set(farm, r);
      if (m === period) r.cashIn += amt;
      else r.prevCashIn += amt;
    }
  }
  const byCompany = finish(companyMap, FARM_ORDER);

  // По способу — только поступления: у счёта способа нет, есть у денег.
  const methodMap = new Map<string, Acc>();
  for (const f of inflows) {
    const m = monthOf(f.day);
    if (m !== period && m !== prevPeriod) continue;
    const key = f.method || NO_METHOD;
    const r = methodMap.get(key) ?? blank(key, key);
    methodMap.set(key, r);
    if (m === period) {
      r.cashIn += f.amount;
      r.orders += 1;
    } else r.prevCashIn += f.amount;
  }
  const byMethod = finish(methodMap).sort((a, b) => b.cashIn - a.cashIn);

  // --- Недели ------------------------------------------------------------------
  const weeks: FinanceWeek[] = weeksOfMonth(period).map((w) => {
    const inW = (d: string) => d >= w.from && d <= w.to;
    return {
      label: w.label,
      billed: sales.filter((o) => inW(day(o.createdAt))).reduce((s, o) => s + amountOf(o), 0),
      cashIn: inflows.filter((f) => inW(f.day)).reduce((s, f) => s + f.amount, 0),
      future: w.from > today,
    };
  });

  // --- Должники ------------------------------------------------------------------
  const debtorMap = new Map<string, DebtorRow>();
  for (const o of debtors) {
    const key = o.clientId || o.clientName.trim().toLowerCase() || o.orderId;
    const row = debtorMap.get(key) ?? {
      clientKey: key,
      clientId: o.clientId,
      name: o.clientName || "(без названия)",
      managerName: who(o.managerEmail),
      orders: 0,
      debt: 0,
      overdue: 0,
      oldestDays: 0,
      promisedAt: "",
      brokenPromise: false,
      terms: (o.clientPaymentTerms || "").trim(),
    };
    row.orders += 1;
    row.debt += debtOf(o);
    if (isOverdue(o)) row.overdue += debtOf(o);
    row.oldestDays = Math.max(row.oldestDays, ageOf(o));
    if (o.promisedAt && o.promisedAt > row.promisedAt) row.promisedAt = o.promisedAt;
    if (o.promisedAt && o.promisedAt < today) row.brokenPromise = true;
    debtorMap.set(key, row);
  }

  const inPeriod = sales.filter((o) => monthOf(day(o.createdAt)) === period);
  return {
    period,
    prevPeriod,
    current: month(period),
    previous: month(prevPeriod),
    debt: {
      total: debtors.reduce((s, o) => s + debtOf(o), 0),
      overdue: debtors.filter(isOverdue).reduce((s, o) => s + debtOf(o), 0),
      orders: debtors.length,
      clients: debtorMap.size,
      onConsignment: sales
        .filter(isConsignment)
        .reduce((s, o) => s + Math.max(0, amountOf(o) - o.paidAmount), 0),
      brokenPromises: broken.length,
      brokenAmount: broken.reduce((s, o) => s + debtOf(o), 0),
      shippedUnpaid: debtors
        .filter((o) => o.status === ORDER_STATUSES.SHIPPED)
        .reduce((s, o) => s + debtOf(o), 0),
      aging,
    },
    byManager,
    byCompany,
    byMethod,
    byTerms,
    weeks,
    debtors: [...debtorMap.values()].sort((a, b) => b.overdue - a.overdue || b.debt - a.debt),
    overpaid: sales.reduce((s, o) => s + Math.max(0, o.paidAmount - amountOf(o)), 0),
    invoiceMarked: inPeriod.filter((o) => o.invoiceSentAt).length,
  };
}
