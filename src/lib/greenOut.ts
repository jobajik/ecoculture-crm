import type { WaMessage } from "./types";
import type { WaStatusRow } from "./broadcast";

// ---------------------------------------------------------------------------
// Рассылки и бот через Green API — чистые правила (без сети и без googleapis):
// их зовут вебхук `/api/whatsapp/webhook`, серверные действия рассылок, бот и
// проверка `scripts/check-broadcasts.ts`. Обмен с Green API — `greenApi.ts`.
//
// Сентябрь 2026: владелец сначала выбрал Wazzup, потом передумал — «давай
// Green API». Green API у нас уже был подключён для переписки рабочего номера,
// поэтому рассылка, статусы доставки, ответы клиентов и бот идут через тот же
// инстанс и тот же вебхук.
//
// Форматы — по документации Green API:
//   outgoingMessageStatus: { typeWebhook, chatId, timestamp, idMessage,
//                            status, description?, sendByApi }
//   status: sent | delivered | read | failed | noAccount | notInGroup |
//           suspended | yellowCard (устаревшее имя suspended)
// ---------------------------------------------------------------------------

/** Сообщение из уведомления с пометками, нужными боту. */
export interface BotIncoming extends WaMessage {
  /** Наше исходящее (с телефона, WhatsApp Web или через API). */
  isEcho: boolean;
  /** Отправлено через API — это рассылка или сам бот, а не живой менеджер. */
  fromApi: boolean;
}

/** Уведомление + уже разобранное сообщение → то, что нужно боту. */
export function botIncomingOf(body: unknown, message: WaMessage | null): BotIncoming | null {
  if (!message) return null;
  const type = String((body as Record<string, unknown> | null)?.typeWebhook || "");
  return {
    ...message,
    isEcho: message.direction === "out",
    fromApi: type === "outgoingAPIMessageReceived",
  };
}

const STATUS_ERRORS: Record<string, string> = {
  failed: "не отправилось",
  noAccount: "у номера нет WhatsApp",
  notInGroup: "не в группе",
  suspended: "WhatsApp временно ограничил номер",
  yellowCard: "WhatsApp временно ограничил номер",
};

/**
 * Статус доставки из уведомления. Только сообщения, отправленные через API
 * (`sendByApi`): статусы переписки менеджеров с телефона рассылке не нужны, а
 * писать их — лишние строки в таблице на каждое «доставлено» и «прочитано».
 */
export function parseGreenStatus(body: unknown): WaStatusRow | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.typeWebhook !== "outgoingMessageStatus") return null;
  if (b.sendByApi !== true) return null;
  const messageId = String(b.idMessage || "").trim();
  const raw = String(b.status || "").trim();
  if (!messageId || !raw) return null;
  const ts = Number(b.timestamp);
  const at = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  if (raw === "sent" || raw === "delivered" || raw === "read") return { messageId, at, status: raw, error: "" };
  const known = STATUS_ERRORS[raw];
  if (!known) return null;
  const description = String(b.description || "").trim();
  return { messageId, at, status: "error", error: raw === "failed" && description ? `${known}: ${description.slice(0, 120)}` : known };
}

/**
 * Состояние инстанса (`getStateInstance`) — по-русски. Его спрашивают перед
 * КАЖДЫМ сообщением рассылки: номер под ограничением WhatsApp (suspended /
 * yellowCard) ставит рассылку на паузу сам, до следующего сообщения.
 */
export const GREEN_STATE_TEXT: Record<string, string> = {
  authorized: "работает",
  notAuthorized: "нужно заново отсканировать QR-код в кабинете Green API",
  blocked: "номер заблокирован WhatsApp",
  sleepMode: "телефон не в сети",
  starting: "запускается — подождите пару минут",
  yellowCard: "WhatsApp временно ограничил номер — перезапустите инстанс в кабинете Green API",
  suspended: "WhatsApp временно ограничил номер — перезапустите инстанс в кабинете Green API",
};

export function greenStateText(state: string): string {
  return GREEN_STATE_TEXT[state] ?? `состояние «${state || "неизвестно"}»`;
}

/**
 * Отказ Green API при отправке — по-русски. 466 — лимит тарифа: на бесплатном
 * «Разработчике» можно писать только в 3 чата, для рассылок нужен «Бизнес».
 */
export function greenSendErrorText(httpStatus: number, body: string): string {
  if (httpStatus === 466) return "лимит тарифа Green API: на бесплатном тарифе можно писать только в 3 чата — нужен тариф «Бизнес»";
  if (httpStatus === 401 || httpStatus === 403) return "Green API не принял ключ — проверьте idInstance и apiTokenInstance (whatsapp-key.bat)";
  if (httpStatus === 429) return "Green API просит писать реже — попробую позже";
  if (httpStatus === 400 && /chatId/i.test(body)) return "неверный номер";
  if (httpStatus === 0 || httpStatus >= 500) return "Green API не ответил — попробую позже";
  return `Green API отказал (${httpStatus})`;
}

/**
 * Что делать с рассылкой после отказа Green API:
 * - `pause` — дело в канале или тарифе (ключ, лимит «Разработчика»): стоп до человека;
 * - `retry` — сбой связи или «пишите реже»: этого получателя попробуем снова позже;
 * - `recipient` — дело в номере: отметить ошибку у получателя и идти дальше.
 */
export function greenFailureKind(httpStatus: number): "pause" | "retry" | "recipient" {
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 466) return "pause";
  if (httpStatus === 0 || httpStatus === 429 || httpStatus >= 500) return "retry";
  return "recipient";
}

/** Подпись к файлу у WhatsApp — до 1024 знаков; длиннее уходит отдельным сообщением. */
export const MAX_CAPTION = 1024;

/** Имя файла для WhatsApp: латиница и обязательно с расширением — иначе Green API откажет. */
export function greenFileName(safeName: string, mime: string): string {
  const ext: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  const name = (safeName || "file").trim();
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  return `${name}.${ext[mime] ?? "bin"}`;
}
