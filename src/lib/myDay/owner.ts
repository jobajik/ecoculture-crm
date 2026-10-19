import { FARM_ORDER, ORDER_STATUSES, farmLabel, getFarmFor } from "../constants";
import { isNotASale } from "../orderKind";
import { isAssistantOrder } from "../sellerChannel";
import { isBotEmail } from "../botIdentity";
import { isAdsLead } from "../leads";
import { normalizeStore, storeLabel } from "../officeStore";
import { isReadyToShip } from "../orderReady";
import { deliveryGroup } from "../shipQueue";
import type { AttentionItem } from "../homeFocus";
import type { ManagerSalesRow } from "../salesAnalytics";
import type { StockCompanyRow } from "../stock";
import type { RecipientRow } from "../broadcast";
import type { AssistantLogRow } from "../repo/waLines";
import type { Lead, OrderWithItems, Payment, WaMessage } from "../types";

/**
 * «Мой день» владельца и РОПа (19.10.2026, макет принят владельцем): не «как идут дела» (это в аналитике), а
 * что сейчас горит, где стоят продажи против темпа, что сделали ИИ-помощники за сутки и что сегодня уедет со
 * складов. Чистая функция — всё из уже прочитанного, проверка `scripts/check-myday-owner.ts`.
 *
 * Правила счёта те же, что на соседних страницах: продажи — по дню ОФОРМЛЕНИЯ, без отменённых и не-продаж
 * (`isNotASale`); деньги — по дню ПОСТУПЛЕНИЯ (`Payments.date`), как касса; долги — по всей базе (из `homeFocus`
 * и `getFinanceSnapshot`); «ждут ответа» — чаты номера менеджера, где последним писал клиент не старше трёх дней.
 */
export interface OwnerDayInput {
  today: string;
  /** Сегодняшний месяц «ГГГГ-ММ». */
  month: string;
  /** Доля месяца, прошедшая к сегодняшнему дню, 0–100 (`paceOf`). */
  pacePercent: number;
  orders: OrderWithItems[];
  managers: ManagerSalesRow[];
  totals: { amountMonth: number; targetAmount: number };
  payments: Payment[];
  debts: { total: number; overdue: number; overdueOrders: number; openOrders: number };
  stock: { overall: StockCompanyRow; companies: StockCompanyRow[] };
  push: { text: string; sold7: number }[];
  attention: AttentionItem[];
  /** Линии менеджеров: код → почта менеджера. */
  managerLines: { code: string; managerEmail: string }[];
  messages: WaMessage[];
  assistantLog: AssistantLogRow[];
  recipients: RecipientRow[];
  leads: Lead[];
  /** Имя по почте — для бота и менеджеров без строки в снимке. */
  nameByEmail: Map<string, string>;
  /** Миллисекунды «сейчас» — для окон «за сутки». */
  nowMs: number;
  /** День по Алматы для ISO-момента. */
  toDay: (iso: string) => string;
}

export type ManagerTone = "good" | "warn" | "bad" | "none";

export interface OwnerManagerRow {
  email: string;
  name: string;
  amount: number;
  target: number;
  /** Процент плана; null — плана нет. */
  percent: number | null;
  tone: ManagerTone;
  orders: number;
  /** Чатов на номере менеджера, где последним писал клиент. */
  waiting: number;
}

export interface OwnerDay {
  summary: { yesterdayAmount: number; yesterdayOrders: number; yesterdayReceived: number; attentionCount: number };
  sales: { amount: number; target: number; percent: number | null; pacePercent: number; tone: ManagerTone };
  money: { week: number; byFarm: { farm: string; label: string; amount: number }[] };
  debts: { total: number; overdue: number; overdueOrders: number; openOrders: number };
  stock: { stems: number; criticalStems: number; criticalShare: number; push: string };
  attention: AttentionItem[];
  managers: OwnerManagerRow[];
  ai: {
    broadcastSent: number;
    broadcastReplied: number;
    broadcastOrders: number;
    assistantReplies: number;
    assistantOrders: number;
    assistantNotes: number;
    botChats: number;
    botOrders: number;
    adsLeads: number;
  };
  companies: { farm: string; label: string; stems: number; okShare: number; warnShare: number; badShare: number; criticalShare: number }[];
  shipToday: { label: string; orders: number; stems: number }[];
}

