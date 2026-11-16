import { ORDER_STATUSES } from "./constants";
import { OPEN_STATUSES, prettyKaspiPhone } from "./kaspiInvoice";
import { phoneKey } from "./leads";
import { isNotASale } from "./orderKind";
import { orderCode } from "./paymentStage";
import type { KaspiInvoice, OrderWithItems } from "./types";

/**
 * Что бот должен знать о НЕОПЛАЧЕННЫХ заявках клиента, которые оформил менеджер (16.11.2026).
 *
 * Случай: бухгалтер отправила клиентке с основного номера напоминание об оплате заявки №B5UTR (60 000 ₸, оформил
 * Ильгар), клиентка ответила голосом «не оплатила, давайте сегодня счёт выставляйте, на этот же номер». Бот основного
 * номера не знал ни о напоминании (оно ушло через API и в память бота не попадает), ни о заявке (на основном номере он
 * видел только СВОИ заказы) — и принял ответ за согласие на свою рассылку недельной давности: «выставляю счёт на 200 шт.
 * Altaj, четвёртая категория, 36 000 ₸». Счёта он при этом не выставлял, а открытый счёт на 60 000 ₸ уже ждал оплаты.
 *
 * Отсюда три вещи: строки о таких заявках в «О клиенте» (`debtContextLines`), наши же сообщения с этого номера в
 * памяти (`botTurn.ts`: `missingOutgoing`) и запрет обещать счёт, которого бот в этом ответе не выставляет
 * (`claimsInvoiceNow`). Модуль чистый — проверка `check-bot-debt`.
 */

