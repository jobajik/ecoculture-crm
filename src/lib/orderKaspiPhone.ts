import { KASPI_METHOD, MONEY_EPSILON, ORDER_STATUSES, ROLES } from "./constants";
import { canEditFinance } from "./financeAccess";
import { isNotASale } from "./orderKind";
import { canSellToClients } from "./retail";
import { isOpenKaspiStatus, kaspiPhone, prettyKaspiPhone } from "./kaspiInvoice";

/**
 * Номер Kaspi для счёта по заявке меняет менеджер (19.11.2026).
 *
 * Владелец: «сделать возможность для менеджеров изменять/добавлять номер для каспи (для оплаты), потому что часто очень
 * сами клиенты просят на другие номера отправлять». До этого номер жил только в карточке клиента (Каспи №1 и №2, и
 * только когда способ оплаты — «Каспи»), править карточку мог лишь её менеджер, а сам счёт выставляет бухгалтер: на
 * просьбу клиента «отправьте мужу» менеджер звонил Юлии. Решения владельца: неоплаченный счёт, уже выставленный на
 * прежний номер, отменяется и выставляется заново на новый — сам, без бухгалтера.
 *
 * Устройство:
 * - у заявки свой номер для счёта (`Orders.KaspiPhone`); пусто — номера карточки клиента, как раньше. Его первым видят
 *   бухгалтер в панели оплаты и напоминание о долге;
 * - «запомнить в карточке»: новый номер становится «Каспи №1», прежний №1 сдвигается в №2. Карточку трогаем, только
 *   если человек вправе её править и способ оплаты в ней — «Каспи» или не выбран;
 * - счета, которые ЖДУТ оплаты на другом номере, отменяются, и на их сумму выставляется один новый счёт на новый номер
 *   (по каждой компании отдельно). Оплаченные и уже отменяемые не трогаются. Если на новом номере счёт этой компании
 *   уже ждёт оплаты — ничего не перевыставляем: второй счёт на тот же номер клиент оплатил бы дважды.
 *
 * Модуль чистый — проверка `scripts/check-order-kaspi-phone.ts`; запись и ApiPay — `setOrderKaspiPhoneAction`.
 */

export interface KaspiPhoneOrder {
  status: string;
  kind?: string;
  retail?: string;
  direction?: string;
  clientName?: string;
  managerEmail: string;
  totalAmount: number;
  paidAmount: number;
  kaspiPhone?: string;
}

/** Кто и когда может менять номер Kaspi заявки. Пусто — можно. Проверка сервера (грабли 1.11). */
export function kaspiPhoneEditRefusal(input: {
  role: string | null | undefined;
  email: string | null | undefined;
  order: KaspiPhoneOrder;
  /** Менеджер карточки клиента (может отличаться от менеджера заявки). */
  cardManagerEmail?: string | null;
}): string {
  const { role, order } = input;
  const me = (input.email || "").trim().toLowerCase();
  const all = role === ROLES.ADMIN || role === ROLES.SALES_HEAD || canEditFinance(role);
  if (!all && !canSellToClients(role)) return "Номер Kaspi для счёта меняет менеджер заявки, РОП или бухгалтер";
  if (isNotASale(order)) return "У этой заявки нет счёта клиенту";
  if (order.status === ORDER_STATUSES.CANCELLED) return "Заявка отменена";
  if (!all) {
    const mine = !!me && (order.managerEmail.toLowerCase() === me || (input.cardManagerEmail || "").trim().toLowerCase() === me);
    if (!mine) return "Это заявка другого менеджера — номер Kaspi меняет он, РОП или бухгалтер";
  }
  if (order.totalAmount - order.paidAmount <= MONEY_EPSILON) return "Заявка оплачена полностью — номер для счёта уже не нужен";
  return "";
}

export interface KaspiPhoneInvoice {
  invoiceId: string;
  farm: string;
  amount: number;
  phone: string;
  status: string;
}

export interface KaspiPhonePlan {
  /** Номер для заявки: «8701…»; пусто — убрать свой номер заявки (снова номера карточки). */
  phone: string;
  /** Что записать в карточку клиента; null — карточку не трогаем. */
  card: { kaspiPay1: string; kaspiPay2: string; paymentMethod?: string } | null;
  /** Почему карточку не тронули, хотя просили запомнить. */
  cardNote: string;
  /** По компаниям: какие счета отменить и на какую сумму выставить новый. */
  reissue: { farm: string; cancel: string[]; amount: number }[];
  /** Компании, где на новом номере счёт уже ждёт оплаты, — перевыставлять не стали. */
  kept: string[];
}