const DAY_MS = 86_400_000;
/** Клиент ждёт ответа — пока его сообщение не старше трёх дней; дальше разговор считается законченным. */
const WAITING_DAYS = 3;
/** Подняться выше темпа — хорошо; отстать больше чем на 15 п.п. — плохо (как `BEHIND_MARGIN` в обзоре планов). */
const BEHIND_MARGIN = 15;

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

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

const stemsLeft = (o: OrderWithItems) => o.items.reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0);

/** Сколько чатов номера менеджера ждут ответа: последнее сообщение — входящее, не старше трёх дней. */
export function waitingChatsByLine(messages: WaMessage[], nowMs: number): Map<string, number> {
  const last = new Map<string, WaMessage>();
  for (const m of messages) {
    const line = (m.line || "").trim();
    if (!line.startsWith("m-")) continue;
    const key = `${line}|${m.phone}`;
    const prev = last.get(key);
    if (!prev || m.at > prev.at) last.set(key, m);
  }
  const out = new Map<string, number>();
  for (const [key, m] of last) {
    if (m.direction !== "in") continue;
    const at = Date.parse(m.at);
    if (!Number.isFinite(at) || nowMs - at > WAITING_DAYS * DAY_MS) continue;
    const line = key.slice(0, key.indexOf("|"));
    out.set(line, (out.get(line) ?? 0) + 1);
  }
  return out;
}

