import { phoneKey } from "./leads";
import type { WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Переписка рабочего WhatsApp: разбор уведомлений Green API и расчёты по чату.
//
// Владелец: «анализ общения с клиентами» — выбрал подключить рабочий номер
// WhatsApp напрямую. Сообщения приходят вебхуком (`/api/whatsapp/webhook`) и
// ложатся во вкладку WaMessages; к лиду привязываются при чтении по телефону.
//
// Здесь только чистые функции — их зовут вебхук, страницы и проверка
// `scripts/check-talks.ts`. Модуль без googleapis (грабли 1.8).
// ---------------------------------------------------------------------------

/** Длиннее в ячейку не пишем: у Google предел 50 000 знаков, а разбору хватит. */
export const MAX_MESSAGE_TEXT = 4000;

/** Номер собеседника из chatId: «77015552030@c.us» → «77015552030». Группы — нет. */
export function chatPhone(chatId: string | null | undefined): string {
  const id = String(chatId || "").trim();
  if (!id.endsWith("@c.us")) return "";
  const digits = id.slice(0, -5).replace(/\D/g, "");
  return digits.length >= 10 ? digits : "";
}

const FILE_TYPES: Record<string, string> = {
  imageMessage: "image",
  videoMessage: "video",
  documentMessage: "document",
  audioMessage: "voice",
};

/** Подпись к сообщению без текста — чтобы в переписке было видно, что там было. */
export const TYPE_LABELS: Record<string, string> = {
  voice: "Голосовое",
  image: "Фото",
  video: "Видео",
  document: "Файл",
  sticker: "Стикер",
  location: "Место на карте",
  contact: "Контакт",
  poll: "Опрос",
  other: "Сообщение",
};

function clip(text: unknown): string {
  const t = String(text ?? "").replace(/\r/g, "").trim();
  return t.length > MAX_MESSAGE_TEXT ? `${t.slice(0, MAX_MESSAGE_TEXT)}…` : t;
}

function isoFromSeconds(ts: unknown): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(n * 1000).toISOString();
}

/**
 * Содержимое сообщения по `typeMessage` Green API. `null` — такое не храним:
 * реакции, правки, удаления и служебные — это шум, а не разговор.
 */
function contentOf(
  typeMessage: string,
  data: Record<string, unknown>
): { type: string; text: string; mediaUrl: string } | null {
  const obj = (k: string) => (data[k] && typeof data[k] === "object" ? (data[k] as Record<string, unknown>) : {});
  switch (typeMessage) {
    case "textMessage":
      return { type: "text", text: clip(obj("textMessageData").textMessage ?? data.textMessage), mediaUrl: "" };
    case "extendedTextMessage":
    case "quotedMessage":
      return {
        type: "text",
        text: clip(obj("extendedTextMessageData").text ?? obj("extendedTextMessage").text ?? data.textMessage),
        mediaUrl: "",
      };
    case "imageMessage":
    case "videoMessage":
    case "documentMessage":
    case "audioMessage": {
      const f = obj("fileMessageData");
      const caption = f.caption ?? data.caption ?? "";
      const name = typeMessage === "documentMessage" ? f.fileName ?? data.fileName ?? "" : "";
      return {
        type: FILE_TYPES[typeMessage],
        text: clip([caption, name].filter(Boolean).join(" · ")),
        mediaUrl: String(f.downloadUrl ?? data.downloadUrl ?? ""),
      };
    }
    case "stickerMessage":
      return { type: "sticker", text: "", mediaUrl: "" };
    case "locationMessage":
      return { type: "location", text: clip(obj("locationMessageData").address ?? ""), mediaUrl: "" };
    case "contactMessage":
    case "contactsArrayMessage":
      return { type: "contact", text: clip(obj("contactMessageData").displayName ?? ""), mediaUrl: "" };
    case "pollMessage":
      return { type: "poll", text: clip(obj("pollMessageData").name ?? ""), mediaUrl: "" };
    default:
      return null;
  }
}

