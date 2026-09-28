import type { WaMessage } from "./types";
import type { WaStatusRow } from "./broadcast";

// ---------------------------------------------------------------------------
// Wazzup (wazzup24.com) — разбор уведомлений. Чистые функции: их зовут вебхук
// и проверка `scripts/check-broadcasts.ts`. Сам обмен с Wazzup — `wazzupApi.ts`.
//
// Формат — по документации Wazzup API v3 (раздел Webhooks):
//   { messages: [{ messageId, dateTime, channelId, chatType, chatId, type,
//                  isEcho, status, text, contentUri, authorName, sentFromApp,
//                  contact: { name, phone } }] }
//   { statuses: [{ messageId, timestamp, status, error: { error, description } }] }
//   { channelsUpdates: [{ channelId, state, … }] }   { test: true }
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, string> = {
  text: "text",
  image: "image",
  audio: "voice",
  video: "video",
  document: "document",
  vcard: "contact",
  geo: "location",
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function isoOf(v: unknown): string {
  const raw = str(v);
  if (!raw) return new Date().toISOString();
  const n = Number(raw);
  const t = Number.isFinite(n) && /^\d+$/.test(raw) ? (raw.length > 11 ? n : n * 1000) : Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

export interface WazzupIncoming extends WaMessage {
  channelId: string;
  /** Отправлено из приложения Wazzup (человеком), а не через API и не с телефона. */
  sentFromApp: boolean;
  isEcho: boolean;
}

/** Сообщения из уведомления. Только личные чаты WhatsApp; служебное — мимо. */
export function parseWazzupMessages(body: unknown): WazzupIncoming[] {
  const list = obj(body).messages;
  if (!Array.isArray(list)) return [];
  const out: WazzupIncoming[] = [];
  for (const item of list) {
    const m = obj(item);
    if (str(m.chatType) !== "whatsapp") continue;
    const messageId = str(m.messageId);
    const phone = str(m.chatId).replace(/\D/g, "");
    if (!messageId || phone.length < 10) continue;
    const type = TYPE_MAP[str(m.type)] ?? (str(m.type) === "missing_call" ? "" : "other");
    if (!type) continue;
    const isEcho = m.isEcho === true;
    const contact = obj(m.contact);
    const text = str(m.text).slice(0, 4000);
    out.push({
      messageId: `wz-${messageId}`,
      at: isoOf(m.dateTime),
      chatId: `${phone}@c.us`,
      phone,
      direction: isEcho ? "out" : "in",
      type,
      text,
      mediaUrl: str(m.contentUri),
      senderName: isEcho ? str(m.authorName) : str(contact.name),
      source: "wazzup",
      channelId: str(m.channelId),
      sentFromApp: m.sentFromApp === true,
      isEcho,
    });
  }
  return out;
}

/** Номер сообщения Wazzup, как он лежит у нас (с приставкой, чтобы не спутать с Green API). */
export function wazzupMessageKey(messageId: string): string {
  const id = String(messageId || "").trim();
  return id.startsWith("wz-") ? id : `wz-${id}`;
}

/** Статусы доставки из уведомления. */
export function parseWazzupStatuses(body: unknown): WaStatusRow[] {
  const list = obj(body).statuses;
  if (!Array.isArray(list)) return [];
  const out: WaStatusRow[] = [];
  for (const item of list) {
    const s = obj(item);
    const messageId = str(s.messageId);
    const status = str(s.status);
    if (!messageId || !["sent", "delivered", "read", "error"].includes(status)) continue;
    const e = obj(s.error);
    out.push({
      messageId: wazzupMessageKey(messageId),
      at: isoOf(s.timestamp),
      status,
      error: status === "error" ? wazzupErrorText(str(e.error), str(e.description)) : "",
    });
  }
  return out;
}

const ERROR_TEXT: Record<string, string> = {
  BAD_CONTACT: "у номера нет WhatsApp",
  TOO_LONG_TEXT: "слишком длинный текст",
  BAD_LINK: "файл не скачался",
  SPAM: "WhatsApp счёл сообщение спамом",
  "24_HOURS_EXCEEDED": "прошло 24 часа — нужен шаблон WABA",
  MESSAGE_DELETED: "сообщение удалено",
  CHANNEL_NOT_FOUND: "канал Wazzup не найден",
  CHANNEL_BLOCKED: "канал Wazzup заблокирован",
  CHAT_NO_ACCESS: "нет доступа к чату",
  MESSAGE_WRONG_CONTENT_TYPE: "Wazzup не принимает такой файл",
  BALANCE_IS_EMPTY: "в Wazzup закончились деньги",
  INVALID_API_KEY: "Wazzup не принял ключ",
};

export function wazzupErrorText(code: string, description = ""): string {
  return ERROR_TEXT[code] ?? (description || code || "ошибка без описания");
}

/**
 * Ошибка, после которой рассылку надо ставить на паузу целиком (дело не в
 * номере получателя, а в канале или ключе).
 */
export function isChannelError(code: string, httpStatus: number): boolean {
  if (httpStatus === 401 || httpStatus === 403) return true;
  return ["CHANNEL_NOT_FOUND", "CHANNEL_BLOCKED", "BALANCE_IS_EMPTY", "INVALID_API_KEY", "CHANNEL_NOT_ACTIVE"].includes(code);
}

export const CHANNEL_STATE_TEXT: Record<string, string> = {
  active: "работает",
  init: "запускается",
  disabled: "выключен",
  phoneUnavailable: "нет связи с телефоном",
  qr: "нужно отсканировать QR-код",
  openElsewhere: "открыт в другом аккаунте",
  notEnoughMoney: "не оплачен",
  foreignphone: "QR отсканирован другим номером",
  unauthorized: "не авторизован",
  waitForPassword: "ждёт пароль двухэтапной проверки",
  onModeration: "на модерации",
  rejected: "отклонён",
};
