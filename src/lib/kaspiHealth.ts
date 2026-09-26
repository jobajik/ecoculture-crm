/*
 * Жива ли Kaspi-касса в ApiPay.
 *
 * ApiPay работает от имени кассира Kaspi Pay. Если под номером кассира кто-то
 * зайдёт в приложение Kaspi Pay или Kaspi сам сбросит вход, ApiPay теряет
 * сессию — и счета молча перестают уходить (владелец: «сегодня вылетело»).
 * Узнавали об этом по жалобам клиентов. Теперь сайт спрашивает ApiPay сам
 * (`GET /account/health`) и показывает бухгалтеру и админу красную полосу.
 *
 * Ответ проверен на живом ключе (сентябрь 2026, `scripts/apipay-check.ts`):
 *
 *   connection: { kaspi_connected: true, session_status: "expired",
 *                 session_error_at: "2026-09-26T22:34:07+05:00",
 *                 needs_reauth: true, last_used_at: "…" }
 *   tariff:     { status: "active", … }
 *   invoicing:  { accumulating: false, held_since: null }
 *
 * Правило граблей 1.14: «не смогли спросить» — это НЕ «касса отключилась».
 * Непонятный ответ или сбой сети даёт `unknown`, и тревоги нет: ложная красная
 * полоса приучает её не замечать.
 */

export type KaspiHealthState = "ok" | "broken" | "unknown";

export interface KaspiHealthParsed {
  state: KaspiHealthState;
  /** Почему касса не работает — по-русски, для полосы. Пусто, если всё хорошо. */
  reason: string;
  /** Когда ApiPay заметил поломку (ISO), если сказал. */
  since: string;
  /** ApiPay придерживает новые счета и отправит их после переподключения. */
  holding: boolean;
  holdingSince: string;
}

const BROKEN_SESSION = new Set(["expired", "invalid", "error", "logged_out", "not_configured", "disconnected", "revoked"]);
const GOOD_SESSION = new Set(["active", "ok", "valid", "connected", "authorized"]);

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Разбор ответа `GET /account/health`. Всё незнакомое — `unknown`, а не тревога. */
export function parseAccountHealth(raw: unknown): KaspiHealthParsed {
  const root = obj(raw);
  const body = obj(root?.data) ?? root;
  const conn = obj(body?.connection);
  const tariff = obj(body?.tariff);
  const invoicing = obj(body?.invoicing);
  const holding = invoicing?.accumulating === true;
  const holdingSince = str(invoicing?.held_since);
  const since = str(conn?.session_error_at);
  const base = { since, holding, holdingSince };

  const tariffStatus = str(tariff?.status).toLowerCase();
  if (tariffStatus && tariffStatus !== "active" && tariffStatus !== "trial") {
    return { ...base, state: "broken", reason: "Тариф ApiPay не активен — продлите его в кабинете ApiPay" };
  }
  if (!conn) return { ...base, state: "unknown", reason: "" };

  const session = str(conn.session_status).toLowerCase();
  if (conn.kaspi_connected === false) {
    return { ...base, state: "broken", reason: "Кассир Kaspi не подключён к ApiPay" };
  }
  if (conn.needs_reauth === true || BROKEN_SESSION.has(session)) {
    return {
      ...base,
      state: "broken",
      reason: "Kaspi сбросил вход кассира — ApiPay не может выставлять счета",
    };
  }
  if (conn.needs_reauth === false || GOOD_SESSION.has(session)) {
    return { ...base, state: "ok", reason: "" };
  }
  return { ...base, state: "unknown", reason: "" };
}

/**
 * Код ошибки ApiPay про потерянный вход кассира: `kaspi_session_expired`,
 * `kaspi_session_invalid`, `kaspi_session_not_configured` (по документации
 * ApiPay). Повтор запроса их не лечит — нужна переавторизация по SMS.
 */
export function isKaspiSessionError(code: string | null | undefined): boolean {
  return /^kaspi_session_/i.test(String(code || "").trim());
}

/** Текст отказа при выставлении счёта, когда касса отключилась. */
export const KASPI_SESSION_MESSAGE =
  "Kaspi-касса отключилась: Kaspi сбросил вход кассира в ApiPay. Переподключите кассира в кабинете ApiPay (по SMS), " +
  "а пока вносите оплату вручную.";

