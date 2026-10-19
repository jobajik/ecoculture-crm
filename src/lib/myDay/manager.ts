import { ORDER_STATUSES } from "../constants";
import { isClosedStage, type LeadRow } from "../leads";
import { nextTouchLabel } from "../leadsView";
import { orderStage } from "../orderStage";
import { isOwnSellable, type FocusOrder } from "../homeFocus";
import { paceOf } from "../planOverview";
import { isAssistantOrder } from "../sellerChannel";
import { orderCode } from "../paymentStage";
import type { ChatSummary } from "../waLines";
import type { AssistantLogRow } from "../repo/waLines";
import type { LeaderboardRow } from "../leaderboard";

/**
 * «Мой день» менеджера (19.10.2026, макет принят владельцем): что надо сделать сейчас — кто ждёт ответа в
 * WhatsApp, какие заявки ждут его галочки или без даты, какие касания лидов на сегодня, как идёт месяц и что за
 * сутки сделал ИИ-помощник. Чистые функции над уже прочитанными данными: правила те же, что на страницах
 * («ждёт ответа» — `buildChatList`, этап заявки — `orderStage`, касания — `buildLeadRows`), здесь они только
 * складываются в экран. Проверка — `scripts/check-myday-manager.ts`.
 */

export interface DayChat {
  line: string;
  phone: string;
  name: string;
  /** Кто это: клиент / лид / ничей номер. */
  who: string;
  lastText: string;
  waitingMinutes: number;
  /** Ждёт дольше часа — красным. */
  long: boolean;
  href: string;
}

export interface DayOrder {
  orderId: string;
  code: string;
  clientName: string;
  deliveryLabel: string;
  itemsLabel: string;
  amount: number;
  href: string;
}

export interface DayLead {
  leadId: string;
  name: string;
  city: string;
  /** «сегодня», «просрочено 2 дн.». */
  when: string;
  overdue: boolean;
  lastComment: string;
  href: string;
}

export interface MonthProgress {
  /** Оформлено за месяц (как в рейтинге). */
  sold: number;
  target: number;
  /** Выполнение плана, %; null — плана нет. */
  percent: number | null;
  pacePercent: number;
  /** Выше темпа месяца — зелёный, отстаёт больше чем на 15 п.п. — красный. */
  tone: "good" | "warn" | "bad" | "muted";
  bonus: number;
  pendingBonus: number;
  orders: number;
}

export interface AssistantDigest {
  replies: number;
  orders: { code: string; clientName: string; amount: number; href: string }[];
  openNotes: number;
  /** Есть ли у менеджера подключённый номер с помощником. */
  hasLine: boolean;
}

export interface ManagerDay {
  summary: string;
  chats: { rows: DayChat[]; total: number };
  waitingMe: { rows: DayOrder[]; total: number };
  noDate: { rows: DayOrder[]; total: number };
  openOrders: number;
  leads: { rows: DayLead[]; total: number };
  month: MonthProgress;
  assistant: AssistantDigest;
}

export const DAY_ROWS = 5;
/** Ждёт дольше часа — уже плохо. */
export const LONG_WAIT_MINUTES = 60;
/** Отставание от темпа месяца, после которого полоска красная. */
export const BEHIND_MARGIN = 15;

export type DayOrderInput = Omit<FocusOrder, "items"> & {
  clientName: string;
  notes?: string | null;
  items: { variety: string; grade: string; quantity: number; shippedQuantity: number }[];
};

const minutesSince = (iso: string, now: Date) => Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));