const DAY_MS = 86400000;
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/ | /g, " ")} ₸`;

/** «15.11 в 21:52» по Алматы. */
export function almatyMoment(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 5 * 3600000).toISOString();
  return `${d.slice(8, 10)}.${d.slice(5, 7)} в ${d.slice(11, 16)}`;
}

function invoiceState(invoices: KaspiInvoice[], orderId: string): string {
  const own = invoices.filter((i) => i.orderId === orderId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const open = own.find((i) => OPEN_STATUSES.includes(i.status));
  if (open) return `счёт Kaspi на ${money(open.amount)} выставлен ${almatyMoment(open.createdAt)} на номер ${prettyKaspiPhone(open.phone)} и ЖДЁТ ОПЛАТЫ`;
  const last = own[0];
  if (!last) return "счёт Kaspi ещё не выставлялся";
  if (last.status === "expired") return `счёт Kaspi от ${almatyMoment(last.createdAt)} истёк, нового нет`;
  if (last.status === "error") return "счёт Kaspi до клиента не дошёл";
  if (last.status === "cancelled") return "прошлый счёт Kaspi отменён, нового нет";
  return `последний счёт Kaspi от ${almatyMoment(last.createdAt)} (${last.status}), открытого счёта нет`;
}

export interface DebtContextInput {
  orders: OrderWithItems[];
  invoices: KaspiInvoice[];
  /** Журнал напоминаний об оплате: когда и по каким заявкам. */
  reminders: { sentAt: string; orderIds: string[]; phone: string }[];
  clientId: string;
  phone: string;
  now: Date;
  /** Имя менеджера по почте («Ильгар»); не нашли — «менеджер». */
  managerName: (email: string) => string;
  /** Заказы, которые оформил сам бот или помощник этого номера, — о них он знает из своего блока. */
  own?: Set<string>;
}

/** Неоплаченные заявки клиента, оформленные менеджерами: не отменённые, не «не продажа», за 60 дней. */
export function unpaidManagerOrders(input: DebtContextInput): OrderWithItems[] {
  const key = phoneKey(input.phone);
  return input.orders
    .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && !(input.own?.has(o.orderId)))
    .filter((o) => (input.clientId && o.clientId === input.clientId) || (key && phoneKey(o.clientPhone) === key))
    .filter((o) => o.totalAmount - Math.min(o.paidAmount, o.totalAmount) >= 1)
    .filter((o) => input.now.getTime() - (Date.parse(o.createdAt) || 0) < 60 * DAY_MS)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 4);
}

/** Строки для подсказки модели. Пусто — неоплаченных заявок менеджеров нет. */
export function debtContextLines(input: DebtContextInput): string[] {
  const unpaid = unpaidManagerOrders(input);
  if (unpaid.length === 0) return [];
  const lines = ["Неоплаченные заявки клиента (их оформил МЕНЕДЖЕР, не ты):"];
  for (const o of unpaid) {
    const items = o.items.map((i) => `${i.variety} ${i.grade} ${i.quantity} шт. по ${money(i.unitPrice)}`).join(", ");
    const left = o.totalAmount - Math.min(o.paidAmount, o.totalAmount);
    lines.push(
      `• №${orderCode(o.orderId)} от ${almatyMoment(o.createdAt).slice(0, 5)}, менеджер ${input.managerName(o.managerEmail)}: ${items} — ${money(o.totalAmount)}, ` +
        `не оплачено ${money(left)}, доставка ${o.deliveryDate.slice(8, 10)}.${o.deliveryDate.slice(5, 7)}; ${invoiceState(input.invoices, o.orderId)}.`
    );
  }
  const ids = new Set(unpaid.map((o) => o.orderId));
  const key = phoneKey(input.phone);
  const reminder = input.reminders
    .filter((r) => phoneKey(r.phone) === key && r.orderIds.some((id) => ids.has(id)) && input.now.getTime() - (Date.parse(r.sentAt) || 0) < 3 * DAY_MS)
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))[0];
  if (reminder) lines.push(`С ЭТОГО номера клиенту ${almatyMoment(reminder.sentAt)} ушло напоминание об оплате этих заявок — клиент может отвечать именно на него.`);
  lines.push(
    "Клиент отвечает на напоминание, говорит об оплате или просит счёт по такой заявке — это НЕ новый заказ: товар не предлагай, другой состав и сумму " +
      "не называй, фото не шли. Счёт ждёт оплаты — скажи, что счёт на эту сумму по заказу №… уже выставлен (когда и на какой номер) и попроси проверить Kaspi. " +
      "Открытого счёта нет, клиент не видит счёт или просит другой номер — ответь, что передаёшь менеджеру (назови его по имени), и поставь alert " +
      "«клиент просит счёт Kaspi по заявке №… на сумму … на номер …» с тем, что он обещал об оплате. Сам такой счёт ты не выставляешь — " +
      "не пиши «выставляю», «сейчас придёт». Поменять что-то в такой заявке просит клиент — тоже alert менеджеру."
  );
  return lines;
}

/**
 * Обещает ли текст счёт ПРЯМО СЕЙЧАС: «выставляю счёт», «сейчас выставлю», «счёт сейчас придёт». Правдивое «счёт уже
 * выставлен вчера и ждёт оплаты» сюда не попадает. Если при этом ход ничего не оформляет — это обещание без действия.
 */
export function claimsInvoiceNow(text: string): boolean {
  const t = (text || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  return (
    /(выставля(ю|ем)|выставлю|выставим|отправля(ю|ем)|отправлю|отправим|высыла(ю|ем)|вышлю|вышлем|скину|кидаю)\s+(вам\s+|сейчас\s+|сегодня\s+|новый\s+)*счет/.test(t) ||
    /счет\s+(kaspi\s+|каспи\s+)?(вам\s+)?(сейчас\s+|скоро\s+|сегодня\s+)?(придет|прилетит|поступит)/.test(t) ||
    /счет\s+(kaspi\s+|каспи\s+)?(сейчас|сегодня)\s+(выставлю|выставим|отправлю|отправим)/.test(t)
  );
}

/** Задание модели на переспрос, когда она пообещала счёт, которого в этом ответе не выставляет. */
export const INVOICE_CLAIM_TASK =
  "В прошлом ответе ты пообещал выставить или прислать счёт, но в этом ответе ты ничего не оформляешь — такое обещание клиенту не уйдёт. " +
  "Перепиши ответ без него. Если клиент просит счёт по заявке, которую оформил менеджер: открытый счёт уже есть — назови его (сумма, когда, на какой номер); " +
  "нет — скажи, что передаёшь менеджеру, и поставь alert с номером заявки, суммой и номером Kaspi.";
