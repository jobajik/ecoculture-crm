import { createHmac, timingSafeEqual } from "node:crypto";
import { FARMS } from "./constants";

// ---------------------------------------------------------------------------
// ApiPay (apipay.kz) — REST API к кассе Kaspi Pay. Только сервер: ключ API
// никогда не уходит в браузер (так требует и сам ApiPay).
//
// У каждой компании своя касса Kaspi, а в ApiPay одна организация = один
// Kaspi Pay/БИН со своим ключом. Поэтому настройки — ПО КОМПАНИИ, в
// переменных окружения (в .env.local и на Vercel; в код ключи не попадают):
//
//   APIPAY_ESENTAI_KEY               ключ API организации Есентай
//   APIPAY_ESENTAI_WEBHOOK_SECRET    секрет подписи вебхука этого ключа
//   APIPAY_ESENTAI_CONNECTION_ID     (необязательно) номер кассы, если их несколько
//   APIPAY_ROSE_FARM_KEY … — то же для Rose Farm
//
// Нет ключа — касса компании считается не подключённой, и кнопки выставить
// счёт у этой части заявки нет.
// ---------------------------------------------------------------------------

export const APIPAY_BASE = "https://api.apipay.kz/api/v1";

const ENV_PREFIX: Record<string, string> = {
  [FARMS.ESENTAI]: "APIPAY_ESENTAI",
  [FARMS.ROSE_FARM]: "APIPAY_ROSE_FARM",
};

export interface ApiPayFarmConfig {
  farm: string;
  key: string;
  webhookSecret: string;
  connectionId: number | null;
}

export function apiPayConfig(farm: string): ApiPayFarmConfig | null {
  const prefix = ENV_PREFIX[farm];
  if (!prefix) return null;
  const key = (process.env[`${prefix}_KEY`] || "").trim();
  if (!key) return null;
  const conn = Number((process.env[`${prefix}_CONNECTION_ID`] || "").trim());
  return {
    farm,
    key,
    webhookSecret: (process.env[`${prefix}_WEBHOOK_SECRET`] || "").trim(),
    connectionId: Number.isInteger(conn) && conn > 0 ? conn : null,
  };
}

/** Компании, у которых касса подключена. */
export function configuredFarms(): string[] {
  return Object.keys(ENV_PREFIX).filter((f) => apiPayConfig(f));
}

export class ApiPayError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public body: unknown
  ) {
    super(message);
  }
}

/** Понятный текст для человека по ответу ApiPay. Ключ в текст не попадает никогда. */
function humanError(status: number, code: string, message: string): string {
  if (status === 401) return "ApiPay не принял ключ — проверьте ключ в настройках";
  if (status === 403 && code === "kyc_required") return "ApiPay ждёт одобрения анкеты бизнеса (KYC)";
  if (status === 403 && code === "organization_archived") return "Организация в ApiPay в архиве";
  if (status === 409) return "Такой счёт уже создан";
  if (status === 422 && code === "connection_ambiguous") return "В ApiPay несколько касс — укажите, с какой выставлять";
  if (status === 422 && code === "amount_must_be_whole_tenge") return "Сумма должна быть целой";
  if (status === 429 && (code === "tariff_limit_reached" || code === "trial_daily_limit")) {
    return "Дневной лимит счетов по тарифу ApiPay исчерпан";
  }
  if (status === 429) return "ApiPay просит подождать — слишком часто";
  if (status >= 500) return "ApiPay временно не отвечает — попробуйте позже";
  return message || `ApiPay ответил ошибкой ${status}${code ? ` (${code})` : ""}`;
}

/** Какое поле ApiPay не принял — по-русски. Раньше на экран шло голое «Validation failed». */
const FIELD_NAMES: Record<string, string> = {
  phone_number: "номер",
  client_phone: "номер",
  amount: "сумма",
  description: "подпись счёта",
  external_order_id: "номер заявки",
  external_order_id_idempotency: "ключ повтора",
  kaspi_connection_id: "касса",
};