/** Кто ждёт ответа на номерах менеджера: дольше всех ждущие — первыми. */
export function waitingChats(chats: ChatSummary[], now: Date): { rows: DayChat[]; total: number } {
  const waiting = chats
    .filter((c) => c.waitingSince)
    .map((c) => {
      const waitingMinutes = minutesSince(c.waitingSince as string, now);
      return {
        line: c.line,
        phone: c.phone,
        name: c.name,
        who: c.party ? (c.party.kind === "client" ? "клиент" : "лид") : "новый номер",
        lastText: c.lastText,
        waitingMinutes,
        long: waitingMinutes >= LONG_WAIT_MINUTES,
        href: `/clients/chats?line=${encodeURIComponent(c.line)}&phone=${encodeURIComponent(c.phone)}`,
      };
    })
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes);
  return { rows: waiting.slice(0, DAY_ROWS), total: waiting.length };
}

function itemsLabel(items: DayOrderInput["items"]): string {
  const parts = items.slice(0, 2).map((i) => `${[i.variety, i.grade].filter(Boolean).join(" ")} — ${i.quantity.toLocaleString("ru-RU")}`);
  return items.length > 2 ? `${parts.join(" · ")} · ещё ${items.length - 2}` : parts.join(" · ");
}

function deliveryLabel(deliveryDate: string, today: string, formatDay: (iso: string) => string): string {
  if (!deliveryDate) return "без даты";
  if (deliveryDate === today) return "сегодня";
  const t = new Date(`${today}T00:00:00`);
  t.setDate(t.getDate() + 1);
  if (deliveryDate === t.toISOString().slice(0, 10)) return "завтра";
  return formatDay(deliveryDate);
}

/** Заявки менеджера, где нужен он сам: ждут его галочки и без даты доставки. Чужие и городские — не его. */
export function managerOrders(
  orders: DayOrderInput[],
  email: string,
  today: string,
  formatDay: (iso: string) => string
): { waitingMe: { rows: DayOrder[]; total: number }; noDate: { rows: DayOrder[]; total: number }; open: number } {
  const me = email.toLowerCase();
  const mine = orders
    .filter((o) => (o.managerEmail || "").toLowerCase() === me && isOwnSellable(o) && o.status !== ORDER_STATUSES.CANCELLED)
    .map((o) => ({ o, st: orderStage(o, today) }))
    .filter(({ st }) => st.key !== "shipped" && st.key !== "cancelled");
  const row = (o: DayOrderInput): DayOrder => ({
    orderId: o.orderId,
    code: orderCode(o.orderId),
    clientName: o.clientName || "без клиента",
    deliveryLabel: deliveryLabel(o.deliveryDate, today, formatDay),
    itemsLabel: itemsLabel(o.items),
    amount: o.totalAmount,
    href: `/orders/${encodeURIComponent(o.orderId)}`,
  });
  // Ближайшая доставка — первой; без даты — по давности оформления.
  const byDelivery = (a: { o: DayOrderInput }, b: { o: DayOrderInput }) => (a.o.deliveryDate || "9999").localeCompare(b.o.deliveryDate || "9999");
  const waiting = mine.filter(({ st }) => st.key === "wait_confirm").sort(byDelivery);
  const noDate = mine.filter(({ o }) => !o.deliveryDate).sort((a, b) => (a.o.createdAt || "").localeCompare(b.o.createdAt || ""));
  return {
    waitingMe: { rows: waiting.slice(0, DAY_ROWS).map(({ o }) => row(o)), total: waiting.length },
    noDate: { rows: noDate.slice(0, DAY_ROWS).map(({ o }) => row(o)), total: noDate.length },
    open: mine.length,
  };
}

/** Касания на сегодня и просроченные — по своим лидам; просроченные первыми, самые давние сверху. */
export function managerLeads(rows: LeadRow[], email: string, today: string, formatDay: (iso: string) => string): { rows: DayLead[]; total: number } {
  const me = email.toLowerCase();
  const due = rows
    .filter((r) => (r.managerEmail || "").toLowerCase() === me && !isClosedStage(r.stage) && (r.overdue || r.dueToday))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.nextTouchAt || "").localeCompare(b.nextTouchAt || ""));
  return {
    rows: due.slice(0, DAY_ROWS).map((r) => ({
      leadId: r.leadId,
      name: r.name || `Лид ${r.phone}`,
      city: r.city,
      when: nextTouchLabel(r, today, formatDay),
      overdue: r.overdue,
      lastComment: r.lastComment,
      href: `/clients/leads/${encodeURIComponent(r.leadId)}`,
    })),
    total: due.length,
  };
}

