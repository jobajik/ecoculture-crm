import { FARM_LABELS, MONEY_EPSILON, ORDER_STATUSES } from "./constants";
import { canEditFinance } from "./financeAccess";
import type { KaspiInvoice } from "./types";

// ---------------------------------------------------------------------------
// Счёт Kaspi Pay на телефон клиента через ApiPay (apipay.kz) — чистые правила.
//
// Владелец: «доделать ту штуку с API и выставлением счетов на Kaspi Pay
// удалённо». Решения владельца: счёт выставляет ТОЛЬКО бухгалтер (и админ);
// номер — «Каспи Pay №1» из карточки клиента, иначе телефон заявки, и его
// можно поправить перед отправкой; оплаченный счёт программа проводит САМА —
// платёж ложится в заявку, как если бы его внесла бухгалтер.
//
// Касса Kaspi — у каждой компании своя (Rose Farm — роза и эустома, Есентай —
// хризантема), поэтому счёт выставляется на ЧАСТЬ заявки одной компании, как и
// оплата по компаниям. Подключена ли касса — решает наличие ключа ApiPay этой
// компании в настройках сервера (`apipay.ts`).
//
// Модуль без обращений к сети и к таблице: его зовут и страницы, и проверка
// `scripts/check-kaspi.ts`.
// ---------------------------------------------------------------------------

/** Счёт ещё «в пути»: второй на ту же часть заявки не выставляем. */
export const OPEN_STATUSES = ["processing", "pending", "cancelling"];

export const KASPI_STATUS_LABELS: Record<string, string> = {
  processing: "отправляется",
  pending: "ждёт оплаты",
  cancelling: "отменяется",
  paid: "оплачен",
  partially_refunded: "оплачен, частичный возврат",
  cancelled: "отменён",
  expired: "истёк",
  error: "ошибка",
};

export function kaspiStatusLabel(status: string): string {
  return KASPI_STATUS_LABELS[status] ?? status ?? "—";
}

export const isOpenKaspiStatus = (s: string) => OPEN_STATUSES.includes(s);
export const isPaidKaspiStatus = (s: string) => s === "paid" || s === "partially_refunded";

/** Понятные слова вместо кодов ошибок ApiPay (`error_code`). */
const ERROR_TEXT: Record<string, string> = {
  client_not_found: "этот номер не зарегистрирован в Kaspi — проверьте номер",
  network_unavailable: "Kaspi временно не отвечает — попробуйте позже",
  kaspi_session_expired: "касса Kaspi отключилась — переподключите кассира в ApiPay",
  kaspi_session_not_configured: "касса не подключена в ApiPay",
  sandbox_simulated_error: "тестовая ошибка (режим песочницы)",
};

export function kaspiErrorText(code: string, message = ""): string {
  return ERROR_TEXT[code] ?? (message || code || "ошибка без описания");
}

/**
 * Номер для Kaspi в виде 8XXXXXXXXXX (так требует ApiPay). «+7 701 555 20 30»,
 * «87015552030», «7015552030» → «87015552030». Не мобильный казахстанский
 * номер — пустая строка.
 */
export function kaspiPhone(raw: string | null | undefined): string {
  const digits = (raw || "").replace(/\D/g, "");
  let ten = "";
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) ten = digits.slice(1);
  else if (digits.length === 10) ten = digits;
  // Мобильные коды Казахстана — 70x, 74x…78x; 71x и 72x — городские
  // (Астана 7172, Алматы 727), на них Kaspi-счёт не выставить.
  if (!/^7[03-9]\d{8}$/.test(ten)) return "";
  return `8${ten}`;
}

/** Какой номер подставить: Каспи клиента №1, №2, иначе телефон заявки. */
export function suggestedKaspiPhone(candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const p = kaspiPhone(c);
    if (p) return p;
  }
  return "";
}

/** Подпись счёта в Kaspi: клиент видит первые 60 знаков. */
export function kaspiDescription(farm: string, orderCode: string): string {
  const company = FARM_LABELS[farm] ?? "Ecoculture";
  return `${company}: оплата заявки ${orderCode}`.slice(0, 60);
}

export interface KaspiSendInput {
  role: string | null | undefined;
  /** Касса этой компании подключена (есть ключ ApiPay). */
  farmConfigured: boolean;
  farm: string;
  /** Компании, у которых есть счёт в этой заявке. */
  invoiceFarms: { farm: string; amount: number; paidAmount: number }[];
  orderStatus: string;
  /** Заявка без счёта: наш магазин или объём на город. */
  noInvoice: boolean;
  phone: string;
  amount: number;
  /** Уже выставленные по заявке счета. */
  existing: Pick<KaspiInvoice, "farm" | "status">[];
}

