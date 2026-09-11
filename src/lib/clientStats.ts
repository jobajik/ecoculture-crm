import { CLIENT_SLEEPING_DAYS, MONEY_EPSILON, ORDER_STATUSES } from "./constants";
import type { Client, OrderWithItems } from "./types";
import { isOwnShop } from "./retail";
import { hasNoClientInvoice } from "./orderKind";

/**
 * Аналитика по клиентской базе.
 *
 * Отвечает на вопросы, на которые до сих пор ответить было нельзя: кто у нас
 * вообще покупает, сколько в среднем берёт, кто пропал, в какие города возим,
 * и сколько клиентов у каждого менеджера. Раньше клиент существовал только как
 * имя, вписанное в заявку руками, — а по вписанным руками именам это не
 * считается.
 *
 * Функция чистая: данные передаются внутрь, читает их страница. Так её можно
 * проверить тестом (`scripts/check-clients.ts`) и не ходить в таблицу трижды.
 *
 * Два правила, общие со всеми деньгами в проекте:
 *  - отменённые заявки не считаются нигде;
 *  - собранными деньгами считается не больше суммы счёта: переплата — это долг
 *    перед клиентом, а не выручка.
 */

export interface ClientStatRow {
  client: Client;
  managerName: string;
  /** Сколько заявок оформлено (кроме отменённых). */
  orders: number;
  /** На какую сумму — по счетам, а не по деньгам. */
  revenue: number;
  /** Сколько денег реально получено. */
  paid: number;
  /** Сколько ещё должен. */
  debt: number;
  stems: number;
  /** Средний чек: выручка на заявку. */
  avgCheck: number;
  /** Средний размер заявки в стеблях — по нему видно, крупный клиент или мелкий. */
  avgStems: number;
  firstOrderDate: string;
  lastOrderDate: string;
  /** Сколько дней прошло с последнего заказа. -1 — заказов не было вовсе. */
  daysSinceLast: number;
  /** Давно молчит: повод позвонить, а не ждать. */
  sleeping: boolean;
  /** Ни одной заявки — карточка есть, продаж нет. */
  neverOrdered: boolean;
  /** Что берёт чаще всего: «Роза 60 см», «Хризантема Высшая». */
  topPosition: string;
}

export interface ClientGroupRow {
  key: string;
  label: string;
  clients: number;
  orders: number;
  revenue: number;
  /** Доля в общей выручке, 0–100. */
  share: number;
  avgCheck: number;
}

export interface ClientStats {
  rows: ClientStatRow[];
  totals: {
    clients: number;
    activeClients: number;
    sleepingClients: number;
    neverOrderedClients: number;
    orders: number;
    revenue: number;
    paid: number;
    debt: number;
    avgCheck: number;
    /** Средняя выручка на клиента — сколько «стоит» один клиент базы. */
    revenuePerClient: number;
    /** Доля выручки трёх крупнейших клиентов: зависимость от нескольких точек. */
    top3Share: number;
  };
  byManager: ClientGroupRow[];
  byCity: ClientGroupRow[];
  byType: ClientGroupRow[];
  /** Заявки, оформленные без карточки клиента, — их надо привязать руками. */
  ordersWithoutClient: number;
}

function dayKey(value: string): string {
  return value ? value.slice(0, 10) : "";
}

function daysBetween(fromKey: string, now: Date): number {
  if (!fromKey) return -1;
  const [y, m, d] = fromKey.split("-").map(Number);
  if (!y || !m || !d) return -1;
  const from = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - from.getTime()) / 86_400_000));
}

/** Группировка по произвольному ключу: менеджер, город, тип точки. */
function group(
  rows: ClientStatRow[],
  keyOf: (row: ClientStatRow) => string,
  labelOf: (row: ClientStatRow) => string,
  totalRevenue: number
): ClientGroupRow[] {
  const map = new Map<string, ClientGroupRow>();
  for (const row of rows) {
    const key = keyOf(row) || "—";
    const item = map.get(key) ?? {
      key,
      label: labelOf(row) || "Не указано",
      clients: 0,
      orders: 0,
      revenue: 0,
      share: 0,
      avgCheck: 0,
    };
    item.clients += 1;
    item.orders += row.orders;
    item.revenue += row.revenue;
    map.set(key, item);
  }
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      share: totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0,
      avgCheck: g.orders > 0 ? g.revenue / g.orders : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.clients - a.clients);
}

