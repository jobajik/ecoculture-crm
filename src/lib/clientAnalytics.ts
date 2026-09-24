import { CLIENT_SLEEPING_DAYS, FLOWER_TYPE_LABELS_PLURAL, MONEY_EPSILON, ORDER_STATUSES, periodShift } from "./constants";
import type { Client, OrderWithItems } from "./types";
import { isOwnShop } from "./retail";
import { hasNoClientInvoice, isConsignment } from "./orderKind";

/**
 * Аналитика клиентов за месяц — «Клиенты → Аналитика».
 *
 * Список клиентов (`clientStats.ts`) отвечает «кто у нас есть и сколько он
 * принёс за всё время». Здесь вопросы руководителя про МЕСЯЦ и в сравнении с
 * прошлым: сколько клиентов реально покупало, сколько новых, кто держит
 * выручку, какие менеджеры и города растут, кто перестал заказывать.
 *
 * Правила счёта те же, что во всех деньгах проекта:
 *  - месяц заявки — по дню ОФОРМЛЕНИЯ (как продажи менеджеров и финансы);
 *  - отменённые не считаются; наши магазины и опт на город — не продажа
 *    клиенту (`hasNoClientInvoice`), их здесь нет вовсе;
 *  - получено — не больше суммы счёта; долг — без реализации (пожарка).
 *
 * Разрез по менеджерам считается по менеджеру ЗАЯВКИ (кто продал — так же
 * считает рейтинг), а «клиентов в базе» — по менеджеру карточки. Города и тип
 * точки берутся из карточки клиента заявки.
 *
 * Функция чистая, проверка — `scripts/check-client-analytics.ts`.
 */

/**
 * С какого перерыва клиента показываем в «давно не заказывали». По живой базе
 * (сентябрь, `diag-clients`) медиана между заказами одного клиента — 4 дня:
 * цветочные точки берут часто, и неделя тишины — уже повод позвонить.
 */
export const ATTENTION_DAYS = 7;
/** …и только если молчит в полтора раза дольше своего обычного перерыва. */
export const ATTENTION_GAP_FACTOR = 1.5;

/**
 * Город из карточки пишется руками, и в живой базе рядом с «Алматы» (70
 * карточек) стоят «Алмата», «Алмтаы» и «Алмматы». В разрезе это четыре города
 * вместо одного. Склеиваем ЯВНЫМ списком опечаток и синонимов — угадывать по
 * похожести нельзя («Алмалы» — это не Алматы).
 */
const CITY_CANON: Record<string, string> = {
  "алматы": "Алматы",
  "алмата": "Алматы",
  "алмтаы": "Алматы",
  "алмматы": "Алматы",
  "алмааты": "Алматы",
  "алма ата": "Алматы",
  "алма-ата": "Алматы",
  "астана": "Астана",
  "нур султан": "Астана",
  "нур-султан": "Астана",
  "оскемен": "Усть-Каменогорск",
  "өскемен": "Усть-Каменогорск",
  "усть каменогорск": "Усть-Каменогорск",
  "усть-каменогорск": "Усть-Каменогорск",
  "семипалатинск": "Семей",
  "семей": "Семей",
  "шымкент": "Шымкент",
  "чимкент": "Шымкент",
  "кызыл орда": "Кызылорда",
  "кызыл-орда": "Кызылорда",
  "кызылорда": "Кызылорда",
};

/** Город для разреза: ключ без регистра, пробелов по краям и «ё», подпись — каноническая. */
export function cityOf(raw: string): { key: string; label: string } {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const key = trimmed.toLowerCase().replace(/ё/g, "е");
  if (!key) return { key: "—", label: "Город не указан" };
  const canon = CITY_CANON[key];
  if (canon) return { key: canon.toLowerCase(), label: canon };
  return { key, label: trimmed };
}

