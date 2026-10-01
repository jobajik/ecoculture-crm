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
import { DEBT_OVERDUE_DAYS, FARM_LABELS, FARM_ORDER, FLOWER_TYPE_LABELS, MONEY_EPSILON, ORDER_STATUSES, getFarmFor } from "./constants";
import { isConsignment, isNotASale } from "./orderKind";
import type { AttentionItem } from "./homeFocus";

export const DIGEST_SETTING = "DigestPhones";

/**
 * Кто стоит в продажах по компаниям ВСЕГДА, даже с нулём (владелец, 30.09:
 * «Ильяс, Эмиль, Бауыржан, Пожарка»). Узнаются по первому слову имени в
 * `Users`. Остальные менеджеры появляются, только если вчера продавали.
 */
export const DIGEST_ALWAYS = ["Ильяс", "Эмиль", "Бауыржан"];

/** Имя без «ы» после «ау» и в нижнем регистре: «Бауыржан» и «Бауржан» — один человек (в `Users` — «Бауржан»). */
const nameKey = (s: string) => (s || "").trim().toLowerCase().replace(/ё/g, "е").replace(/ауы/g, "ау");
export const POINT_LABEL = "Пожарка";

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
  items: { quantity: number; shippedQuantity: number; flowerType?: string; unitPrice?: number }[];
}

/** Остаток склада по цветку: всего стеблей и сколько из них дольше срока хранения. */
export interface DigestStock {
  flowerType: string;
  stems: number;
  expired: number;
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
  /** Остаток склада сейчас по цветкам. Пусто — блока «Склад» нет. */
  stock?: DigestStock[];
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

export interface FarmSalesRow {
  name: string;
  amount: number;
  stems: number;
  /** «Пожарка» — перемещение на точку, а не продажа. */
  point?: boolean;
}

export interface FarmSales {
  farm: string;
  label: string;
  amount: number;
  stems: number;
  rows: FarmSalesRow[];
}

const firstWord = (s: string) => (s || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

/**
 * Вчерашние продажи по компаниям: внутри — менеджеры и «Пожарка». Считается по
 * ПОЗИЦИЯМ: смешанная заявка попадает в обе компании своей долей. День — день
 * оформления, как у всех продаж. Наши магазины и опт на город сюда не идут.
 */
export function salesByFarm(input: DigestInput, day: string): FarmSales[] {
  const out = new Map<string, Map<string, FarmSalesRow>>();
  const rowOf = (farm: string, key: string, name: string, point = false) => {
    const m = out.get(farm) ?? new Map<string, FarmSalesRow>();
    out.set(farm, m);
    const r = m.get(key) ?? { name, amount: 0, stems: 0, ...(point ? { point: true } : {}) };
    m.set(key, r);
    return r;
  };
  const alwaysKeys = DIGEST_ALWAYS.map((label) => {
    const email = Object.keys(input.names).find((e) => nameKey(firstWord(input.names[e])) === nameKey(label));
    return { key: email ?? `name:${label.toLowerCase()}`, name: email ? input.names[email].trim().split(/\s+/)[0] : label };
  });
  for (const farm of FARM_ORDER) {
    for (const a of alwaysKeys) rowOf(farm, a.key, a.name);
    rowOf(farm, "point", POINT_LABEL, true);
  }
  for (const o of input.orders) {
    if (o.status === ORDER_STATUSES.CANCELLED || !o.createdAt || input.dayOf(o.createdAt) !== day) continue;
    const point = isConsignment(o);
    if (!point && isNotASale(o)) continue;
    const email = (o.managerEmail || "").toLowerCase();
    const name = (input.names[email] || email || "—").trim().split(/\s+/)[0];
    for (const it of o.items) {
      const farm = getFarmFor(it.flowerType ?? "");
      if (!farm) continue;
      const r = point ? rowOf(farm, "point", POINT_LABEL, true) : rowOf(farm, email, name);
      r.amount += it.quantity * (it.unitPrice ?? 0);
      r.stems += it.quantity;
    }
  }
  const alwaysSet = new Set(alwaysKeys.map((a) => a.key));
  return FARM_ORDER.map((farm) => {
    const all = Array.from(out.get(farm)?.entries() ?? []);
    const fixed = alwaysKeys.map((a) => out.get(farm)!.get(a.key)!);
    const others = all
      .filter(([k, r]) => k !== "point" && !alwaysSet.has(k) && r.stems > 0)
      .map(([, r]) => r)
      .sort((a, b) => b.amount - a.amount);
    const rows = [...fixed, ...others, out.get(farm)!.get("point")!];
    return {
      farm,
      label: FARM_LABELS[farm] ?? farm,
      amount: rows.reduce((s, r) => s + r.amount, 0),
      stems: rows.reduce((s, r) => s + r.stems, 0),
      rows,
    };
  });
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

/**
 * Сводка ДВУМЯ сообщениями (владелец: «чтобы не было кнопки „Далее“» —
 * WhatsApp сворачивает длинное сообщение): первое — вчера и продажи по
 * компаниям, второе — склад, отгрузка, долги, «требует внимания» и ссылка.
 * WhatsApp понимает *жирный* — им отмечены заголовки.
 */
export function digestParts(input: DigestInput): string[] {
  const n = digestNumbers(input);
  const lines: string[] = [`*Доброе утро! Сводка Ecoculture на ${dm(input.today)}*`, ""];
  lines.push(`*Вчера, ${dm(n.yesterday)}:*`);
  if (n.sales.count) {
    lines.push(`• заявок ${num(n.sales.count)} на *${money(n.sales.amount)}* (без Пожарки)`);
  } else {
    lines.push("• заявок не оформляли");
  }
  lines.push(`• пришло денег: *${money(n.money)}*`);
  if (n.point > 0) lines.push(`• выручка точки на базаре: *${money(n.point)}*`);
  for (const f of salesByFarm(input, n.yesterday)) {
    lines.push("");
    // Сначала штуки, потом деньги — жирным (владелец: «выделить деньги»).
    lines.push(`*${f.label}:* ${num(f.stems)} шт. — *${money(f.amount)}*`);
    for (const r of f.rows) lines.push(`• ${r.name}: ${r.stems ? `${num(r.stems)} шт. — *${money(r.amount)}*` : "—"}`);
  }
  const first = lines.splice(0, lines.length).join("\n");
  if (input.stock && input.stock.length) {
    // Каждый цветок — своим абзацем (владелец, 01.10: одной строкой на компанию
    // «роза …, из них …; эустома …» читалось тяжело).
    lines.push("*Склад сейчас:*");
    for (const farm of FARM_ORDER) {
      const rows = input.stock.filter((x) => getFarmFor(x.flowerType) === farm && x.stems > 0);
      if (!rows.length) continue;
      lines.push("");
      lines.push(`*${FARM_LABELS[farm] ?? farm}*`);
      rows.forEach((x, i) => {
        if (i > 0) lines.push("");
        lines.push(`${FLOWER_TYPE_LABELS[x.flowerType] ?? x.flowerType}: *${num(x.stems)} шт.*`);
        if (x.expired > 0) lines.push(`дольше срока: ${num(x.expired)} шт.`);
      });
    }
  }
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
  return [first, lines.join("\n").trim()];
}

/** Вся сводка одним текстом — для предпросмотра и проверок. */
export function digestText(input: DigestInput): string {
  return digestParts(input).join("\n\n");
}
