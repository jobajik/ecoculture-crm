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