/**
 * Проверка номера и расчёт. Строка — отказ. `due` — остаток к оплате по компаниям (`kaspiDueAmount`): новый счёт не
 * больше него.
 */
export function planKaspiPhoneChange(input: {
  order: KaspiPhoneOrder;
  /** Как набрал человек; пусто — убрать номер заявки. */
  phone: string;
  remember: boolean;
  client: { kaspiPay1?: string; kaspiPay2?: string; paymentMethod?: string } | null;
  canEditCard: boolean;
  invoices: KaspiPhoneInvoice[];
  due: { farm: string; due: number }[];
}): KaspiPhonePlan | string {
  const raw = String(input.phone ?? "").trim();
  const phone = kaspiPhone(raw);
  if (raw && !phone) return "Нужен мобильный номер Kaspi: 8 7XX XXX XX XX (городской номер Kaspi не примет)";
  const current = kaspiPhone(input.order.kaspiPhone);

  const reissue: KaspiPhonePlan["reissue"] = [];
  const kept: string[] = [];
  if (phone) {
    const farms = Array.from(new Set(input.invoices.map((i) => i.farm)));
    for (const farm of farms) {
      const open = input.invoices.filter((i) => i.farm === farm && isOpenKaspiStatus(i.status));
      // «Отменяется» — уже не наш случай: его отменили раньше, второй раз трогать нечего.
      const movable = open.filter((i) => i.status !== "cancelling" && kaspiPhone(i.phone) !== phone);
      if (movable.length === 0) continue;
      if (open.some((i) => kaspiPhone(i.phone) === phone)) {
        kept.push(farm);
        continue;
      }
      const sum = movable.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const due = input.due.find((d) => d.farm === farm)?.due ?? 0;
      // Остальные ждущие счета этой компании (не трогаем) уже занимают часть остатка.
      const others = open.filter((i) => !movable.includes(i)).reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const amount = Math.max(0, Math.min(Math.round(sum), Math.round(due - others)));
      reissue.push({ farm, cancel: movable.map((i) => i.invoiceId), amount });
    }
  }

  let card: KaspiPhonePlan["card"] = null;
  let cardNote = "";
  if (input.remember && phone) {
    const c = input.client;
    const method = (c?.paymentMethod || "").trim();
    if (!c) cardNote = "у заявки нет карточки клиента — номер записан только в заявку";
    else if (!input.canEditCard) cardNote = "карточку клиента правит его менеджер или РОП — номер записан только в заявку";
    else if (method && method !== KASPI_METHOD) cardNote = `в карточке клиента способ оплаты «${method}» — номер записан только в заявку`;
    else {
      const p1 = kaspiPhone(c.kaspiPay1);
      const p2 = kaspiPhone(c.kaspiPay2);
      if (p1 !== phone) {
        // Новый номер — основной; прежний основной не теряем, он становится вторым.
        const second = p1 ? c.kaspiPay1 || "" : p2 && p2 !== phone ? c.kaspiPay2 || "" : "";
        card = { kaspiPay1: phone, kaspiPay2: second, ...(method ? {} : { paymentMethod: KASPI_METHOD }) };
      }
    }
  }

  if (phone === current && reissue.length === 0 && !card) {
    if (kept.length > 0) return "На этот номер счёт уже выставлен и ждёт оплаты";
    return phone ? (cardNote ? `Этот номер уже указан в заявке; ${cardNote}` : "Этот номер уже указан в заявке") : "У заявки нет своего номера Kaspi — убирать нечего";
  }
  return { phone, card, cardNote, reissue, kept };
}

/** Какой номер получит счёт по заявке: свой номер заявки, иначе Каспи №1, №2, телефон заявки, телефон клиента. */
export function kaspiPhoneOfOrder(order: { kaspiPhone?: string; clientPhone?: string }, client: { kaspiPay1?: string; kaspiPay2?: string; phone?: string } | null): { phone: string; source: "order" | "card" | "phone" | "" } {
  const own = kaspiPhone(order.kaspiPhone);
  if (own) return { phone: own, source: "order" };
  const fromCard = kaspiPhone(client?.kaspiPay1) || kaspiPhone(client?.kaspiPay2);
  if (fromCard) return { phone: fromCard, source: "card" };
  const fromPhone = kaspiPhone(order.clientPhone) || kaspiPhone(client?.phone);
  return fromPhone ? { phone: fromPhone, source: "phone" } : { phone: "", source: "" };
}

export { prettyKaspiPhone };