export function buildOwnerDay(input: OwnerDayInput): OwnerDay {
  const { today, orders, payments, toDay, nowMs } = input;
  const yesterday = prevDay(today);
  const sales = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && o.createdAt);
  const yesterdayOrders = sales.filter((o) => toDay(o.createdAt) === yesterday);

  // Деньги — по дню поступления: вчера и последние 7 дней (сегодня и шесть дней до него), по компаниям.
  const weekFrom = shiftDay(today, -6);
  const weekPayments = payments.filter((p) => p.date >= weekFrom && p.date <= today);
  const byFarm = new Map<string, number>();
  for (const p of weekPayments) byFarm.set(p.farm || "", (byFarm.get(p.farm || "") ?? 0) + p.amount);
  const farms = [...FARM_ORDER, ...Array.from(byFarm.keys()).filter((f) => f && !FARM_ORDER.includes(f))];
  const moneyByFarm = farms
    .map((farm) => ({ farm, label: farmLabel(farm), amount: byFarm.get(farm) ?? 0 }))
    .filter((r) => r.amount > 0 || FARM_ORDER.includes(r.farm));
  const unassigned = byFarm.get("") ?? 0;
  if (unassigned > 0) moneyByFarm.push({ farm: "", label: "без компании", amount: unassigned });

  // Продажи против темпа.
  const percent = input.totals.targetAmount > 0 ? (input.totals.amountMonth / input.totals.targetAmount) * 100 : null;

  // Менеджеры: все, кто в снимке продаж (бот — без плана), плюс «ждут ответа» по номеру менеджера.
  const waiting = waitingChatsByLine(input.messages, nowMs);
  const waitingByEmail = new Map<string, number>();
  for (const l of input.managerLines) waitingByEmail.set(l.managerEmail.toLowerCase(), (waitingByEmail.get(l.managerEmail.toLowerCase()) ?? 0) + (waiting.get(l.code) ?? 0));
  const managers: OwnerManagerRow[] = input.managers
    .map((m) => {
      const pct = m.targetAmount > 0 ? (m.amountMonth / m.targetAmount) * 100 : null;
      return {
        email: m.managerEmail,
        name: isBotEmail(m.managerEmail) ? "Бот и ИИ" : input.nameByEmail.get(m.managerEmail) || m.name,
        amount: m.amountMonth,
        target: m.targetAmount,
        percent: pct,
        tone: isBotEmail(m.managerEmail) ? "none" : managerTone(pct, input.pacePercent),
        orders: m.ordersMonth,
        waiting: waitingByEmail.get(m.managerEmail) ?? 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // ИИ за сутки.
  const dayAgo = nowMs - DAY_MS;
  const fresh = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= dayAgo;
  };
  const sentRows = input.recipients.filter((r) => r.sentAt && fresh(r.sentAt));
  const sentPhones = new Set(sentRows.map((r) => r.phone.replace(/\D/g, "").slice(-10)));
  const repliedPhones = new Set(
    input.messages
      .filter((m) => m.direction === "in" && fresh(m.at) && sentPhones.has(m.phone.replace(/\D/g, "").slice(-10)))
      .map((m) => m.phone.replace(/\D/g, "").slice(-10))
  );
  const freshOrders = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && fresh(o.createdAt));
  const botOrders = freshOrders.filter((o) => isBotEmail(o.managerEmail));
  const assistantOrders = freshOrders.filter((o) => isAssistantOrder(o));
  const broadcastOrders = freshOrders.filter((o) => {
    const key = (o.clientPhone || "").replace(/\D/g, "").slice(-10);
    return key && sentPhones.has(key) && !isBotEmail(o.managerEmail);
  });
  const log = input.assistantLog.filter((r) => fresh(r.at));
  const mainIncoming = new Set(input.messages.filter((m) => !(m.line || "").trim() && m.direction === "in" && fresh(m.at)).map((m) => m.phone));
  const adsLeads = input.leads.filter((l) => isAdsLead(l) && fresh(l.createdAt)).length;

  // Склад по компаниям и что уедет сегодня — по складам.
  const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
  const companies = input.stock.companies.map((c) => {
    const bad = share(c.criticalStems, c.stems);
    const warn = share(c.warningStems, c.stems);
    return { farm: c.farm, label: farmLabel(c.farm), stems: c.stems, okShare: Math.max(0, 100 - bad - warn), warnShare: warn, badShare: bad, criticalShare: bad };
  });
  const todayShip = orders.filter((o) => isReadyToShip(o) && deliveryGroup(o.deliveryDate, today) === "today" && stemsLeft(o) > 0);
  const buckets = new Map<string, { orders: Set<string>; stems: number }>();
  for (const o of todayShip) {
    for (const i of o.items) {
      const left = Math.max(0, i.quantity - i.shippedQuantity);
      if (left <= 0) continue;
      const key = normalizeStore(o.store) === "office" ? "office" : getFarmFor(i.flowerType) || "";
      const b = buckets.get(key) ?? { orders: new Set<string>(), stems: 0 };
      b.orders.add(o.orderId);
      b.stems += left;
      buckets.set(key, b);
    }
  }
  const shipToday = [...FARM_ORDER, "office"]
    .filter((k) => buckets.has(k))
    .map((k) => ({ label: k === "office" ? storeLabel("office") : farmLabel(k), orders: buckets.get(k)!.orders.size, stems: buckets.get(k)!.stems }));

  const overall = input.stock.overall;
  return {
    summary: {
      yesterdayAmount: yesterdayOrders.reduce((s, o) => s + o.totalAmount, 0),
      yesterdayOrders: yesterdayOrders.length,
      yesterdayReceived: payments.filter((p) => p.date === yesterday).reduce((s, p) => s + p.amount, 0),
      attentionCount: input.attention.length,
    },
    sales: {
      amount: input.totals.amountMonth,
      target: input.totals.targetAmount,
      percent,
      pacePercent: input.pacePercent,
      tone: managerTone(percent, input.pacePercent),
    },
    money: { week: weekPayments.reduce((s, p) => s + p.amount, 0), byFarm: moneyByFarm },
    debts: input.debts,
    stock: {
      stems: overall.stems,
      criticalStems: overall.criticalStems,
      criticalShare: share(overall.criticalStems, overall.stems),
      push: input.push.map((p) => p.text).join(" · "),
    },
    attention: input.attention,
    managers,
    ai: {
      broadcastSent: sentRows.length,
      broadcastReplied: repliedPhones.size,
      broadcastOrders: broadcastOrders.length,
      assistantReplies: log.filter((r) => r.kind === "auto" || r.kind === "nudge").length,
      assistantOrders: assistantOrders.length,
      assistantNotes: input.assistantLog.filter((r) => r.kind === "note" && !r.doneAt).length,
      botChats: mainIncoming.size,
      botOrders: botOrders.length,
      adsLeads,
    },
    companies,
    shipToday,
  };
}