const WEBHOOK_DIRECTION: Record<string, "in" | "out"> = {
  incomingMessageReceived: "in",
  outgoingMessageReceived: "out",
  outgoingAPIMessageReceived: "out",
};

/**
 * Уведомление Green API → сообщение. `null` — не наше дело: статусы доставки,
 * группы, реакции, служебные. Вебхук на `null` отвечает 200 и ничего не пишет.
 */
export function parseGreenWebhook(body: unknown): WaMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const direction = WEBHOOK_DIRECTION[String(b.typeWebhook || "")];
  if (!direction) return null;
  const sender = (b.senderData && typeof b.senderData === "object" ? b.senderData : {}) as Record<string, unknown>;
  const phone = chatPhone(String(sender.chatId || ""));
  if (!phone) return null;
  const md = (b.messageData && typeof b.messageData === "object" ? b.messageData : {}) as Record<string, unknown>;
  const content = contentOf(String(md.typeMessage || ""), md);
  if (!content) return null;
  const messageId = String(b.idMessage || "").trim();
  if (!messageId) return null;
  return {
    messageId,
    at: isoFromSeconds(b.timestamp),
    chatId: String(sender.chatId),
    phone,
    direction,
    type: content.type,
    text: content.text,
    mediaUrl: content.mediaUrl,
    // Имя пишем только у входящих: у исходящих это наш собственный номер.
    senderName: direction === "in" ? clip(sender.senderContactName || sender.senderName || sender.chatName || "") : "",
    source: "webhook",
  };
}

/** Элемент ответа `getChatHistory` → сообщение (тот же вид, что из вебхука). */
export function parseHistoryItem(item: unknown): WaMessage | null {
  if (!item || typeof item !== "object") return null;
  const it = item as Record<string, unknown>;
  const direction = it.type === "incoming" ? "in" : it.type === "outgoing" ? "out" : null;
  if (!direction) return null;
  const phone = chatPhone(String(it.chatId || ""));
  if (!phone) return null;
  const content = contentOf(String(it.typeMessage || ""), it);
  if (!content) return null;
  const messageId = String(it.idMessage || "").trim();
  if (!messageId) return null;
  return {
    messageId,
    at: isoFromSeconds(it.timestamp),
    chatId: String(it.chatId),
    phone,
    direction,
    type: content.type,
    text: content.text,
    mediaUrl: content.mediaUrl,
    senderName: direction === "in" ? clip(it.senderContactName || it.senderName || "") : "",
    source: "history",
  };
}

/**
 * Склейка повторов по номеру сообщения: вебхук Green API повторяется при сбое,
 * история подтягивается поверх уже пришедшего. Из двух копий остаётся та, где
 * текст длиннее, — у голосового это расшифровка. По времени — от старых к новым.
 */
export function mergeMessages(list: WaMessage[]): WaMessage[] {
  const byId = new Map<string, WaMessage>();
  for (const m of list) {
    const prev = byId.get(m.messageId);
    if (!prev || m.text.length > prev.text.length) byId.set(m.messageId, m);
  }
  return Array.from(byId.values()).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Переписка с номером (сравнение по последним 10 цифрам, как у лидов). */
export function messagesForPhone(all: WaMessage[], phone: string): WaMessage[] {
  const key = phoneKey(phone);
  if (!key) return [];
  return mergeMessages(all.filter((m) => phoneKey(m.phone) === key));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export interface ReplyStats {
  /** Медиана минут от сообщения клиента до нашего ответа; null — не на что было отвечать. */
  replyMinutes: number | null;
  /** С какого момента клиент ждёт ответа (последним писал он); null — не ждёт. */
  waitingSince: string | null;
  lastAt: string | null;
  inCount: number;
  outCount: number;
}

/**
 * Скорость ответа считается программой, а не ИИ: это факт из времени
 * сообщений, и спорить с ним не о чем. Считается от ПЕРВОГО сообщения клиента в
 * серии (клиент написал три раза подряд — ждал он с первого) до нашего ответа.
 */
export function replyStats(messages: WaMessage[]): ReplyStats {
  const gaps: number[] = [];
  let pendingSince: string | null = null;
  let inCount = 0;
  let outCount = 0;
  for (const m of messages) {
    if (m.direction === "in") {
      inCount++;
      if (!pendingSince) pendingSince = m.at;
    } else {
      outCount++;
      if (pendingSince) {
        const minutes = (new Date(m.at).getTime() - new Date(pendingSince).getTime()) / 60000;
        if (minutes >= 0) gaps.push(Math.round(minutes));
        pendingSince = null;
      }
    }
  }
  return {
    replyMinutes: median(gaps),
    waitingSince: pendingSince,
    lastAt: messages.length ? messages[messages.length - 1].at : null,
    inCount,
    outCount,
  };
}

/** «12 мин», «3 ч», «2 дн.» — сколько времени прошло / занял ответ. */
export function minutesWords(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} мин`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ч`;
  return `${Math.round(h / 24)} дн.`;
}

export function minutesSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now.getTime() - t) / 60000);
}