export interface PeriodTotals {
  /** Сколько разных клиентов покупало. */
  buyers: number;
  /** Из них впервые в жизни — первая заявка пришлась на этот месяц. */
  newBuyers: number;
  /** Покупали и раньше, и в этом месяце. */
  returning: number;
  /** Взяли в месяце две заявки и больше. */
  repeatBuyers: number;
  orders: number;
  revenue: number;
  stems: number;
  paid: number;
  avgCheck: number;
  ordersPerBuyer: number;
  /** Средняя цена стебля, ₸. */
  pricePerStem: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  /** Карточек в базе (для менеджера — его карточки). */
  baseClients: number;
  buyers: number;
  newBuyers: number;
  orders: number;
  revenue: number;
  prevRevenue: number;
  /** Доля выручки месяца, 0–100. */
  share: number;
  avgCheck: number;
  stems: number;
  /** Получено от суммы счетов месяца, 0–100; null — продаж нет. */
  paidPercent: number | null;
  /** Долг сейчас — по всем заявкам, не только месяца. */
  debt: number;
  /** Сколько клиентов молчит дольше `ATTENTION_DAYS`. */
  quiet: number;
}

export interface ClientLine {
  clientId: string;
  name: string;
  city: string;
  managerName: string;
  revenue: number;
  prevRevenue: number;
  orders: number;
  share: number;
  /** Выручка за всё время — вес клиента для списка «кому позвонить». */
  lifetimeRevenue: number;
  lastOrderDate: string;
  daysSinceLast: number;
  /** Средний перерыв между заказами, дней; null — заказ был один. */
  usualGap: number | null;
}

export interface AbcBucket {
  key: "A" | "B" | "C";
  clients: number;
  revenue: number;
  share: number;
}

export interface ClientAnalytics {
  period: string;
  prevPeriod: string;
  current: PeriodTotals;
  previous: PeriodTotals;
  /** Карточек клиентов (без наших магазинов), активных. */
  baseClients: number;
  /** Карточки без единой заявки за всё время. */
  neverOrdered: number;
  debt: number;
  /** Заявки месяца без карточки клиента: в разрезы по клиентам не попадают. */
  ordersWithoutClient: number;
  byManager: BreakdownRow[];
  byCity: BreakdownRow[];
  byType: BreakdownRow[];
  byFlower: BreakdownRow[];
  abc: AbcBucket[];
  top: ClientLine[];
  /** Покупали раньше, но молчат `ATTENTION_DAYS`+ дней — от самых ценных. */
  quiet: ClientLine[];
}

const day = (s: string) => (s || "").slice(0, 10);
const monthOf = (s: string) => (s || "").slice(0, 7);
const amountOf = (o: OrderWithItems) => o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
const stemsOf = (o: OrderWithItems) => o.items.reduce((s, i) => s + i.quantity, 0);

function daysBetween(fromKey: string, todayKey: string): number {
  if (!fromKey || !todayKey) return -1;
  const t = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return Math.max(0, Math.round((t(todayKey) - t(fromKey)) / 86_400_000));
}

function totalsOf(orders: OrderWithItems[], firstMonthByClient: Map<string, string>, period: string): PeriodTotals {
  const buyers = new Map<string, number>();
  let revenue = 0;
  let stems = 0;
  let paid = 0;
  for (const o of orders) {
    const a = amountOf(o);
    revenue += a;
    stems += stemsOf(o);
    paid += Math.min(o.paidAmount, a);
    if (o.clientId) buyers.set(o.clientId, (buyers.get(o.clientId) ?? 0) + 1);
  }
  let newBuyers = 0;
  for (const id of buyers.keys()) if (firstMonthByClient.get(id) === period) newBuyers++;
  return {
    buyers: buyers.size,
    newBuyers,
    returning: buyers.size - newBuyers,
    repeatBuyers: Array.from(buyers.values()).filter((n) => n >= 2).length,
    orders: orders.length,
    revenue,
    stems,
    paid,
    avgCheck: orders.length > 0 ? revenue / orders.length : 0,
    ordersPerBuyer: buyers.size > 0 ? orders.filter((o) => o.clientId).length / buyers.size : 0,
    pricePerStem: stems > 0 ? revenue / stems : 0,
  };
}

