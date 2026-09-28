import { phoneKey } from "./leads";
import type { RecipientView } from "./broadcast";
import type { WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Итог рассылки: что из неё вышло. Владелец: «можно сделать анализ чатов по
// рассылке… и постоянно такую фичу — проводить аналитику».
//
// Две части, и они намеренно разные:
//   1. ЗАЯВКИ после рассылки считает программа — это факт из базы, а не мнение:
//      заявки получателей, оформленные за ORDER_WINDOW_DAYS дней после отправки.
//   2. РАЗБОР ОТВЕТОВ делает ИИ: кто что ответил, кому звонить первым, частые
//      вопросы и возражения, что поправить в тексте. Ответ модели проверяется,
//      как присланное из браузера (`parseBroadcastAnalysis`).
//
// Здесь только чистые функции — их зовут страницы, разбор и проверка
// `scripts/check-broadcasts.ts`. Модуль без googleapis (грабли 1.8).
// ---------------------------------------------------------------------------

/** Сколько дней после отправки заявка получателя засчитывается рассылке. */
export const ORDER_WINDOW_DAYS = 7;
/** Разбор перестаёт делаться сам, когда рассылке больше стольких дней. */
export const AUTO_ANALYSIS_DAYS = 14;

export const REPLY_KINDS = {
  order: "хочет заказать",
  interest: "интересуется",
  question: "задал вопрос",
  later: "не сейчас",
  refuse: "отказ",
  stop: "отписался",
  other: "другое",
} as const;
export type ReplyKind = keyof typeof REPLY_KINDS;
const KIND_KEYS = Object.keys(REPLY_KINDS) as ReplyKind[];

// --- 1. Заявки после рассылки ------------------------------------------------

export interface OrderLite {
  orderId: string;
  clientId: string;
  clientName: string;
  createdAt: string;
  status: string;
  amount: number;
}

export interface BroadcastOrders {
  /** Заявки получателей в окне после отправки, от новых к старым. */
  orders: (OrderLite & { phone: string })[];
  count: number;
  amount: number;
  /** Сколько разных получателей оформили заявку. */
  buyers: number;
  /** Номер получателя → его заявки в окне. */
  byPhone: Map<string, { count: number; amount: number }>;
}

/**
 * Заявки получателей, оформленные в течение `days` дней после ИХ сообщения.
 * Клиент — по карточке (`refId`), лид — по карточке клиента, заведённой из
 * него (`leadClient`). Отменённые не считаются. Это «после», а не «из-за»:
 * постоянный клиент заказал бы и без рассылки — страница об этом говорит.
 */
export function ordersAfterBroadcast(
  views: RecipientView[],
  orders: OrderLite[],
  leadClient: Map<string, string>,
  days = ORDER_WINDOW_DAYS
): BroadcastOrders {
  const windowMs = days * 24 * 3600 * 1000;
  const byClient = new Map<string, OrderLite[]>();
  for (const o of orders) {
    if (!o.clientId || o.status === "cancelled") continue;
    const list = byClient.get(o.clientId) ?? [];
    list.push(o);
    byClient.set(o.clientId, list);
  }
  const out: BroadcastOrders = { orders: [], count: 0, amount: 0, buyers: 0, byPhone: new Map() };
  const seen = new Set<string>();
  for (const v of views) {
    if (!v.sentAt || (v.state !== "sent" && v.state !== "delivered" && v.state !== "read" && v.state !== "replied")) continue;
    const clientId = v.kind === "client" ? v.refId : leadClient.get(v.refId) ?? "";
    if (!clientId) continue;
    const from = Date.parse(v.sentAt);
    if (!Number.isFinite(from)) continue;
    const mine = (byClient.get(clientId) ?? []).filter((o) => {
      const t = Date.parse(o.createdAt);
      return Number.isFinite(t) && t >= from && t <= from + windowMs;
    });
    if (mine.length === 0) continue;
    const key = phoneKey(v.phone);
    const cur = out.byPhone.get(key) ?? { count: 0, amount: 0 };
    let added = 0;
    for (const o of mine) {
      if (seen.has(o.orderId)) continue;
      seen.add(o.orderId);
      added++;
      out.orders.push({ ...o, phone: v.phone });
      cur.count++;
      cur.amount += o.amount;
      out.count++;
      out.amount += o.amount;
    }
    if (added > 0) {
      out.byPhone.set(key, cur);
      out.buyers++;
    }
  }
  out.orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

// --- 2. Разбор ответов (ИИ) ---------------------------------------------------

export interface AnalysisPerson {
  phone: string;
  kind: ReplyKind;
  note: string;
  callFirst: boolean;
}

export interface BroadcastAnalysis {
  summary: string;
  people: AnalysisPerson[];
  questions: string[];
  objections: string[];
  advice: string[];
}

export const BROADCAST_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "people", "questions", "objections", "advice"],
  properties: {
    summary: { type: "string", description: "Итог рассылки в 2–4 предложениях: как откликнулись, что главное." },
    people: {
      type: "array",
      description: "Каждый, кто ответил, — одна запись.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["phone", "kind", "note", "callFirst"],
        properties: {
          phone: { type: "string", description: "Номер точно как в заголовке переписки, только цифры." },
          kind: { type: "string", enum: KIND_KEYS },
          note: { type: "string", description: "Что клиент хочет или ответил — одной короткой фразой." },
          callFirst: { type: "boolean", description: "true — горячий: хочет заказать или готов, звонить сегодня." },
        },
      },
    },
    questions: { type: "array", items: { type: "string" }, description: "Частые вопросы клиентов, до 5." },
    objections: { type: "array", items: { type: "string" }, description: "Возражения и причины отказа, до 5." },
    advice: { type: "array", items: { type: "string" }, description: "Что поправить в тексте или в следующей рассылке, до 4 советов." },
  },
};