/** Почему счёт выставить нельзя; пустая строка — можно. */
export function kaspiSendRefusal(input: KaspiSendInput): string {
  if (!canEditFinance(input.role)) return "Счёт в Kaspi выставляет бухгалтер";
  if (input.noInvoice) return "У этой заявки нет счёта клиенту";
  if (input.orderStatus === ORDER_STATUSES.CANCELLED) return "Заявка отменена";
  const part = input.invoiceFarms.find((f) => f.farm === input.farm);
  if (!part) return "В заявке нет цветка этой компании";
  if (!input.farmConfigured) {
    return `Касса Kaspi ${FARM_LABELS[input.farm] ?? input.farm} не подключена к программе`;
  }
  if (!kaspiPhone(input.phone)) return "Нужен мобильный номер клиента в Kaspi: 8 7XX XXX XX XX";
  if (!Number.isInteger(input.amount) || input.amount < 1) return "Сумма — целое число тенге, больше нуля";
  const due = part.amount - part.paidAmount;
  if (due <= MONEY_EPSILON) return "Эта часть заявки уже оплачена";
  if (input.amount > Math.ceil(due)) return `Больше остатка к оплате (${Math.ceil(due).toLocaleString("ru-RU")} ₸)`;
  if (input.existing.some((i) => i.farm === input.farm && isOpenKaspiStatus(i.status))) {
    return "Счёт на эту часть уже отправлен и ждёт оплаты — сначала отмените его";
  }
  return "";
}

/** Сколько предложить в счёте: остаток по компании, до целого тенге вверх. */
export function kaspiDueAmount(part: { amount: number; paidAmount: number }): number {
  const due = part.amount - part.paidAmount;
  return due > MONEY_EPSILON ? Math.ceil(due - 0.001) : 0;
}

/**
 * Что делать со строкой счёта при новом статусе от ApiPay. Платёж
 * проводится ОДИН раз: только если счёт оплачен, а ссылки на платёж ещё нет.
 */
export function kaspiStatusPlan(
  row: Pick<KaspiInvoice, "status" | "paymentId">,
  next: { status: string }
): { changed: boolean; recordPayment: boolean } {
  const changed = row.status !== next.status;
  const recordPayment = isPaidKaspiStatus(next.status) && !row.paymentId;
  return { changed, recordPayment };
}

// ---------------------------------------------------------------------------
// Выбор номера и «где сейчас счёт» — для блока в панели оплаты и для страницы
// «Статус оплат». Владелец: «нужно понимать, что можно выбрать номер из списка,
// если несколько каспи; тупо нажать кнопку, чтобы отправился счёт, и трекерить
// оплату».
// ---------------------------------------------------------------------------

export interface KaspiPhoneOption {
  /** 8XXXXXXXXXX */
  phone: string;
  /** Откуда номер: «Kaspi №1», «телефон заявки»… Несколько источников — через запятую. */
  label: string;
}

/**
 * Номера, на которые можно выставить счёт, в порядке предпочтения. Городские и
 * битые отбрасываются, одинаковые склеиваются: «+7 701…» в карточке и «8701…» в
 * заявке — один номер, и два одинаковых варианта выглядели бы как два разных.
 */
export function kaspiPhoneOptions(candidates: [string | null | undefined, string][]): KaspiPhoneOption[] {
  const out: KaspiPhoneOption[] = [];
  for (const [raw, label] of candidates) {
    const phone = kaspiPhone(raw);
    if (!phone) continue;
    const same = out.find((o) => o.phone === phone);
    if (same) {
      if (!same.label.split(", ").includes(label)) same.label = `${same.label}, ${label}`;
    } else {
      out.push({ phone, label });
    }
  }
  return out;
}

/** «87015552030» → «8 701 555 20 30». */
export function prettyKaspiPhone(p: string): string {
  return /^\d{11}$/.test(p) ? `${p[0]} ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9)}` : p;
}

/**
 * Шаг счёта для полоски «отправлен → у клиента → оплачен». 1 — уходит в Kaspi,
 * 2 — клиенту пришёл счёт, ждём, 3 — оплачен. 0 — счёт не дошёл (ошибка,
 * истёк, отменён): полоска красится серым или красным, а не зелёным.
 */
export function kaspiTrackerStep(status: string): 0 | 1 | 2 | 3 {
  if (isPaidKaspiStatus(status)) return 3;
  if (status === "pending" || status === "cancelling") return 2;
  if (status === "processing") return 1;
  return 0;
}

/** «ждёт 12 мин», «ждёт 3 ч», «ждёт 2 дн.» — сколько счёт висит без оплаты. */
export function waitingWords(fromIso: string, now: Date = new Date()): string {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} дн.`;
}
