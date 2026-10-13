import { CLIENT_STAGES, ADS_FIRST_TOUCH_DAYS, ADS_MAX_TOUCHES, ADS_MIN_TOUCHES, adsManagerTouches, cleanStage, isAdsLead, isClosedStage, stageShort, type LeadStage } from "./leads";
import { ORDER_STATUSES } from "./constants";
import { isNotASale } from "./orderKind";
import type { Lead, LeadTouch } from "./types";

// ---------------------------------------------------------------------------
// «С рекламы»: лиды Земфиры и что с ними сделали менеджеры (13.10.2026, владелец:
// «клиенты от Земфиры для нас отдельные — новые после рекламы, а мы их дальше
// отрабатываем сами на 2–5 касаний»). Чистые функции — страница `/clients/leads/ads`
// и проверка `check-leads`. Модуль без googleapis (грабли 1.8).
// ---------------------------------------------------------------------------

export type AdsFlag = "" | "no_touch" | "few" | "many";

export const ADS_FLAG_TEXT: Record<Exclude<AdsFlag, "">, string> = {
  no_touch: "менеджер ещё не связался",
  few: `меньше ${ADS_MIN_TOUCHES} касаний`,
  many: `${ADS_MAX_TOUCHES}+ касаний без заказа — решить: отказ или дальше`,
};

export interface AdsLeadRow {
  leadId: string;
  name: string;
  city: string;
  source: string;
  createdAt: string;
  createdByEmail: string;
  handedOverAt: string;
  managerEmail: string;
  stage: LeadStage;
  stageLabel: string;
  lostReason: string;
  /** Касаний менеджера после передачи. */
  touches: number;
  lastTouchAt: string;
  /** Заявки клиента после передачи (без отменённых и не-продаж): сколько и на сколько. */
  orders: number;
  orderSum: number;
  won: boolean;
  flag: AdsFlag;
}

export interface AdsManagerRow {
  email: string;
  handed: number;
  /** Среднее касаний на переданного. */
  avgTouches: number;
  won: number;
  lost: number;
  orderSum: number;
  noTouch: number;
  few: number;
  many: number;
}

export interface AdsReport {
  created: number;
  handed: number;
  /** Ещё у Земфиры (не передан и не закрыт). */
  inWork: number;
  won: number;
  lost: number;
  orderSum: number;
  rows: AdsLeadRow[];
  byManager: AdsManagerRow[];
  bySource: { source: string; created: number; won: number }[];
}

const daysBetween = (fromIso: string, toDay: string) =>
  Math.max(0, Math.round((Date.parse(`${toDay}T00:00:00`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00`)) / 86_400_000));

interface OrderLite {
  clientId: string;
  createdAt: string;
  status: string;
  totalAmount: number;
  direction?: string;
  retail?: string;
  kind?: string;
  clientName?: string;
}

/**
 * Отчёт по лидам с рекламы, заведённым в период [from, to] (ГГГГ-ММ-ДД; пусто — всё время).
 * Заказы — заявки карточки клиента, заведённой из лида, оформленные после передачи.
 */
export function buildAdsReport(input: {
  leads: Lead[];
  touches: LeadTouch[];
  orders: OrderLite[];
  today: string;
  from?: string;
  to?: string;
}): AdsReport {
  const { today } = input;
  const inPeriod = (iso: string) => {
    const d = iso.slice(0, 10);
    return (!input.from || d >= input.from) && (!input.to || d <= input.to);
  };
  const ads = input.leads.filter((l) => isAdsLead(l) && inPeriod(l.createdAt));
  const ordersByClient = new Map<string, OrderLite[]>();
  for (const o of input.orders) {
    if (!o.clientId || o.status === ORDER_STATUSES.CANCELLED || isNotASale(o)) continue;
    const list = ordersByClient.get(o.clientId) ?? [];
    list.push(o);
    ordersByClient.set(o.clientId, list);
  }

  const rows: AdsLeadRow[] = ads.map((l) => {
    const stage = cleanStage(l.stage);
    const mine = adsManagerTouches(l, input.touches).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const since = l.handedOverAt || l.createdAt;
    const orders = (ordersByClient.get(l.clientId) ?? []).filter((o) => o.createdAt >= since);
    const orderSum = orders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
    const won = orders.length > 0 || CLIENT_STAGES.includes(stage);
    const open = !isClosedStage(stage);
    let flag: AdsFlag = "";
    if (l.handedOverAt && open && !won) {
      if (mine.length === 0 && daysBetween(l.handedOverAt, today) >= ADS_FIRST_TOUCH_DAYS) flag = "no_touch";
      else if (mine.length >= ADS_MAX_TOUCHES) flag = "many";
      else if (mine.length > 0 && mine.length < ADS_MIN_TOUCHES && daysBetween(mine[0].createdAt, today) > 7) flag = "few";
    }
    return {
      leadId: l.leadId,
      name: l.name,
      city: l.city,
      source: l.source,
      createdAt: l.createdAt,
      createdByEmail: l.createdByEmail,
      handedOverAt: l.handedOverAt,
      managerEmail: l.handedOverAt ? l.managerEmail : "",
      stage,
      stageLabel: stageShort(stage),
      lostReason: stage === "lost" ? l.lostReason : "",
      touches: mine.length,
      lastTouchAt: mine[0]?.createdAt ?? "",
      orders: orders.length,
      orderSum,
      won,
      flag,
    };
  });

  const managers = new Map<string, AdsManagerRow & { touchSum: number }>();
  for (const r of rows) {
    if (!r.handedOverAt || !r.managerEmail) continue;
    const m =
      managers.get(r.managerEmail) ??
      { email: r.managerEmail, handed: 0, avgTouches: 0, won: 0, lost: 0, orderSum: 0, noTouch: 0, few: 0, many: 0, touchSum: 0 };
    m.handed += 1;
    m.touchSum += r.touches;
    if (r.won) m.won += 1;
    if (r.stage === "lost") m.lost += 1;
    m.orderSum += r.orderSum;
    if (r.flag === "no_touch") m.noTouch += 1;
    if (r.flag === "few") m.few += 1;
    if (r.flag === "many") m.many += 1;
    managers.set(r.managerEmail, m);
  }
  const byManager = [...managers.values()]
    .map(({ touchSum, ...m }) => ({ ...m, avgTouches: m.handed ? Math.round((touchSum / m.handed) * 10) / 10 : 0 }))
    .sort((a, b) => b.handed - a.handed || a.email.localeCompare(b.email));

  const sources = new Map<string, { source: string; created: number; won: number }>();
  for (const r of rows) {
    const key = r.source || "не указан";
    const s = sources.get(key) ?? { source: key, created: 0, won: 0 };
    s.created += 1;
    if (r.won) s.won += 1;
    sources.set(key, s);
  }

  // Сверху то, что требует действия: флажки, потом свежие.
  const rank = (r: AdsLeadRow) => (r.flag === "no_touch" ? 0 : r.flag === "many" ? 1 : r.flag === "few" ? 2 : 3);
  rows.sort((a, b) => rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : -1));

  return {
    created: rows.length,
    handed: rows.filter((r) => r.handedOverAt).length,
    inWork: rows.filter((r) => !r.handedOverAt && !isClosedStage(r.stage)).length,
    won: rows.filter((r) => r.won).length,
    lost: rows.filter((r) => r.stage === "lost").length,
    orderSum: rows.reduce((s, r) => s + r.orderSum, 0),
    rows,
    byManager,
    bySource: [...sources.values()].sort((a, b) => b.created - a.created),
  };
}