export function buildClientStats(input: {
  clients: Client[];
  orders: OrderWithItems[];
  nameByEmail: Map<string, string>;
  now?: Date;
  /** Как называется позиция в отчёте «что берёт чаще всего». */
  positionLabel: (flowerType: string, grade: string) => string;
}): ClientStats {
  const now = input.now ?? new Date();
  // Наш магазин — не клиент, и его заявки не продажи. Иначе средний чек,
  // выручка и «доля трёх крупнейших клиентов» считались бы по самим себе.
  const counted = input.orders.filter(
    (o) => o.status !== ORDER_STATUSES.CANCELLED && !hasNoClientInvoice(o)
  );

  const byClient = new Map<string, OrderWithItems[]>();
  let ordersWithoutClient = 0;
  for (const order of counted) {
    if (!order.clientId) {
      ordersWithoutClient++;
      continue;
    }
    const list = byClient.get(order.clientId) ?? [];
    list.push(order);
    byClient.set(order.clientId, list);
  }

  // Карточки наших магазинов из клиентской базы убираются целиком: это не
  // «клиент, который ничего не покупал», а вообще другая сущность, и в разрезах
  // по городам и менеджерам ей делать нечего.
  const rows: ClientStatRow[] = input.clients.filter((c) => !isOwnShop(c)).map((client) => {
    const orders = byClient.get(client.clientId) ?? [];

    let revenue = 0;
    let paid = 0;
    let stems = 0;
    const positions = new Map<string, number>();
    let first = "";
    let last = "";

    for (const order of orders) {
      const amount = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      revenue += amount;
      // Переплата — это долг перед клиентом, а не наша выручка.
      paid += Math.min(order.paidAmount, amount);
      stems += order.items.reduce((sum, i) => sum + i.quantity, 0);

      for (const item of order.items) {
        const label = input.positionLabel(item.flowerType, item.grade);
        positions.set(label, (positions.get(label) ?? 0) + item.quantity);
      }

      const day = dayKey(order.createdAt);
      if (day) {
        if (!first || day < first) first = day;
        if (!last || day > last) last = day;
      }
    }

    const debt = revenue - paid > MONEY_EPSILON ? revenue - paid : 0;
    const daysSinceLast = daysBetween(last, now);
    const top = Array.from(positions.entries()).sort((a, b) => b[1] - a[1])[0];

    return {
      client,
      managerName: input.nameByEmail.get(client.managerEmail) ?? client.managerEmail,
      orders: orders.length,
      revenue,
      paid,
      debt,
      stems,
      avgCheck: orders.length > 0 ? revenue / orders.length : 0,
      avgStems: orders.length > 0 ? stems / orders.length : 0,
      firstOrderDate: first,
      lastOrderDate: last,
      daysSinceLast,
      // «Молчит» — только про тех, кто когда-то покупал. Новая карточка без
      // заказов — это не потерянный клиент, а ещё не начатая работа.
      sleeping: orders.length > 0 && daysSinceLast > CLIENT_SLEEPING_DAYS,
      neverOrdered: orders.length === 0,
      topPosition: top ? top[0] : "",
    };
  });

  const revenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const paid = rows.reduce((sum, r) => sum + r.paid, 0);
  const orders = rows.reduce((sum, r) => sum + r.orders, 0);
  const top3 = [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 3);
  const top3Revenue = top3.reduce((sum, r) => sum + r.revenue, 0);

  return {
    rows: rows.sort((a, b) => b.revenue - a.revenue || a.client.name.localeCompare(b.client.name, "ru")),
    totals: {
      clients: rows.length,
      activeClients: rows.filter((r) => r.orders > 0 && !r.sleeping).length,
      sleepingClients: rows.filter((r) => r.sleeping).length,
      neverOrderedClients: rows.filter((r) => r.neverOrdered).length,
      orders,
      revenue,
      paid,
      debt: rows.reduce((sum, r) => sum + r.debt, 0),
      avgCheck: orders > 0 ? revenue / orders : 0,
      revenuePerClient: rows.length > 0 ? revenue / rows.length : 0,
      top3Share: revenue > 0 ? (top3Revenue / revenue) * 100 : 0,
    },
    byManager: group(rows, (r) => r.client.managerEmail, (r) => r.managerName, revenue),
    byCity: group(rows, (r) => r.client.city.trim().toLowerCase(), (r) => r.client.city, revenue),
    byType: group(rows, (r) => r.client.clientType, (r) => r.client.clientType, revenue),
    ordersWithoutClient,
  };
}