function clip(v: unknown, max: number): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function list(v: unknown, max: number, len: number): string[] {
  return (Array.isArray(v) ? v : []).map((x) => clip(x, len)).filter(Boolean).slice(0, max);
}

/**
 * Ответ модели → разбор. Чужие номера (которых нет среди ответивших) и
 * незнакомые виды ответа отбрасываются; тексты обрезаются.
 */
export function parseBroadcastAnalysis(data: unknown, repliedPhones: string[]): BroadcastAnalysis {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const allowed = new Map(repliedPhones.map((p) => [phoneKey(p), p]));
  const people: AnalysisPerson[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(d.people) ? d.people : []) {
    const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const key = phoneKey(String(p.phone || ""));
    const phone = allowed.get(key);
    if (!phone || seen.has(key)) continue;
    seen.add(key);
    const kind = KIND_KEYS.includes(p.kind as ReplyKind) ? (p.kind as ReplyKind) : "other";
    people.push({ phone, kind, note: clip(p.note, 160), callFirst: p.callFirst === true && kind !== "stop" && kind !== "refuse" });
  }
  return {
    summary: clip(d.summary, 700),
    people,
    questions: list(d.questions, 5, 160),
    objections: list(d.objections, 5, 160),
    advice: list(d.advice, 4, 220),
  };
}

/** Счётчики по видам ответа — для плашек. */
export function kindCounts(a: BroadcastAnalysis): { kind: ReplyKind; label: string; count: number }[] {
  return KIND_KEYS.map((k) => ({ kind: k, label: REPLY_KINDS[k], count: a.people.filter((p) => p.kind === k).length })).filter(
    (x) => x.count > 0
  );
}

const MAX_TRANSCRIPT = 24000;

/**
 * Переписка ответивших после рассылки — текстом для модели. На человека — до
 * 12 сообщений после отправки, каждое до 300 знаков; всего до 24 000 знаков.
 */
export function broadcastTranscript(
  broadcastText: string,
  replied: RecipientView[],
  messages: WaMessage[]
): { text: string; phones: string[] } {
  const byKey = new Map<string, WaMessage[]>();
  for (const m of messages) {
    const key = phoneKey(m.phone);
    if (!key) continue;
    const l = byKey.get(key) ?? [];
    l.push(m);
    byKey.set(key, l);
  }
  const parts: string[] = [];
  const phones: string[] = [];
  let used = 0;
  for (const v of replied) {
    const msgs = (byKey.get(phoneKey(v.phone)) ?? [])
      .filter((m) => m.at > v.sentAt)
      .sort((a, b) => (a.at < b.at ? -1 : 1))
      .slice(0, 12);
    if (msgs.length === 0) continue;
    const lines = msgs.map((m) => `${m.direction === "in" ? "Клиент" : "Мы"}: ${clip(m.text || `[${m.type}]`, 300)}`);
    const block = `### ${v.phone} · ${v.name || "без имени"} (${v.kind === "lead" ? "лид" : "клиент"})\n${lines.join("\n")}`;
    if (used + block.length > MAX_TRANSCRIPT) break;
    parts.push(block);
    phones.push(v.phone);
    used += block.length;
  }
  return {
    text: `Текст рассылки:\n${clip(broadcastText, 1500)}\n\nОтветы клиентов после рассылки:\n\n${parts.join("\n\n")}`,
    phones,
  };
}

export const BROADCAST_ANALYSIS_SYSTEM = [
  "Ты — аналитик отдела продаж оптовой цветочной компании Ecoculture (Казахстан: розы, хризантемы, эустома).",
  "Компания разослала клиентам сообщение в WhatsApp. Ниже — текст рассылки и ответы клиентов.",
  "Разбери ответы для руководителя: кто что ответил, кто горячий (хочет заказать — звонить сегодня),",
  "какие вопросы и возражения повторяются, что поправить в тексте следующей рассылки.",
  "Пиши по-русски, коротко и конкретно, без воды. Номера бери точно из заголовков «### номер».",
  "Не выдумывай: если ответов мало, так и скажи.",
].join("\n");

/** Разбор устарел: после него пришли новые ответы. */
export function analysisIsStale(repliedNow: number, repliedAtAnalysis: number | null): boolean {
  if (repliedNow === 0) return false;
  return repliedAtAnalysis === null || repliedNow > repliedAtAnalysis;
}
