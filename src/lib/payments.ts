import { MIXED_PAYMENT_METHOD, MONEY_EPSILON, ORDER_STATUSES, PAYMENT_METHODS } from "./constants";
import { canEditFinance } from "./financeAccess";

/**
 * Платежи по заявке — каждое поступление отдельной строкой.
 *
 * Просьба бухгалтера: «при внесении следующей суммы её негде просто писать,
 * также не видно, какими частями была оплата, и приходится к предыдущей сумме
 * вручную добавлять последующую». До этого у заявки было одно поле «получено
 * всего»: клиент внёс 300 000, через неделю ещё 200 000, и Юлия складывала их в
 * уме и перебивала итог на 500 000. Ошибиться в сложении легко, а после
 * перебивки уже не видно, что платежей было два и когда пришёл каждый.
 *
 * Теперь поступление вносится само по себе — сумма, день, способ, — а итог
 * заявки сервер складывает сам. Итог по-прежнему хранится в заявке
 * (`PaidAmount`): на нём держатся долги, звонки, бонусы и готовность к
 * отгрузке, и перечитывать ради него журнал на каждой странице незачем.
 *
 * Все правила — чистыми функциями, их проверяет `scripts/check-payments.ts`.
 */

export interface PaymentLike {
  paymentId: string;
  date: string;
  amount: number;
  farm: string;
  method: string;
}

