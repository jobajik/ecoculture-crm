import { FARM_ORDER, FLOWER_TYPE_LABELS_PLURAL, MONEY_EPSILON, ORDER_STATUSES, farmLabel, getFarmFor } from "../constants";
import { isNotASale } from "../orderKind";
import { isBotEmail } from "../botIdentity";
import { REGION_STORES, isRegionStore, normalizeStore, storeLabel } from "../officeStore";
import { isReadyToShip } from "../orderReady";
import { deliveryGroup } from "../shipQueue";
import type { ManagerSalesRow } from "../salesAnalytics";
import type { Batch, OrderWithItems, Payment, Shipment, Writeoff } from "../types";

/**
 * Главная владельца и РОПа — «состояние на сейчас» (18.11.2026).
 *
 * Владелец: «Мне нужно, чтобы главная страничка админа была более информативной. Данные по стоку (сколько дней) — это
 * очень важно. Но мне нужно убрать всё остальное. Нужно текущие продажи за день, сколько продали, сколько должны. Ещё
 * какие-то данные, которые будут отражать состояние». Прежняя главная (19.10.2026) отвечала на вопрос «что горит»:
 * «Требует внимания», менеджеры против темпа, ИИ за сутки, склад по компаниям. Теперь на ней только цифры дня:
 *
 * - **продано сегодня** — сумма, заявок, стеблей, по цветкам и по менеджерам; рядом вчера и средний день месяца;
 * - **получено сегодня** — деньги по дню поступления, по компаниям; рядом вчера и месяц;
 * - **нам должны** — весь долг, просроченная часть и самые крупные должники;
 * - **месяц к плану** — где продажи относительно темпа;
 * - **склад за день** — принято, отгружено, осталось отгрузить сегодня, списано;
 * - «Сколько дней лежит» — отдельной карточкой (`StockAgeCard`), считается в `getStockSnapshot`.
 *
 * Правила счёта те же, что на соседних страницах: продажи — по дню ОФОРМЛЕНИЯ по Алматы, без отменённых и не-продаж
 * (`isNotASale`); деньги — по дню ПОСТУПЛЕНИЯ (`Payments.date`), как касса; долги — по всей базе (`getFinanceSnapshot`).
 * Чистая функция — всё из уже прочитанного, проверка `scripts/check-myday-owner.ts`.
 */
export interface OwnerDebtCall {
  clientName: string;
  debt: number;
  overdue: boolean;
  /** Сколько дней долгу. */
  days: number;
}

export interface OwnerDayInput {
  today: string;
  /** Доля месяца, прошедшая к сегодняшнему дню, 0–100 (`paceOf`). */
  pacePercent: number;
  orders: OrderWithItems[];
  /** Снимок продаж месяца по менеджерам (`getSalesSnapshot`) — в нём же продажи за сегодня. */
  managers: ManagerSalesRow[];
  totals: { amountMonth: number; targetAmount: number };
  payments: Payment[];
  debts: { total: number; overdue: number };
  /** Неоплаченные заявки по всей базе (`finance.calls`). */
  calls: OwnerDebtCall[];
  shipments: Pick<Shipment, "orderId" | "quantity" | "createdAt">[];
  writeoffs: Pick<Writeoff, "quantity" | "createdAt">[];
  batches: Pick<Batch, "receivedAt" | "quantityIn" | "store">[];
  /** Имя по почте — для бота и менеджеров без строки в снимке. */
  nameByEmail: Map<string, string>;
  /** День по Алматы для ISO-момента. */
  toDay: (iso: string) => string;
}

export type ManagerTone = "good" | "warn" | "bad" | "none";

export interface OwnerManagerRow {
  email: string;
  name: string;
  todayAmount: number;
  todayOrders: number;
  monthAmount: number;
  target: number;
  /** Процент плана; null — плана нет. */
  percent: number | null;
  tone: ManagerTone;
}

export interface OwnerDebtor {
  clientName: string;
  debt: number;
  /** Просроченная часть долга. */
  overdue: number;
  orders: number;
  /** Сколько дней самому старому долгу клиента. */
  days: number;
}

export interface OwnerDay {
  sold: {
    amount: number;
    orders: number;
    stems: number;
    byFlower: { flowerType: string; label: string; stems: number; amount: number }[];
    yesterdayAmount: number;
    yesterdayOrders: number;
    /** Средняя продажа за день в этом месяце по ПРОШЕДШИМ дням (сегодня не в счёт); 0 — первый день месяца. */
    avgDay: number;
  };
  received: { today: number; yesterday: number; month: number; byFarm: { farm: string; label: string; amount: number }[] };
  debts: { total: number; overdue: number; overdueOrders: number; openOrders: number; clients: number; top: OwnerDebtor[] };
  month: { amount: number; target: number; percent: number | null; pacePercent: number; tone: ManagerTone };
  managers: OwnerManagerRow[];
  warehouse: {
    /** Принято на основной склад сегодня, шт. */
    received: number;
    shipped: number;
    shippedOrders: number;
    /** Готово и ждёт отгрузки на сегодня. */
    toShipOrders: number;
    toShipStems: number;
    toShip: { label: string; orders: number; stems: number }[];
    writtenOff: number;
  };
}