export function buildClientAnalytics(input: {
  clients: Client[];
  orders: OrderWithItems[];
  nameByEmail: Map<string, string>;
  /** «2026-09» */
  period: string;
  /** «Сегодня» по Алматы, «ГГГГ-ММ-ДД». */
  today: string;
}): ClientAnalytics {
  const { period, today } = input;
  const prevPeriod = periodShift(period, -1);
  const clients = input.clients.filter((c) => !isOwnShop(c));
  const byId = new Map(clients.map((c) => [c.clientId, c]));
  const nameOf = (email: string) => input.nameByEmail.get(email.toLowerCase()) ?? input.nameByEmail.get(email) ?? email;

  const counted = input.orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !hasNoClientInvoice(o));
  // Заявка на карточку нашего магазина (старые, до разметки) клиентом не считается.
  const sales = counted.filter((o) => !o.clientId || byId.has(o.clientId));

  // История клиента за всё время: первый месяц, последний день, дни заказов.
  const firstMonth = new Map<string, string>();
  const lastDay = new Map<string, string>();
  const days = new Map<string, Set<string>>();
  const lifetime = new Map<string, number>();
  const debtBy = new Map<string, number>();
  for (const o of sales) {
    if (!o.clientId) continue;
    const m = monthOf(o.createdAt);
    const d = day(o.createdAt);
    if (m && (!firstMonth.has(o.clientId) || m < firstMonth.get(o.clientId)!)) firstMonth.set(o.clientId, m);
    if (d && (!lastDay.has(o.clientId) || d > lastDay.get(o.clientId)!)) lastDay.set(o.clientId, d);
    if (d) days.set(o.clientId, (days.get(o.clientId) ?? new Set()).add(d));
    const a = amountOf(o);
    lifetime.set(o.clientId, (lifetime.get(o.clientId) ?? 0) + a);
    if (!isConsignment(o)) debtBy.set(o.clientId, (debtBy.get(o.clientId) ?? 0) + Math.max(0, a - o.paidAmount));
  }

  const cur = sales.filter((o) => monthOf(o.createdAt) === period);
  const prev = sales.filter((o) => monthOf(o.createdAt) === prevPeriod);
  const current = totalsOf(cur, firstMonth, period);
  const previous = totalsOf(prev, firstMonth, prevPeriod);

  const usualGap = (id: string): number | null => {
    const ds = Array.from(days.get(id) ?? []).sort();
    if (ds.length < 2) return null;
    return Math.round(daysBetween(ds[0], ds[ds.length - 1]) / (ds.length - 1));
  };
  const debtOf = (id: string) => {
    const v = debtBy.get(id) ?? 0;
    return v > MONEY_EPSILON ? v : 0;
  };
  const quietDays = (id: string) => (lastDay.has(id) ? daysBetween(lastDay.get(id)!, today) : -1);

  // --- Разрезы ----------------------------------------------------------------
  type Acc = BreakdownRow & { buyerSet: Set<string>; newSet: Set<string>; paid: number; debtSet: Set<string>; quietSet: Set<string> };
  function breakdown(
    keyOfOrder: (o: OrderWithItems) => { key: string; label: string }[],
    keyOfClient: (c: Client) => { key: string; label: string } | null,
    amountFor: (o: OrderWithItems, key: string) => { revenue: number; stems: number; paid: number }
  ): BreakdownRow[] {
    const map = new Map<string, Acc>();
    const get = (key: string, label: string): Acc => {
      let a = map.get(key);
      if (!a) {
        a = {
          key, label, baseClients: 0, buyers: 0, newBuyers: 0, orders: 0, revenue: 0, prevRevenue: 0, share: 0,
          avgCheck: 0, stems: 0, paidPercent: null, debt: 0, quiet: 0,
          buyerSet: new Set(), newSet: new Set(), paid: 0, debtSet: new Set(), quietSet: new Set(),
        };
        map.set(key, a);
      }
      return a;
    };
    for (const c of clients) {
      const k = keyOfClient(c);
      if (!k) continue;
      const a = get(k.key, k.label);
      if (c.active) a.baseClients++;
      const q = quietDays(c.clientId);
      if (q >= ATTENTION_DAYS) a.quietSet.add(c.clientId);
      if (debtOf(c.clientId) > 0) a.debtSet.add(c.clientId);
    }
    for (const o of cur) {
      for (const k of keyOfOrder(o)) {
        const a = get(k.key, k.label);
        const part = amountFor(o, k.key);
        a.orders++;
        a.revenue += part.revenue;
        a.stems += part.stems;
        a.paid += part.paid;
        if (o.clientId) {
          a.buyerSet.add(o.clientId);
          if (firstMonth.get(o.clientId) === period) a.newSet.add(o.clientId);
        }
      }
    }
    for (const o of prev) for (const k of keyOfOrder(o)) get(k.key, k.label).prevRevenue += amountFor(o, k.key).revenue;

    return Array.from(map.values())
      .map((a) => ({
        key: a.key,
        label: a.label,
        baseClients: a.baseClients,
        buyers: a.buyerSet.size,
        newBuyers: a.newSet.size,
        orders: a.orders,
        revenue: a.revenue,
        prevRevenue: a.prevRevenue,
        share: current.revenue > 0 ? (a.revenue / current.revenue) * 100 : 0,
        avgCheck: a.orders > 0 ? a.revenue / a.orders : 0,
        stems: a.stems,
        paidPercent: a.revenue > 0 ? (a.paid / a.revenue) * 100 : null,
        debt: Array.from(a.debtSet).reduce((s, id) => s + debtOf(id), 0),
        quiet: a.quietSet.size,
      }))
      .filter((r) => r.revenue > 0 || r.prevRevenue > 0 || r.baseClients > 0)
      .sort((x, y) => y.revenue - x.revenue || y.prevRevenue - x.prevRevenue || y.baseClients - x.baseClients);
  }

  const whole = (o: OrderWithItems) => {
    const revenue = amountOf(o);
    return { revenue, stems: stemsOf(o), paid: Math.min(o.paidAmount, revenue) };
  };

  const byManager = breakdown(
    (o) => [{ key: o.managerEmail.toLowerCase(), label: nameOf(o.managerEmail) }],
    (c) => (c.managerEmail ? { key: c.managerEmail.toLowerCase(), label: nameOf(c.managerEmail) } : null),
    whole
  );
  const byCity = breakdown(
    (o) => {
      const c = byId.get(o.clientId);
      return [c ? cityOf(c.city) : { key: "без карточки", label: "Без карточки" }];
    },
    (c) => cityOf(c.city),
    whole
  );
  const byType = breakdown(
    (o) => {
      const c = byId.get(o.clientId);
      return [{ key: c ? c.clientType || "—" : "без карточки", label: c ? c.clientType || "Тип не указан" : "Без карточки" }];
    },
    (c) => ({ key: c.clientType || "—", label: c.clientType || "Тип не указан" }),
    whole
  );
  // Цветок — по ПОЗИЦИЯМ: в одной заявке едут и роза, и хризантема. Оплата
  // делится по долям суммы (тот же приём, что в «Кассе по цветкам»).
  const byFlower = breakdown(
    (o) => Array.from(new Set(o.items.map((i) => i.flowerType))).map((f) => ({ key: f, label: FLOWER_TYPE_LABELS_PLURAL[f] ?? f })),
    () => null,
    (o, key) => {
      const items = o.items.filter((i) => i.flowerType === key);
      const revenue = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const total = amountOf(o);
      return {
        revenue,
        stems: items.reduce((s, i) => s + i.quantity, 0),
        paid: total > 0 ? (Math.min(o.paidAmount, total) * revenue) / total : 0,
      };
    }
  );

  // --- Клиенты ----------------------------------------------------------------
  const curBy = new Map<string, { revenue: number; orders: number }>();
  for (const o of cur) {
    if (!o.clientId) continue;
    const a = curBy.get(o.clientId) ?? { revenue: 0, orders: 0 };
    a.revenue += amountOf(o);
    a.orders++;
    curBy.set(o.clientId, a);
  }
  const prevBy = new Map<string, number>();
  for (const o of prev) if (o.clientId) prevBy.set(o.clientId, (prevBy.get(o.clientId) ?? 0) + amountOf(o));

  const line = (c: Client): ClientLine => ({
    clientId: c.clientId,
    name: c.name,
    city: cityOf(c.city).label === "Город не указан" ? "" : cityOf(c.city).label,
    managerName: nameOf(c.managerEmail),
    revenue: curBy.get(c.clientId)?.revenue ?? 0,
    prevRevenue: prevBy.get(c.clientId) ?? 0,
    orders: curBy.get(c.clientId)?.orders ?? 0,
    share: current.revenue > 0 ? ((curBy.get(c.clientId)?.revenue ?? 0) / current.revenue) * 100 : 0,
    lifetimeRevenue: lifetime.get(c.clientId) ?? 0,
    lastOrderDate: lastDay.get(c.clientId) ?? "",
    daysSinceLast: quietDays(c.clientId),
    usualGap: usualGap(c.clientId),
  });

  const ranked = clients
    .filter((c) => (curBy.get(c.clientId)?.revenue ?? 0) > 0)
    .map(line)
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "ru"));

  // ABC: A — клиенты, на которых приходится первые 80 % выручки, B — следующие 15 %, C — остальные.
  const abc: AbcBucket[] = (["A", "B", "C"] as const).map((key) => ({ key, clients: 0, revenue: 0, share: 0 }));
  let cum = 0;
  const clientRevenue = ranked.reduce((s, r) => s + r.revenue, 0);
  for (const r of ranked) {
    const before = clientRevenue > 0 ? (cum / clientRevenue) * 100 : 0;
    const bucket = before < 80 ? abc[0] : before < 95 ? abc[1] : abc[2];
    bucket.clients++;
    bucket.revenue += r.revenue;
    cum += r.revenue;
  }
  for (const b of abc) b.share = clientRevenue > 0 ? (b.revenue / clientRevenue) * 100 : 0;

  // Кому позвонить: покупал, но молчит дольше обычного и не меньше ATTENTION_DAYS.
  const quiet = clients
    .filter((c) => c.active && lastDay.has(c.clientId))
    .map(line)
    .filter((l) => l.daysSinceLast >= ATTENTION_DAYS && (l.usualGap === null || l.daysSinceLast > l.usualGap * ATTENTION_GAP_FACTOR))
    .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue || b.daysSinceLast - a.daysSinceLast);

  return {
    period,
    prevPeriod,
    current,
    previous,
    baseClients: clients.filter((c) => c.active).length,
    neverOrdered: clients.filter((c) => c.active && !lastDay.has(c.clientId)).length,
    debt: clients.reduce((s, c) => s + debtOf(c.clientId), 0),
    ordersWithoutClient: cur.filter((o) => !o.clientId).length,
    byManager,
    byCity,
    byType,
    byFlower,
    abc,
    top: ranked.slice(0, 10),
    quiet,
  };
}

/** «Молчит» по-старому (для подписи): дольше CLIENT_SLEEPING_DAYS. */
export const isLongSilent = (days: number) => days > CLIENT_SLEEPING_DAYS;