/** Как идёт месяц: оформлено против плана, рядом темп месяца (какая доля месяца прошла). */
export function monthProgress(row: LeaderboardRow | undefined, today: string): MonthProgress {
  const pace = paceOf(today.slice(0, 7), today).pacePercent;
  const sold = row?.totalAmount ?? 0;
  const target = row?.targetAmount ?? 0;
  const percent = target > 0 ? (sold / target) * 100 : null;
  const tone: MonthProgress["tone"] = percent === null ? "muted" : percent >= pace ? "good" : percent >= pace - BEHIND_MARGIN ? "warn" : "bad";
  return { sold, target, percent, pacePercent: pace, tone, bonus: row?.bonus ?? 0, pendingBonus: row?.pendingBonus ?? 0, orders: row?.orders ?? 0 };
}

/** Что сделал ИИ-помощник на номерах менеджера с `sinceIso`: ответил сам, оформил заказы, оставил записки. */
export function assistantDigest(
  log: AssistantLogRow[],
  orders: DayOrderInput[],
  lineCodes: string[],
  email: string,
  sinceIso: string
): AssistantDigest {
  const lines = new Set(lineCodes);
  const mine = log.filter((r) => lines.has(r.line));
  const me = email.toLowerCase();
  return {
    hasLine: lineCodes.length > 0,
    replies: mine.filter((r) => (r.kind === "auto" || r.kind === "nudge") && r.at >= sinceIso && r.messageId).length,
    openNotes: mine.filter((r) => r.kind === "note" && !r.doneAt).length,
    orders: orders
      .filter((o) => (o.managerEmail || "").toLowerCase() === me && isAssistantOrder(o) && (o.createdAt || "") >= sinceIso && o.status !== ORDER_STATUSES.CANCELLED)
      .map((o) => ({ code: orderCode(o.orderId), clientName: o.clientName || "без клиента", amount: o.totalAmount, href: `/orders/${encodeURIComponent(o.orderId)}` })),
  };
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

export function buildManagerDay(input: {
  email: string;
  today: string;
  now: Date;
  chats: ChatSummary[];
  orders: DayOrderInput[];
  leads: LeadRow[];
  leaderboard?: LeaderboardRow;
  assistantLog: AssistantLogRow[];
  lineCodes: string[];
  formatDay: (iso: string) => string;
}): ManagerDay {
  const chats = waitingChats(input.chats, input.now);
  const o = managerOrders(input.orders, input.email, input.today, input.formatDay);
  const leads = managerLeads(input.leads, input.email, input.today, input.formatDay);
  const since = new Date(input.now.getTime() - 24 * 3_600_000).toISOString();
  const parts: string[] = [];
  if (chats.total) parts.push(`${chats.total} ${plural(chats.total, "клиент ждёт", "клиента ждут", "клиентов ждут")} ответа`);
  if (o.waitingMe.total) parts.push(`${o.waitingMe.total} ${plural(o.waitingMe.total, "заявка ждёт", "заявки ждут", "заявок ждут")} вашей галочки`);
  if (o.noDate.total) parts.push(`${o.noDate.total} без даты доставки`);
  if (leads.total) parts.push(`${leads.total} ${plural(leads.total, "касание", "касания", "касаний")} на сегодня`);
  return {
    summary: parts.length ? parts.join(" · ") : "Никто не ждёт — можно продавать.",
    chats,
    waitingMe: o.waitingMe,
    noDate: o.noDate,
    openOrders: o.open,
    leads,
    month: monthProgress(input.leaderboard, input.today),
    assistant: assistantDigest(input.assistantLog, input.orders, input.lineCodes, input.email, since),
  };
}
