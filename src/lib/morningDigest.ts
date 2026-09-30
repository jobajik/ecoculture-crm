/**
 * Утренняя сводка владельцу в WhatsApp (сентябрь 2026, владелец: «в 9:00:
 * вчерашняя выручка, кто опаздывает с отгрузкой, долги, что залежалось на
 * складе и выручка точки на базаре — открывать сайт не нужно»).
 *
 * Уходит с рабочего номера (Green API) на номера из настройки `DigestPhones`
 * («Настройки → Утренняя сводка»). Числа — теми же правилами, что на сайте:
 * продажи — по дню оформления без наших магазинов, городов и точки
 * (`isNotASale`), деньги — по дню поступления, «требует внимания» — тот же
 * список, что на главной у владельца (`homeFocus`).
 */
import { DEBT_OVERDUE_DAYS, MONEY_EPSILON, ORDER_STATUSES } from "./constants";
import { isNotASale } from "./orderKind";
import type { AttentionItem } from "./homeFocus";

export const DIGEST_SETTING = "DigestPhones";

export interface DigestOrder {
  orderId: string;
  createdAt: string;
  deliveryDate: string;
  status: string;
  managerEmail: string;
  totalAmount: number;
  paidAmount: number;
  retail?: string;
  kind?: string;
  direction?: string;
  items: { quantity: number; shippedQuantity: number }[];
}

export interface DigestInput {
  today: string;
  orders: DigestOrder[];
  /** Платежи: день поступления и сумма. */
  payments: { date: string; amount: number }[];
  /** Выручка точки на базаре по дням. */
  pointDays: { date: string; kaspi: number; cash: number }[];
  attention: AttentionItem[];
  names: Record<string, string>;
  /** День оформления заявки по Алматы (сервер передаёт свой `localDayKey`). */
  dayOf: (iso: string) => string;
  site: string;
}

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const num = (v: number) => Math.round(v).toLocaleString("ru-RU");
const dm = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}`;

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Номера для сводки из настройки: через запятую, пробел или с новой строки. */
export function digestPhones(raw: string | null | undefined): string[] {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[,;\n]+/)
        .map((p) => p.trim())
        .filter(Boolean)
    )
  );
}

export interface DigestNumbers {
  yesterday: string;
  sales: { count: number; amount: number; byManager: { name: string; count: number; amount: number }[] };
  money: number;
  point: number;
  today: { count: number; stems: number };
  debt: number;
  overdue: number;
}

export function digestNumbers(input: DigestInput): DigestNumbers {
  const y = addDays(input.today, -1);
  const live = input.orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED);
  const sales = live.filter((o) => !isNotASale(o) && o.createdAt && input.dayOf(o.createdAt) === y);
  const byManager = new Map<string, { name: string; count: number; amount: number }>();
  for (const o of sales) {
    const key = (o.managerEmail || "").toLowerCase();
    const row = byManager.get(key) ?? { name: input.names[key] || key || "—", count: 0, amount: 0 };
    row.count += 1;
    row.amount += o.totalAmount;
    byManager.set(key, row);
  }
  const todayOrders = live.filter(
    (o) => o.deliveryDate === input.today && o.status !== ORDER_STATUSES.SHIPPED
  );
  let debt = 0;
  let overdue = 0;
  const edge = addDays(input.today, -DEBT_OVERDUE_DAYS);
  for (const o of live) {
    if (isNotASale(o)) continue;
    const rest = o.totalAmount - o.paidAmount;
    if (rest <= MONEY_EPSILON) continue;
    debt += rest;
    const basis = o.deliveryDate || (o.createdAt ? input.dayOf(o.createdAt) : "");
    if (basis && basis < edge) overdue += rest;
  }
  const point = input.pointDays.filter((d) => d.date === y).reduce((s, d) => s + d.kaspi + d.cash, 0);
  return {
    yesterday: y,
    sales: {
      count: sales.length,
      amount: sales.reduce((s, o) => s + o.totalAmount, 0),
      byManager: Array.from(byManager.values()).sort((a, b) => b.amount - a.amount),
    },
    money: input.payments.filter((p) => p.date === y).reduce((s, p) => s + p.amount, 0),
    point,
    today: {
      count: todayOrders.length,
      stems: todayOrders.reduce((s, o) => s + o.items.reduce((t, i) => t + Math.max(0, i.quantity - i.shippedQuantity), 0), 0),
    },
    debt,
    overdue,
  };
}

/** Текст сводки. WhatsApp понимает *жирный* — им отмечены заголовки. */
export function digestText(input: DigestInput): string {
  const n = digestNumbers(input);
  const lines: string[] = [`*Доброе утро! Сводка Eco Culture на ${dm(input.today)}*`, ""];
  lines.push(`*Вчера, ${dm(n.yesterday)}:*`);
  if (n.sales.count) {
    lines.push(`• заявок ${num(n.sales.count)} на ${money(n.sales.amount)}`);
    const top = n.sales.byManager.slice(0, 4).map((m) => `${m.name} ${num(m.count)} · ${money(m.amount)}`);
    if (top.length) lines.push(`  ${top.join("; ")}`);
  } else {
    lines.push("• заявок не оформляли");
  }
  lines.push(`• пришло денег: ${money(n.money)}`);
  if (n.point > 0) lines.push(`• точка на базаре: ${money(n.point)}`);
  lines.push("");
  lines.push(
    n.today.count
      ? `*Сегодня к отгрузке:* ${num(n.today.count)} заявок, ${num(n.today.stems)} шт.`
      : "*Сегодня к отгрузке:* заявок с доставкой на сегодня нет"
  );
  lines.push(`*Долги:* ${money(n.debt)}${n.overdue > 0 ? `, из них просрочено ${money(n.overdue)}` : ""}`);
  // Просроченные долги уже стоят строкой «Долги» — второй раз не повторяем.
  const attention = input.attention.filter((a) => a.href !== "/finance/debts");
  if (attention.length) {
    lines.push("");
    lines.push("*Требует внимания:*");
    for (const a of attention.slice(0, 6)) lines.push(`• ${a.label}${a.detail ? ` — ${a.detail}` : ""}`);
  }
  lines.push("");
  lines.push(input.site);
  return lines.join("\n");
}
