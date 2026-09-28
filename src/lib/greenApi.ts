import { parseHistoryItem } from "./whatsapp";
import type { WaMessage } from "./types";
import { greenSendErrorText } from "./greenOut";

// ---------------------------------------------------------------------------
// Green API — шлюз к рабочему WhatsApp (green-api.com). Номер подключается в
// их кабинете по QR-коду, как WhatsApp Web. Программа читает историю чата,
// принимает уведомления на `/api/whatsapp/webhook` и — для рассылок и бота —
// отправляет сообщения (`sendText`, `sendFileByUrl`). Для рассылок нужен тариф
// «Бизнес»: бесплатный «Разработчик» пишет только в 3 чата.
//
// Ключи владелец вводит сам (`whatsapp-key.bat`): GREENAPI_URL (apiUrl из
// карточки инстанса), GREENAPI_INSTANCE (idInstance), GREENAPI_TOKEN
// (apiTokenInstance). WHATSAPP_WEBHOOK_TOKEN .bat придумывает сам и прописывает
// в Green API через `scripts/whatsapp-setup.ts` — вручную его никто не копирует.
// ---------------------------------------------------------------------------

export interface GreenConfig {
  url: string;
  instance: string;
  token: string;
}

export function greenConfig(): GreenConfig | null {
  const url = (process.env.GREENAPI_URL || "https://api.green-api.com").trim().replace(/\/+$/, "");
  const instance = (process.env.GREENAPI_INSTANCE || "").trim();
  const token = (process.env.GREENAPI_TOKEN || "").trim();
  if (!instance || !token) return null;
  return { url, instance, token };
}

function endpoint(cfg: GreenConfig, method: string): string {
  return `${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}`;
}

/** Ошибка без токена в тексте: адрес запроса содержит ключ и печататься не должен. */
function safeError(cfg: GreenConfig, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(msg.split(cfg.token).join("***"));
}

async function call<T>(cfg: GreenConfig, method: string, body?: unknown, timeoutMs = 20000): Promise<T> {
  try {
    const res = await fetch(endpoint(cfg, method), {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Green API ${method}: ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : null) as T;
  } catch (err) {
    throw safeError(cfg, err);
  }
}

/** Отказ Green API при отправке: код ответа нужен, чтобы решить — пауза, повтор или номер. */
export class GreenError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
  }
}

/** Отправка: в отличие от `call`, отказ несёт код ответа (0 — не дозвонились). */
async function send(cfg: GreenConfig, method: string, body: Record<string, unknown>): Promise<string> {
  let res: Response;
  try {
    res = await fetch(endpoint(cfg, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
  } catch (err) {
    throw new GreenError(greenSendErrorText(0, ""), 0, safeError(cfg, err).message);
  }
  const text = (await res.text()).split(cfg.token).join("***");
  if (!res.ok) throw new GreenError(greenSendErrorText(res.status, text), res.status, text.slice(0, 300));
  let id = "";
  try {
    id = String((JSON.parse(text) as { idMessage?: string }).idMessage || "");
  } catch {
    /* ниже — общий отказ */
  }
  if (!id) throw new GreenError("Green API не вернул номер сообщения", 502, text.slice(0, 300));
  return id;
}

/** Текстовое сообщение. Возвращает idMessage — по нему придут статусы доставки. */
export async function sendText(cfg: GreenConfig, phone: string, message: string): Promise<string> {
  const chatId = chatIdForPhone(phone);
  if (!chatId) throw new GreenError("неверный номер", 400, "");
  return send(cfg, "sendMessage", { chatId, message });
}

/** Файл по ссылке (картинка, PDF) с подписью до 1024 знаков. */
export async function sendFileByUrl(
  cfg: GreenConfig,
  phone: string,
  urlFile: string,
  fileName: string,
  caption: string
): Promise<string> {
  const chatId = chatIdForPhone(phone);
  if (!chatId) throw new GreenError("неверный номер", 400, "");
  return send(cfg, "sendFileByUrl", { chatId, urlFile, fileName, ...(caption ? { caption } : {}) });
}

/** chatId WhatsApp из номера: «8 701 …» и «+7 701 …» → «7701…@c.us». */
export function chatIdForPhone(phone: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = `7${d.slice(1)}`;
  if (d.length === 10) d = `7${d}`;
  return d.length >= 11 ? `${d}@c.us` : "";
}

/** Последние `count` сообщений чата с номером — от старых к новым. */
export async function fetchChatHistory(cfg: GreenConfig, phone: string, count = 150): Promise<WaMessage[]> {
  const chatId = chatIdForPhone(phone);
  if (!chatId) return [];
  const items = await call<unknown[]>(cfg, "getChatHistory", { chatId, count });
  return (Array.isArray(items) ? items : [])
    .map(parseHistoryItem)
    .filter((m): m is WaMessage => !!m)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

export async function getInstanceState(cfg: GreenConfig): Promise<string> {
  const r = await call<{ stateInstance?: string }>(cfg, "getStateInstance");
  return String(r?.stateInstance || "unknown");
}

/**
 * Уведомления — на наш адрес, с токеном: входящие, отправленные с телефона и
 * через API, и статусы доставки (`outgoingWebhook`) — их ждут рассылки. Статусы
 * переписки с телефона вебхук отбрасывает сам (`parseGreenStatus`).
 */
export async function configureWebhook(cfg: GreenConfig, webhookUrl: string, webhookToken: string): Promise<unknown> {
  return call(cfg, "setSettings", {
    webhookUrl,
    webhookUrlToken: webhookToken,
    incomingWebhook: "yes",
    outgoingMessageWebhook: "yes",
    outgoingAPIMessageWebhook: "yes",
    outgoingWebhook: "yes",
    stateWebhook: "no",
    incomingCallWebhook: "no",
    pollMessageWebhook: "no",
    // Программа ничего не читает за менеджера: галочки «прочитано» ставит он сам.
    markIncomingMessagesReaded: "no",
  });
}

/** Скачать файл сообщения (голосовое) по ссылке из уведомления. */
export async function downloadMedia(url: string, maxBytes = 20 * 1024 * 1024): Promise<{ data: ArrayBuffer; mime: string } | null> {
  if (!/^https:\/\//.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.arrayBuffer();
  if (data.byteLength === 0 || data.byteLength > maxBytes) return null;
  return { data, mime: res.headers.get("content-type") || "audio/ogg" };
}

/**
 * Токен вебхука сравнивается целиком, за постоянное время. Green API шлёт его
 * заголовком `Authorization: Bearer <токен>`; принимаем и голый токен — на
 * случай, если его вписали в кабинете вместе со словом «Bearer».
 */
export function webhookTokenOk(header: string | null, expected: string | undefined): boolean {
  const want = (expected || "").trim();
  if (!want || !header) return false;
  const got = header.trim().replace(/^Bearer\s+/i, "").replace(/^Bearer\s+/i, "").trim();
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
