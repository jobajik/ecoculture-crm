import { isAckOnly } from "./broadcast";
import { looksLikeAutoreply } from "./botTurn";
import { phoneKey } from "./leads";
import { mergeMessages, messageText } from "./whatsapp";
import type { WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Номера WhatsApp менеджеров (16.10.2026, владелец: «добавить Ильяса, Эмиля и
// Ильгара к системе лидов так же, как у Земфиры; ИИ-помощник при необходимости
// делает работу по продаже, рассылке и прочему; я хочу видеть их переписки,
// разборы и разговоры»). Решения владельца: на каждого — свой инстанс Green API;
// ключи вписывает сам в «Настройках»; помощник подсказывает, а отвечает сам,
// только когда клиент ждёт ответа дольше 20 минут или вечером и в выходные.
//
// Линия сообщения (`WaMessage.line`): "" — основной номер (бот, рассылки),
// "leads" — Земфира, "m-…" — номер менеджера. Чистые правила; запись — repo/waLines.ts.
// ---------------------------------------------------------------------------

export const MANAGER_LINE_PREFIX = "m-";
export const isManagerLine = (line: string | null | undefined) => (line || "").startsWith(MANAGER_LINE_PREFIX);

/**
 * on — подсказывает и отвечает, когда менеджер молчит 20 минут (заказ оформляет менеджер);
 * sell — продаёт сам (19.10.2026, владелец про Ильяса: «мощный помощник, который бы смог продавать»):
 * отвечает, когда менеджер молчит 5 минут, оформляет заказ на менеджера и выставляет счёт Kaspi,
 * шлёт фото и каталог, дожимает молчащих (`lineSeller.ts`); off — только подсказывает.
 */
export type AssistantMode = "on" | "off" | "sell";
export const ASSISTANT_MODE_LABELS: Record<AssistantMode, string> = {
  sell: "Продаёт сам: отвечает через 5 минут молчания, оформляет заказ и счёт",
  on: "Подсказывает и отвечает, когда менеджер молчит",
  off: "Только подсказывает",
};

export function parseAssistantMode(raw: string | null | undefined): AssistantMode {
  const v = (raw || "").trim();
  return v === "off" ? "off" : v === "sell" ? "sell" : "on";
}

export interface WaLine {
  code: string;
  managerEmail: string;
  label: string;
  url: string;
  instance: string;
  /** Токен в зашифрованном виде (`secretBox.ts`); расшифровывается только на сервере. */
  tokenEnc: string;
  active: boolean;
  assistant: AssistantMode;
  createdAt: string;
  updatedAt: string;
  /** Номер телефона линии (цифры), как его назвал Green API. */
  phone: string;
  /** Последнее известное состояние Green API: authorized, notAuthorized… */
  state: string;
  stateAt: string;
}

/** «Ильяс» → «Ильяса», «Эмиль» → «Эмиля», «Земфира» → «Земфиры» — для «написал в WhatsApp Ильяса». */
export function genitiveName(name: string): string {
  const n = (name || "").trim().split(/\s+/)[0] || "";
  if (!n) return "менеджера";
  if (/[ьй]$/i.test(n)) return `${n.slice(0, -1)}я`;
  if (/[кгхжчшщ]а$/i.test(n)) return `${n.slice(0, -1)}и`;
  if (/а$/i.test(n)) return `${n.slice(0, -1)}ы`;
  if (/я$/i.test(n)) return `${n.slice(0, -1)}и`;
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(n)) return `${n}а`;
  return n;
}

/** Код линии из почты менеджера: «ilyas@…» → «m-ilyas»; занятый — с цифрой. */
export function lineCodeFor(email: string, taken: string[]): string {
  const base =
    MANAGER_LINE_PREFIX +
    ((email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "manager");
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
  return `${base}${Date.now()}`;
}

/** Что можно вписать в форму подключения. Пусто — можно. */
export function lineInputRefusal(input: { managerEmail: string; instance: string; token: string; url: string }, editing: boolean): string {
  if (!input.managerEmail) return "Выберите менеджера";
  if (!/^\d{6,15}$/.test(input.instance.trim())) return "idInstance — это цифры из карточки инстанса в Green API";
  if (!editing && input.token.trim().length < 20) return "Вставьте apiTokenInstance целиком — он длинный";
  if (input.token && /\s/.test(input.token.trim())) return "В токене не должно быть пробелов";
  if (input.url && !/^https:\/\/[a-z0-9.-]+$/i.test(input.url.trim().replace(/\/+$/, ""))) return "apiUrl — адрес вида https://1103.api.green-api.com";
  return "";
}

// --- ИИ-помощник: когда он отвечает сам -------------------------------------------

/** Клиент ждёт ответа дольше стольких минут в рабочее время — отвечает помощник. */
export const ASSISTANT_WAIT_MINUTES = 20;
/** Вне рабочего времени — почти сразу: после стольких минут тишины (клиент дописывает серию). */
export const ASSISTANT_AFTER_HOURS_MINUTES = 2;
/** Режим «продаёт сам»: менеджер молчит столько минут в рабочее время — отвечает помощник. */
export const ASSISTANT_SELL_WAIT_MINUTES = 5;
/**
 * Режим «продаёт сам»: помощник уже ведёт разговор (наше последнее сообщение — его, не старше этого) —
 * следующий ответ после конца серии, без новых 5 минут: продажа идёт 5–8 ходов, и пауза на каждом
 * выглядела бы для клиента как брошенный разговор. Менеджер вмешался — снова ждём его 5 минут.
 */
export const ASSISTANT_SELL_LEAD_HOURS = 2;
/** Больше стольких ответов помощника подряд без менеджера — молчит и ждёт человека. */
export const ASSISTANT_MAX_IN_ROW = 3;
/** То же в режиме «продаёт сам»: разговор до заказа длиннее. */
export const ASSISTANT_SELL_MAX_IN_ROW = 12;
/** Сообщение клиента старше этого — отвечать поздно, это дело менеджера. */
export const ASSISTANT_STALE_HOURS = 12;
/** Рабочее время менеджеров: пн–сб 9:00–19:00 по Алматы. Писать сам помощник может 8:00–23:00. */
export const WORK_FROM = 9;
export const WORK_TO = 19;
export const SEND_FROM = 8;
export const SEND_TO = 23;

function almatyParts(d: Date): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", minute: "numeric", weekday: "short", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: days.indexOf(get("weekday")) };
}

/** Рабочее ли сейчас время менеджеров (пн–сб 9–19 по Алматы). */
export function isWorkTime(d: Date): boolean {
  const { hour, weekday } = almatyParts(d);
  return weekday >= 1 && weekday <= 6 && hour >= WORK_FROM && hour < WORK_TO;
}

export interface AssistantVerdict {
  due: boolean;
  /** Почему нет — словами, для страницы и диагностики. */
  reason: string;
  /** С какого момента клиент ждёт ответа (первое его сообщение после нашего). */
  waitingSince: string | null;
  /** Последнее сообщение клиента — на него и отвечать. */
  lastIn: WaMessage | null;
  /** Ждать осталось только время (клиент ждёт, менеджер ещё может ответить): через сколько мс проверить снова. */
  retryInMs?: number;
}

/**
 * Пора ли помощнику ответить в этом чате самому. `chat` — сообщения ОДНОЙ линии с ОДНИМ номером;
 * `autoIds` — номера сообщений, которые отправил сам помощник (`AssistantLog`): они не считаются
 * ответом менеджера. `staff` — номер сотрудника или наш: таким не отвечаем никогда.
 */
export function assistantVerdict(input: {
  chat: WaMessage[];
  autoIds: Set<string>;
  now: Date;
  staff?: boolean;
  mode: AssistantMode;
  /** Вебхук после сообщения вне рабочего времени: ждать не 2 минуты, а только конец серии (~20 с). */
  quick?: boolean;
}): AssistantVerdict {
  const no = (reason: string, waitingSince: string | null = null, lastIn: WaMessage | null = null): AssistantVerdict => ({
    due: false,
    reason,
    waitingSince,
    lastIn,
  });
  if (input.mode === "off") return no("помощник только подсказывает");
  const sell = input.mode === "sell";
  if (input.staff) return no("номер сотрудника");
  const chat = mergeMessages(input.chat);
  const last = chat[chat.length - 1];
  if (!last) return no("переписки нет");
  if (last.direction !== "in") return no("последним писали мы");
  let i = chat.length - 1;
  while (i > 0 && chat[i - 1].direction === "in") i--;
  const waitingSince = chat[i].at;
  const series = chat.slice(i);
  const text = series.map((m) => messageText(m)).join(" ").trim();
  if (series.every((m) => isAckOnly(messageText(m)))) return no("клиент просто кивнул", waitingSince, last);
  const context = chat.slice(Math.max(0, i - 6)).map((m) => ({ role: m.direction === "in" ? ("client" as const) : ("us" as const), text: messageText(m), at: m.at }));
  if (looksLikeAutoreply(text, context, waitingSince)) return no("похоже на автоответ", waitingSince, last);
  const nowMs = input.now.getTime();
  const lastMs = Date.parse(last.at);
  if (!Number.isFinite(lastMs) || nowMs - lastMs > ASSISTANT_STALE_HOURS * 3600000) return no("сообщение давнее — ответит менеджер", waitingSince, last);
  // Ответы помощника подряд, пока менеджер не писал сам.
  let inRow = 0;
  for (let k = chat.length - 1; k >= 0; k--) {
    const m = chat[k];
    if (m.direction !== "out") continue;
    if (!input.autoIds.has(m.messageId)) break;
    inRow++;
  }
  const maxInRow = sell ? ASSISTANT_SELL_MAX_IN_ROW : ASSISTANT_MAX_IN_ROW;
  if (inRow >= maxInRow) return no(`ИИ ответил ${inRow} раз подряд — ждёт менеджера`, waitingSince, last);
  const { hour } = almatyParts(input.now);
  if (hour < SEND_FROM || hour >= SEND_TO) return no("ночь — ответит утром", waitingSince, last);
  const work = isWorkTime(input.now);
  const waitMin = (nowMs - Date.parse(waitingSince)) / 60000;
  const quietMin = (nowMs - lastMs) / 60000;
  // Помощник уже ведёт этот разговор: наше последнее сообщение — его и свежее.
  const lastOut = [...chat].reverse().find((m) => m.direction === "out");
  const aiLeads = sell && !!lastOut && input.autoIds.has(lastOut.messageId) && nowMs - Date.parse(lastOut.at) < ASSISTANT_SELL_LEAD_HOURS * 3600000;
  const quick = input.quick || aiLeads;
  const need = work && !aiLeads ? (sell ? ASSISTANT_SELL_WAIT_MINUTES : ASSISTANT_WAIT_MINUTES) : quick ? 0.3 : ASSISTANT_AFTER_HOURS_MINUTES;
  const quietNeed = quick ? 0.3 : 1;
  const retryInMs = Math.max((need - waitMin) * 60000, (quietNeed - quietMin) * 60000, 0) + 2000;
  if (waitMin < need) {
    return { ...no(work && !aiLeads ? `ждёт ${Math.floor(waitMin)} мин — менеджер ещё может ответить` : "клиент только что написал", waitingSince, last), retryInMs };
  }
  if (quietMin < quietNeed) return { ...no("клиент ещё пишет", waitingSince, last), retryInMs };
  const reason = aiLeads
    ? "ИИ ведёт разговор"
    : work
      ? `клиент ждёт ответа дольше ${sell ? ASSISTANT_SELL_WAIT_MINUTES : ASSISTANT_WAIT_MINUTES} минут`
      : "нерабочее время";
  return { due: true, reason, waitingSince, lastIn: last };
}

// --- Список переписок ----------------------------------------------------------------

export interface ChatPartyInfo {
  kind: "client" | "lead";
  id: string;
  name: string;
  managerEmail: string;
}

export interface ChatSummary {
  line: string;
  phone: string;
  key: string;
  name: string;
  party: ChatPartyInfo | null;
  lastAt: string;
  lastText: string;
  lastDirection: "in" | "out";
  /** Последнее наше сообщение отправил ИИ-помощник. */
  lastByAssistant: boolean;
  waitingSince: string | null;
  count: number;
}

/** Переписки линии: строка на номер, свежие сверху. */
export function buildChatList(input: {
  messages: WaMessage[];
  line: string;
  parties: Map<string, ChatPartyInfo>;
  autoIds: Set<string>;
  sinceIso?: string;
}): ChatSummary[] {
  const byKey = new Map<string, WaMessage[]>();
  for (const m of input.messages) {
    if ((m.line || "") !== input.line) continue;
    const key = phoneKey(m.phone);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(m);
    byKey.set(key, list);
  }
  const out: ChatSummary[] = [];
  for (const [key, list] of Array.from(byKey.entries())) {
    const chat = mergeMessages(list);
    const last = chat[chat.length - 1];
    if (!last || (input.sinceIso && last.at < input.sinceIso)) continue;
    let i = chat.length - 1;
    while (i > 0 && chat[i - 1].direction === "in") i--;
    const lastOut = [...chat].reverse().find((m) => m.direction === "out");
    const sender = [...chat].reverse().find((m) => m.direction === "in" && m.senderName)?.senderName ?? "";
    const party = input.parties.get(key) ?? null;
    out.push({
      line: input.line,
      phone: last.phone,
      key,
      name: party?.name || sender || `+${last.phone}`,
      party,
      lastAt: last.at,
      lastText: messageText(last).replace(/\s+/g, " ").slice(0, 140),
      lastDirection: last.direction,
      lastByAssistant: !!lastOut && input.autoIds.has(lastOut.messageId),
      waitingSince: last.direction === "in" ? chat[i].at : null,
      count: chat.length,
    });
  }
  return out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}
