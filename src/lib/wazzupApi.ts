import { wazzupErrorText, wazzupMessageKey } from "./wazzup";

// ---------------------------------------------------------------------------
// Wazzup API v3 — отправка сообщений в WhatsApp и настройка уведомлений.
// Только сервер: ключ никогда не уходит в браузер.
//
// Ключ владелец вводит сам (`wazzup-key.bat`, ввод скрыт): WAZZUP_API_KEY —
// «Интеграции с CRM» → API в кабинете Wazzup. WAZZUP_WEBHOOK_TOKEN .bat
// придумывает сам: он стоит в адресе уведомлений, иначе их прислал бы кто
// угодно (Wazzup своего заголовка с подписью нашему API не шлёт).
// Если каналов несколько — WAZZUP_CHANNEL_ID выбирает, с какого номера слать.
// ---------------------------------------------------------------------------

export const WAZZUP_BASE = "https://api.wazzup24.com/v3";

export function wazzupKey(): string {
  return (process.env.WAZZUP_API_KEY || "").trim();
}

export function wazzupConfigured(): boolean {
  return wazzupKey().length > 0;
}

export class WazzupError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, timeoutMs = 20000): Promise<T> {
  const key = wazzupKey();
  if (!key) throw new WazzupError("Wazzup не подключён — владелец вводит ключ в wazzup-key.bat", 0, "NO_KEY");
  let res: Response;
  try {
    res = await fetch(`${WAZZUP_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new WazzupError("Wazzup не ответил — попробуйте ещё раз", 0, "NETWORK");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data && typeof data === "object" ? data : {}) as { error?: string; description?: string };
    const code = String(d.error || "");
    const message =
      res.status === 401
        ? "Wazzup не принял ключ — проверьте ключ (wazzup-key.bat)"
        : res.status === 429
          ? "Wazzup просит подождать — слишком часто"
          : wazzupErrorText(code, String(d.description || "")) || `Wazzup ответил ошибкой ${res.status}`;
    throw new WazzupError(message.split(key).join("***"), res.status, code);
  }
  return data as T;
}

export interface WazzupChannel {
  channelId: string;
  transport: string;
  plainId: string;
  state: string;
}

export async function listChannels(): Promise<WazzupChannel[]> {
  const raw = await call<unknown>("GET", "/channels", undefined, 10000);
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
    .map((c) => ({
      channelId: String(c.channelId || ""),
      transport: String(c.transport || ""),
      plainId: String(c.plainId || ""),
      state: String(c.state || ""),
    }))
    .filter((c) => c.channelId);
}

/**
 * Канал WhatsApp, с которого шлём: заданный WAZZUP_CHANNEL_ID, иначе первый
 * рабочий обычный WhatsApp, иначе первый WhatsApp любой.
 */
export function pickWhatsappChannel(channels: WazzupChannel[], preferred = (process.env.WAZZUP_CHANNEL_ID || "").trim()): WazzupChannel | null {
  if (preferred) return channels.find((c) => c.channelId === preferred) ?? null;
  const wa = channels.filter((c) => c.transport === "whatsapp");
  return wa.find((c) => c.state === "active") ?? wa[0] ?? null;
}

/** Сообщение в WhatsApp: текст ИЛИ файл по ссылке (Wazzup не шлёт их вместе). */
export async function sendWazzup(input: {
  channelId: string;
  phone: string;
  text?: string;
  contentUri?: string;
  crmMessageId?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    channelId: input.channelId,
    chatType: "whatsapp",
    chatId: input.phone,
  };
  if (input.contentUri) body.contentUri = input.contentUri;
  else body.text = input.text ?? "";
  if (input.crmMessageId) body.crmMessageId = input.crmMessageId;
  const r = await call<{ messageId?: string }>("POST", "/message", body, 25000);
  const id = String(r?.messageId || "");
  if (!id) throw new WazzupError("Wazzup не вернул номер сообщения", 502, "NO_ID");
  return wazzupMessageKey(id);
}

/** Уведомления о сообщениях и статусах — на наш адрес. Wazzup сразу шлёт { test: true }. */
export async function subscribeWebhooks(webhooksUri: string): Promise<unknown> {
  return call("PATCH", "/webhooks", {
    webhooksUri,
    subscriptions: { messagesAndStatuses: true, contactsAndDealsCreation: false, channelsUpdates: true },
  });
}

export async function getWebhooks(): Promise<unknown> {
  return call("GET", "/webhooks");
}
