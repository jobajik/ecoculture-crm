import { MONEY_EPSILON, ROLES } from "./constants";
import { hasNoClientInvoice, isRegionOrder } from "./orderKind";

/**
 * Стадия оплаты заявки — и короткий номер, по которому её ищут.
 *
 * Раньше у заявки было два состояния: «не оплачено» и «оплачено». Но «не
 * оплачено» отвечало сразу на ДВА разных вопроса — счёт ещё не выставили или
 * клиент тянет с деньгами, — а бухгалтер видела одну и ту же серую строку.
 * Разговор с клиентом в этих случаях противоположный: в первом звонить некуда,
 * во втором пора напоминать. Владелец попросил развести их.
 *
 * Стадий четыре, и они идут только вперёд:
 *
 *   счёт не отправлен → счёт отправлен → оплачено частично → оплачено
 *
 * Стадия НЕ ХРАНИТСЯ отдельным полем, а считается из двух: отметки об отправке
 * счёта и полученной суммы. Хранить её третьим числом значило бы завести ещё
 * одно поле об одном и том же — так уже решено с флагом «оплачено», который
 * считается из суммы, и с итогом плана, который складывается из цветков.
 *
 * Поэтому же «оплачено» перебивает «счёт отправлен»: деньги пришли — вопрос,
 * отправляли ли счёт, уже неважен, а бухгалтер, забывшая поставить отметку, не
 * должна из-за этого видеть оплаченную заявку как неоформленную.
 */

export const PAYMENT_STAGES = {
  /** Счёт клиенту ещё не отправляли. */
  NEW: "new",
  /** Счёт отправлен, денег пока нет. */
  INVOICED: "invoiced",
  /** Пришла часть суммы. */
  PARTIAL: "partial",
  /** Пришло всё. */
  PAID: "paid",
} as const;

export type PaymentStage = (typeof PAYMENT_STAGES)[keyof typeof PAYMENT_STAGES];

export interface StageInput {
  totalAmount: number;
  paidAmount: number;
  /** Когда счёт отправили клиенту. Пусто — не отправляли. */
  invoiceSentAt?: string;
}

export function paymentStage(order: StageInput): PaymentStage {
  const total = Number(order.totalAmount) || 0;
  const paid = Number(order.paidAmount) || 0;
  // Допуск в тенге — из-за округления при пересчёте заявки. Без него заявка
  // навсегда осталась бы «оплаченной частично» из-за копейки.
  if (paid > MONEY_EPSILON && paid >= total - MONEY_EPSILON) return PAYMENT_STAGES.PAID;
  if (paid > MONEY_EPSILON) return PAYMENT_STAGES.PARTIAL;
  if (String(order.invoiceSentAt ?? "").trim()) return PAYMENT_STAGES.INVOICED;
  return PAYMENT_STAGES.NEW;
}

export const STAGE_LABELS: Record<PaymentStage, string> = {
  new: "Счёт не отправлен",
  invoiced: "Счёт отправлен",
  partial: "Оплачено частично",
  paid: "Оплачено",
};

/** Короткая подпись для узкой колонки. */
export const STAGE_SHORT: Record<PaymentStage, string> = {
  new: "счёт не отправлен",
  invoiced: "счёт у клиента",
  partial: "часть денег",
  paid: "оплачено",
};

/** Что это значит и что делать — словами, а не цветом. */
export const STAGE_HINTS: Record<PaymentStage, string> = {
  // Колонка появилась в сентябре: у заявок, заведённых раньше, она пуста, и
  // «не отправлен» там значит «отметку не ставили». Поэтому в пояснении сказано
  // и то, и другое — утверждать за человека то, чего мы не знаем, нельзя.
  new: "Счёт клиенту ещё не отправляли или не поставили отметку — напоминать пока не о чем",
  invoiced: "Счёт у клиента, деньги не пришли",
  partial: "Пришла часть суммы, остаток ждём",
  paid: "Деньги получены полностью",
};

/** Цветовой тон стадии. Ровно четыре, как и стадий. */
export const STAGE_TONES: Record<PaymentStage, "muted" | "warning" | "partial" | "good"> = {
  new: "muted",
  invoiced: "warning",
  partial: "partial",
  paid: "good",
};

/**
 * Можно ли отметить (или снять) отправку счёта.
 *
 * Отмечает ТОЛЬКО бухгалтер — так решил владелец: счета выставляет и отправляет
 * она, и одна дверь к одной записи надёжнее двух. Менеджер, отметивший счёт «за
 * неё», означал бы, что спросить за неотправленный счёт не с кого.
 */
export function invoiceSentRefusal(input: {
  role: string | null | undefined;
  order: { status: string; retail?: string; kind?: string };
  cancelledStatus: string;
}): string {
  const { role, order, cancelledStatus } = input;
  if (role !== ROLES.ACCOUNTANT && role !== ROLES.ADMIN) {
    return "Отметку о счёте ставит бухгалтер";
  }
  if (order.status === cancelledStatus) return "Заявка отменена — счёт по ней не выставляют";
  // Счёта нет у двух видов заявок, и говорить о них надо разными словами.
  if (hasNoClientInvoice(order)) {
    return isRegionOrder(order)
      ? "Это объём на город: клиента нет, и счёт выставлять некому"
      : "Это заявка в наш магазин — счёт своему магазину не выставляют";
  }
  return "";
}

/**
 * Короткий номер заявки — последние пять знаков.
 *
 * Полный номер вида «ORD-1757924831» глазом не читается и голосом не
 * передаётся, а бухгалтеру нужно именно это: найти заявку, которую назвали по
 * телефону, и увидеть её оплаты. Берём хвост — он и различает заявки: номер
 * растёт со временем, и совпасть последние пять знаков могут только у заявок,
 * заведённых в одну и ту же долю секунды.
 */
export function orderCode(orderId: string | null | undefined): string {
  const raw = String(orderId ?? "").trim();
  if (!raw) return "";
  // Приставка «ORD-» одинакова у всех — в коротком номере от неё нет пользы.
  const tail = raw.includes("-") ? raw.slice(raw.lastIndexOf("-") + 1) : raw;
  const body = tail || raw;
  return body.slice(-5).toUpperCase();
}

/**
 * Подходит ли строка под поиск.
 *
 * Ищем по клиенту, менеджеру и короткому номеру сразу: бухгалтер не должна
 * выбирать, в каком поле искать, — она просто набирает то, что знает. Из
 * запроса убираются пробелы и дефисы, чтобы «24 831» и «24-831» находили ту же
 * заявку, что и «24831».
 */
export function matchesOrderSearch(
  row: { orderId: string; clientName: string; managerName: string },
  query: string
): boolean {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  if (row.clientName.toLowerCase().includes(q)) return true;
  if (row.managerName.toLowerCase().includes(q)) return true;

  const digits = q.replace(/[\s-]/g, "");
  if (!digits) return false;
  if (orderCode(row.orderId).toLowerCase().includes(digits)) return true;
  return row.orderId.toLowerCase().replace(/[\s-]/g, "").includes(digits);
}