/** Номер реализации 1С: без лишних пробелов и не длиннее разумного. */
export function cleanRealization(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export interface PaymentHistory {
  /** Платежи по дате поступления, старые сверху. */
  rows: PaymentLike[];
  /** Сумма записанных платежей. */
  recorded: number;
  /**
   * Разница между итогом заявки и суммой платежей. Бывает у заявок, оплаченных
   * ДО журнала (там итог вписан одним числом), и после ручного исправления
   * итога. Показываем её отдельной строкой: спрятать — значит показать сумму
   * платежей, не сходящуюся с «получено», и человек начнёт искать ошибку.
   */
  unrecorded: number;
}

export function paymentHistory(paidAmount: number, payments: PaymentLike[]): PaymentHistory {
  const rows = [...payments].sort(
    (a, b) => a.date.localeCompare(b.date) || a.paymentId.localeCompare(b.paymentId)
  );
  const recorded = round2(rows.reduce((s, p) => s + p.amount, 0));
  const diff = round2((Number(paidAmount) || 0) - recorded);
  return { rows, recorded, unrecorded: Math.abs(diff) > MONEY_EPSILON ? diff : 0 };
}

export interface AddPaymentInput {
  role: string | null | undefined;
  amount: number;
  /** День поступления, ГГГГ-ММ-ДД. */
  date: string;
  /** Сегодня, ГГГГ-ММ-ДД, — «из будущего» не бывает. */
  today: string;
  method: string;
  /** Какому ТОО. У смешанной заявки обязателен, у обычной — пусто. */
  farm: string;
  /** Компании в счёте заявки. */
  invoiceFarms: string[];
  status: string;
  /** Заявка без счёта клиенту: наш магазин или объём на город. */
  noInvoice: boolean;
}

/** Причина отказа или пустая строка. */
export function addPaymentRefusal(input: AddPaymentInput): string {
  if (!canEditFinance(input.role)) {
    return "Недостаточно прав: деньгами по заявке распоряжается бухгалтер";
  }
  if (input.noInvoice) {
    return "По этой заявке счёта клиенту нет — платежи по ней не вносятся";
  }
  if (input.status === ORDER_STATUSES.CANCELLED) {
    return "Заявка отменена — деньги по ней не проводятся";
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "Укажите сумму платежа";
  if (amount > 1_000_000_000) return "Слишком большая сумма";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Укажите день, когда пришли деньги";
  if (input.date > input.today) return "День поступления не может быть в будущем";
  if (!PAYMENT_METHODS.includes(input.method as never)) return "Выберите способ оплаты";
  if (input.invoiceFarms.length > 1) {
    if (!input.invoiceFarms.includes(input.farm)) {
      return "В заявке цветок обоих производств — выберите, какой компании пришли деньги";
    }
  } else if (input.farm && !input.invoiceFarms.includes(input.farm)) {
    return "Эта компания в счёте заявки не участвует";
  }
  return "";
}

/**
 * Удалить платёж можно, если внесли его по ошибке.
 *
 * С закрытой заявки деньги не снимают (`moneyRefusal`): если клиент вернул
 * деньги, это рекламация. Но опечатку, внесённую СЕГОДНЯ, исправить нужно и
 * там — иначе ошибка в сумме по отгруженной заявке жила бы вечно. Поэтому
 * платёж, внесённый сегодня, удаляется всегда (кроме отменённой заявки).
 */
export function removePaymentRefusal(input: {
  role: string | null | undefined;
  status: string;
  /** Когда платёж ВНЕСЛИ в программу (не когда пришли деньги), ГГГГ-ММ-ДД. */
  enteredOn: string;
  today: string;
}): string {
  if (!canEditFinance(input.role)) {
    return "Недостаточно прав: деньгами по заявке распоряжается бухгалтер";
  }
  if (input.status === ORDER_STATUSES.CANCELLED) {
    return "Заявка отменена — деньги по ней не трогаем";
  }
  if (input.status === ORDER_STATUSES.SHIPPED && input.enteredOn !== input.today) {
    return (
      "Заявка отгружена, а платёж внесён не сегодня — удалить его нельзя. " +
      "Если клиент вернул деньги, проведите рекламацию."
    );
  }
  return "";
}

/**
 * Итог после платежа: общий и по компаниям.
 *
 * `paidByFarm` — сколько каждая компания уже получила (из `farmPayments`).
 * У смешанной заявки платёж ложится на свою компанию; у обычной — на
 * единственную. Если компаний в счёте нет вовсе (заявка без цены), меняется
 * только общий итог.
 */
export function totalsAfter(
  paidAmount: number,
  paidByFarm: Record<string, number>,
  farm: string,
  delta: number
): { paidAmount: number; byFarm: Record<string, number> } {
  const byFarm = { ...paidByFarm };
  const farms = Object.keys(byFarm);
  const target = farm && farm in byFarm ? farm : farms.length === 1 ? farms[0] : "";
  if (target) byFarm[target] = Math.max(0, round2((byFarm[target] ?? 0) + delta));
  return { paidAmount: Math.max(0, round2((Number(paidAmount) || 0) + delta)), byFarm };
}

/**
 * Вид оплаты заявки по её платежам: один способ — он и есть, разные —
 * «Смешанная». Нет платежей — пусто (тогда остаётся то, что указал менеджер).
 */
export function methodOfPayments(methods: string[]): string {
  const distinct = Array.from(new Set(methods.map((m) => m.trim()).filter(Boolean)));
  if (distinct.length === 0) return "";
  return distinct.length === 1 ? distinct[0] : MIXED_PAYMENT_METHOD;
}

/**
 * Одно поступление, разложенное по способам: 70 000 картой + 50 000 наличными.
 * Каждая часть — отдельный платёж со своим способом; одинаковые способы
 * склеиваются, пустые строки выбрасываются. Отказ — если частей нет или
 * какая-то часть неверна.
 */
export function splitPaymentLines(
  lines: { amount: number; method: string }[]
): { lines: { amount: number; method: string }[]; refusal: string } {
  const byMethod = new Map<string, number>();
  for (const line of lines) {
    const amount = Number(line.amount);
    if (!line.method && (!amount || amount === 0)) continue;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { lines: [], refusal: "У каждой части оплаты должна быть сумма больше нуля" };
    }
    if (!PAYMENT_METHODS.includes(line.method as never)) {
      return { lines: [], refusal: "У каждой части оплаты выберите способ" };
    }
    byMethod.set(line.method, round2((byMethod.get(line.method) ?? 0) + amount));
  }
  if (byMethod.size === 0) return { lines: [], refusal: "Укажите сумму платежа" };
  return {
    lines: Array.from(byMethod.entries()).map(([method, amount]) => ({ method, amount })),
    refusal: "",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