/** Подняться выше темпа — хорошо; отстать больше чем на 15 п.п. — плохо (как `BEHIND_MARGIN` в обзоре планов). */
const BEHIND_MARGIN = 15;
/** Сколько должников показывать на главной. */
const TOP_DEBTORS = 6;

export function managerTone(percent: number | null, pacePercent: number): ManagerTone {
  if (percent === null) return "none";
  if (percent >= pacePercent) return "good";
  if (percent >= pacePercent - BEHIND_MARGIN) return "warn";
  return "bad";
}

function prevDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

const stemsLeft = (o: OrderWithItems) => o.items.reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0);
const FLOWER_ORDER = ["rose", "chrysanthemum", "chrysanthemum_rf", "eustoma"];
const flowerRank = (flowerType: string) => (FLOWER_ORDER.includes(flowerType) ? FLOWER_ORDER.indexOf(flowerType) : FLOWER_ORDER.length);
const clientKey = (name: string) => name.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

export function buildOwnerDay(input: OwnerDayInput): OwnerDay {
  const { today, orders, payments, toDay } = input;
  const yesterday = prevDay(today);
  const month = today.slice(0, 7);
  // В таблице дата бывает и чистым днём, и моментом — день берём по Алматы в обоих случаях; непонятное — «не сегодня».
  const dayOf = (v: string | null | undefined): string => {
    const raw = String(v ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (!raw || Number.isNaN(Date.parse(raw))) return "";
    return toDay(raw);
  };

  // --- Продано сегодня -----------------------------------------------------------------
  const sales = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && o.createdAt);
  const todayOrders = sales.filter((o) => dayOf(o.createdAt) === today);
  const yesterdayOrders = sales.filter((o) => dayOf(o.createdAt) === yesterday);
  const flowers = new Map<string, { stems: number; amount: number }>();
  for (const o of todayOrders) {
    for (const i of o.items) {
      const row = flowers.get(i.flowerType) ?? { stems: 0, amount: 0 };
      row.stems += i.quantity;
      row.amount += i.quantity * i.unitPrice;
      flowers.set(i.flowerType, row);
    }
  }
  const byFlower = Array.from(flowers.entries())
    .map(([flowerType, v]) => ({ flowerType, label: FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType, stems: v.stems, amount: v.amount }))
    .sort((a, b) => flowerRank(a.flowerType) - flowerRank(b.flowerType));
  const todayAmount = todayOrders.reduce((s, o) => s + o.totalAmount, 0);
  const daysBefore = Number(today.slice(8, 10)) - 1;
  const avgDay = daysBefore > 0 ? Math.max(0, input.totals.amountMonth - todayAmount) / daysBefore : 0;

  // --- Получено сегодня ----------------------------------------------------------------
  const todayPayments = payments.filter((p) => p.date === today);
  const farmMap = new Map<string, number>();
  for (const p of todayPayments) farmMap.set(p.farm || "", (farmMap.get(p.farm || "") ?? 0) + p.amount);
  const byFarm = [...FARM_ORDER, ...Array.from(farmMap.keys()).filter((f) => f && !FARM_ORDER.includes(f))]
    .map((farm) => ({ farm, label: farmLabel(farm), amount: farmMap.get(farm) ?? 0 }))
    .filter((r) => Math.abs(r.amount) > MONEY_EPSILON);
  if (Math.abs(farmMap.get("") ?? 0) > MONEY_EPSILON) byFarm.push({ farm: "", label: "без компании", amount: farmMap.get("")! });

  // --- Нам должны ----------------------------------------------------------------------
  const open = input.calls.filter((c) => c.debt > MONEY_EPSILON);
  const debtors = new Map<string, OwnerDebtor>();
  for (const c of open) {
    const key = clientKey(c.clientName);
    const row = debtors.get(key) ?? { clientName: c.clientName.trim() || "без имени", debt: 0, overdue: 0, orders: 0, days: 0 };
    row.debt += c.debt;
    if (c.overdue) row.overdue += c.debt;
    row.orders += 1;
    row.days = Math.max(row.days, c.days);
    debtors.set(key, row);
  }
  // Сначала те, у кого больше ПРОСРОЧЕНО: это разговор сегодня; дальше — по размеру долга.
  const top = Array.from(debtors.values())
    .sort((a, b) => b.overdue - a.overdue || b.debt - a.debt)
    .slice(0, TOP_DEBTORS);

  // --- Месяц к плану и менеджеры ---------------------------------------------------------
  const percent = input.totals.targetAmount > 0 ? (input.totals.amountMonth / input.totals.targetAmount) * 100 : null;
  const managers: OwnerManagerRow[] = input.managers
    .map((m) => {
      const pct = m.targetAmount > 0 ? (m.amountMonth / m.targetAmount) * 100 : null;
      return {
        email: m.managerEmail,
        // Заявка без менеджера или на уже удалённого сотрудника — строка не должна остаться без подписи.
        name: isBotEmail(m.managerEmail) ? "Бот и ИИ" : input.nameByEmail.get(m.managerEmail) || m.name || m.managerEmail || "без менеджера",
        todayAmount: m.amountToday,
        todayOrders: m.ordersToday,
        monthAmount: m.amountMonth,
        target: m.targetAmount,
        percent: pct,
        tone: isBotEmail(m.managerEmail) ? ("none" as ManagerTone) : managerTone(pct, input.pacePercent),
      };
    })
    .sort((a, b) => b.todayAmount - a.todayAmount || b.monthAmount - a.monthAmount);

  // --- Склад за день ---------------------------------------------------------------------
  const shippedRows = input.shipments.filter((s) => dayOf(s.createdAt) === today);
  const shipped = Math.max(0, shippedRows.reduce((s, r) => s + r.quantity, 0));
  const shippedOrders = new Set(shippedRows.filter((r) => r.quantity > 0).map((r) => r.orderId)).size;
  // Приход — только настоящая приёмка: у отрезков для офиса и регионов приход ноль (стебли приняты один раз).
  const received = input.batches.filter((b) => b.quantityIn > 0 && normalizeStore(b.store) === "" && dayOf(b.receivedAt) === today).reduce((s, b) => s + b.quantityIn, 0);
  const writtenOff = input.writeoffs.filter((w) => dayOf(w.createdAt) === today).reduce((s, w) => s + w.quantity, 0);
  const waiting = orders.filter((o) => isReadyToShip(o) && deliveryGroup(o.deliveryDate, today) === "today" && stemsLeft(o) > 0);
  const buckets = new Map<string, { orders: Set<string>; stems: number }>();
  for (const o of waiting) {
    for (const i of o.items) {
      const left = Math.max(0, i.quantity - i.shippedQuantity);
      if (left <= 0) continue;
      const key = normalizeStore(o.store) || getFarmFor(i.flowerType) || "";
      const b = buckets.get(key) ?? { orders: new Set<string>(), stems: 0 };
      b.orders.add(o.orderId);
      b.stems += left;
      buckets.set(key, b);
    }
  }
  const toShip = [...FARM_ORDER, "office", ...REGION_STORES.map((r) => r.code as string)]
    .filter((k) => buckets.has(k))
    .map((k) => ({ label: k === "office" || isRegionStore(k) ? storeLabel(k) : farmLabel(k), orders: buckets.get(k)!.orders.size, stems: buckets.get(k)!.stems }));

  return {
    sold: {
      amount: todayAmount,
      orders: todayOrders.length,
      stems: todayOrders.reduce((s, o) => s + o.items.reduce((x, i) => x + i.quantity, 0), 0),
      byFlower,
      yesterdayAmount: yesterdayOrders.reduce((s, o) => s + o.totalAmount, 0),
      yesterdayOrders: yesterdayOrders.length,
      avgDay,
    },
    received: {
      today: todayPayments.reduce((s, p) => s + p.amount, 0),
      yesterday: payments.filter((p) => p.date === yesterday).reduce((s, p) => s + p.amount, 0),
      month: payments.filter((p) => p.date.slice(0, 7) === month && p.date <= today).reduce((s, p) => s + p.amount, 0),
      byFarm,
    },
    debts: {
      total: input.debts.total,
      overdue: input.debts.overdue,
      overdueOrders: open.filter((c) => c.overdue).length,
      openOrders: open.length,
      clients: debtors.size,
      top,
    },
    month: { amount: input.totals.amountMonth, target: input.totals.targetAmount, percent, pacePercent: input.pacePercent, tone: managerTone(percent, input.pacePercent) },
    managers,
    warehouse: {
      received,
      shipped,
      shippedOrders,
      toShipOrders: waiting.length,
      toShipStems: waiting.reduce((s, o) => s + stemsLeft(o), 0),
      toShip,
      writtenOff,
    },
  };
}