function shortMoment(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Текст сообщения для человека и для ИИ: пустое голосовое/фото — подписью. */
export function messageText(m: Pick<WaMessage, "type" | "text">): string {
  if (m.type === "text") return m.text;
  const label = TYPE_LABELS[m.type] ?? TYPE_LABELS.other;
  if (m.type === "voice") return m.text ? `[голосовое] ${m.text}` : "[голосовое, не расшифровано]";
  return m.text ? `[${label.toLowerCase()}] ${m.text}` : `[${label.toLowerCase()}]`;
}

/**
 * Переписка текстом для ИИ. Если она длиннее предела — остаются ПОСЛЕДНИЕ
 * сообщения: разбор нужен о том, где разговор сейчас, а не как он начинался.
 */
export function transcriptForAi(messages: WaMessage[], maxChars = 24000): { text: string; used: WaMessage[] } {
  const lines: string[] = [];
  const used: WaMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const line = `[${shortMoment(m.at)}] ${m.direction === "in" ? "Клиент" : "Менеджер"}: ${messageText(m)}`;
    if (total + line.length + 1 > maxChars && lines.length > 0) break;
    lines.push(line);
    used.push(m);
    total += line.length + 1;
  }
  return { text: lines.reverse().join("\n"), used: used.reverse() };
}

export interface InboxRow {
  phone: string;
  name: string;
  lastAt: string;
  lastText: string;
  count: number;
  /** Последним писал клиент — ему никто не ответил. */
  waiting: boolean;
}

/**
 * «Новые обращения»: чаты с номерами, которых нет ни у лида, ни у клиента.
 * Это люди, написавшие на рабочий номер сами, — будущие лиды. Берём только
 * тех, кто писал САМ (есть входящие) за последние `days` дней.
 */
export function buildInbox(all: WaMessage[], knownKeys: Set<string>, now: Date, days = 30): InboxRow[] {
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const byKey = new Map<string, WaMessage[]>();
  for (const m of all) {
    const key = phoneKey(m.phone);
    if (!key || knownKeys.has(key)) continue;
    const list = byKey.get(key) ?? [];
    list.push(m);
    byKey.set(key, list);
  }
  const rows: InboxRow[] = [];
  for (const list of Array.from(byKey.values())) {
    const msgs = mergeMessages(list);
    const incoming = msgs.filter((m) => m.direction === "in");
    if (incoming.length === 0) continue;
    const last = msgs[msgs.length - 1];
    if (last.at < since) continue;
    rows.push({
      phone: last.phone,
      name: [...incoming].reverse().find((m) => m.senderName)?.senderName ?? "",
      lastAt: last.at,
      lastText: messageText(last),
      count: msgs.length,
      waiting: last.direction === "in",
    });
  }
  return rows.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

/** Номер для формы лида: «77015552030» → «+7 701 555 20 30». */
export function prettyWaPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 11) return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
  return d ? `+${d}` : "";
}