export function validationText(body: unknown): string {
  const errors = (body as { errors?: Record<string, unknown> } | null)?.errors;
  if (!errors || typeof errors !== "object") return "";
  const parts = Object.entries(errors).map(([field, msgs]) => {
    const first = Array.isArray(msgs) ? String(msgs[0] ?? "") : String(msgs ?? "");
    return `${FIELD_NAMES[field] ?? field}${first ? ` — ${first}` : ""}`;
  });
  return parts.length ? `ApiPay не принял счёт: ${parts.join("; ")}` : "";
}

async function call<T>(
  cfg: ApiPayFarmConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${APIPAY_BASE}${path}`, {
    method,
    headers: {
      "X-API-Key": cfg.key,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string; message?: string; error_code?: string };
    const code = String(d.code || d.error_code || d.error || "");
    const text422 = res.status === 422 ? validationText(data) : "";
    throw new ApiPayError(text422 || humanError(res.status, code, String(d.message || "")), res.status, code, data);
  }
  return data as T;
}

/** Счёт так, как его отдаёт ApiPay (нужные нам поля). */
export interface ApiPayInvoice {
  id: number | string;
  status: string;
  amount: string | number;
  client_phone?: string;
  external_order_id?: string | null;
  paid_at?: string | null;
  kaspi_invoice_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  is_sandbox?: boolean;
}

/** Данные счёта бывают и в корне ответа, и в `data` / `invoice`. */
export function unwrapInvoice(raw: unknown): ApiPayInvoice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const inner = (r.invoice ?? (r.data as Record<string, unknown> | undefined)?.invoice ?? r.data ?? r) as Record<string, unknown>;
  if (!inner || inner.id === undefined || inner.id === null) return null;
  return inner as unknown as ApiPayInvoice;
}

export async function createInvoice(
  cfg: ApiPayFarmConfig,
  input: { phone: string; amount: number; description: string; externalOrderId: string; idempotencyKey: string }
): Promise<ApiPayInvoice> {
  const raw = await call<unknown>(cfg, "POST", "/invoices", {
    // Поле номера у ApiPay — phone_number (так в их документации и примерах). Первая версия
    // слала client_phone, и ApiPay отвечал «Validation failed».
    phone_number: input.phone,
    amount: input.amount,
    description: input.description,
    external_order_id: input.externalOrderId,
    external_order_id_idempotency: input.idempotencyKey,
    ...(cfg.connectionId ? { kaspi_connection_id: cfg.connectionId } : {}),
  });
  const inv = unwrapInvoice(raw);
  if (!inv) throw new ApiPayError("ApiPay ответил без номера счёта", 502, "no_id", raw);
  return inv;
}

export async function getInvoice(cfg: ApiPayFarmConfig, id: string): Promise<ApiPayInvoice> {
  const inv = unwrapInvoice(await call<unknown>(cfg, "GET", `/invoices/${encodeURIComponent(id)}`));
  if (!inv) throw new ApiPayError("ApiPay не вернул счёт", 502, "no_id", null);
  return inv;
}

export async function cancelInvoice(cfg: ApiPayFarmConfig, id: string): Promise<ApiPayInvoice | null> {
  return unwrapInvoice(await call<unknown>(cfg, "POST", `/invoices/${encodeURIComponent(id)}/cancel`, {}));
}

/** Для диагностики: что видит ключ (без самого ключа). */
export async function apiPayGet(cfg: ApiPayFarmConfig, path: string): Promise<unknown> {
  return call<unknown>(cfg, "GET", path);
}

/**
 * Подпись вебхука: `X-Webhook-Signature: sha256=<hex>` = HMAC-SHA256 от СЫРОГО
 * тела запроса (до разбора JSON) секретом вебхука. Сравнение — за постоянное
 * время, чтобы подпись нельзя было подобрать по времени ответа.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  const given = header.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  if (given.length !== expected.length || !/^[0-9a-f]+$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}