// ---------------------------------------------------------------------------
// Переподключение кассира прямо из CRM (владелец: «да, сделай так»).
//
// ApiPay даёт три шага: `POST /connections/{id}/auth/init` → `.../send-phone`
// (Kaspi шлёт SMS на номер кассира) → `.../verify-otp` (код из SMS). Ключу
// нужно право «управление кассирами» (`can_manage_cashiers`), иначе 403
// `cashier_management_disabled`. Тела запросов — как в документации
// партнёрского API ApiPay: `{ cashier_phone: "7XXXXXXXXXX" }` и `{ otp }`;
// на всякий случай шлём и `phone` / `code` — лишнее поле ApiPay не мешает.
// Между первым шагом и кодом у Kaspi около 10 минут (`context_expired`).
// ---------------------------------------------------------------------------

export interface KaspiConnection {
  id: number;
  label: string;
  phone: string;
  /** Касса просит переподключения (или статус сессии «плохой»). */
  needsReauth: boolean;
}

/** Список кассиров из `GET /connections` — в любом из видов ответа. */
export function parseConnections(raw: unknown): KaspiConnection[] {
  const root = obj(raw);
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(root?.data)
      ? (root?.data as unknown[])
      : Array.isArray(root?.connections)
        ? (root?.connections as unknown[])
        : [];
  const out: KaspiConnection[] = [];
  for (const item of list) {
    const c = obj(item);
    if (!c) continue;
    const id = Number(c.id ?? c.connection_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const session = str(c.session_status ?? c.status).toLowerCase();
    out.push({
      id,
      label: str(c.label) || str(c.name) || str(c.cashier_name),
      phone: str(c.phone) || str(c.cashier_phone) || str(c.phone_number),
      needsReauth: c.needs_reauth === true || BROKEN_SESSION.has(session) || c.kaspi_connected === false,
    });
  }
  return out;
}

/**
 * Какого кассира переподключать: заданного в настройках (`…_CONNECTION_ID`),
 * иначе единственного, иначе того, кто просит переподключения, иначе первого.
 */
export function pickConnection(list: KaspiConnection[], preferredId: number | null): KaspiConnection | null {
  if (preferredId) return list.find((c) => c.id === preferredId) ?? null;
  if (list.length <= 1) return list[0] ?? null;
  return list.find((c) => c.needsReauth) ?? list[0];
}

/** Номер кассира в виде, который ждёт ApiPay: «7XXXXXXXXXX». Не мобильный — пусто. */
export function cashierPhone(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  let ten = "";
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) ten = digits.slice(1);
  else if (digits.length === 10) ten = digits;
  return /^7\d{9}$/.test(ten) ? `7${ten}` : "";
}

/** Код из SMS: 4–6 цифр, пробелы и дефисы убираем. Иначе пусто. */
export function cleanOtp(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/[\s-]/g, "");
  return /^\d{4,6}$/.test(digits) ? digits : "";
}

const RECONNECT_TEXT: Record<string, string> = {
  cashier_management_disabled:
    "У ключа ApiPay нет права управлять кассирами. Включите его в кабинете ApiPay (настройки API-ключа) — или переподключите кассира там же",
  kyc_required: "ApiPay ждёт одобрения анкеты бизнеса — до этого кассира не подключить",
  invalid_phone: "Номер кассира в неверном формате",
  not_cashier: "Этот номер не кассир в Kaspi Pay — проверьте номер или добавьте его в сотрудники Kaspi Pay",
  not_registered: "Этот номер не зарегистрирован кассиром в Kaspi Pay",
  context_expired: "Kaspi не дождался — прошло больше 10 минут. Начните заново",
  sms_failed: "Kaspi не смог отправить SMS — попробуйте через минуту",
  kaspi_busy: "Kaspi сейчас не отвечает — попробуйте через пару минут",
  cashier_unavailable: "Сейчас кассира подключить нельзя — попробуйте позже или в кабинете ApiPay",
  rate_limited: "Слишком много попыток с разными номерами за сегодня — попробуйте завтра",
  invalid_otp: "Код не подошёл — проверьте SMS и введите ещё раз",
};

/** Понятный текст для кода ошибки переподключения. Незнакомый — пусто. */
export function reconnectErrorText(code: string | null | undefined): string {
  return RECONNECT_TEXT[String(code || "").trim()] ?? "";
}
