import { FLOWER_TYPES, MONEY_EPSILON, ORDER_STATUSES } from "./constants";
import { toIsoDate } from "./sheetDate";

/**
 * Касса по цветкам: сколько денег пришло за розу, сколько за хризантему.
 *
 * Владелец прислал снимок страницы своей тетради:
 *
 *     касса
 *       хриз.    20 000
 *       роза     30 000
 *
 * и попросил: «А ты можешь оплаты поделить, что от роз, что от хриз. Вот так».
 * Он и правда ведёт это на бумаге — значит вопрос настоящий, а в программе
 * ответа на него не было: «Получено» стояло одним числом.
 *
 * Три решения, от которых здесь всё зависит.
 *
 * **1. Деньги считаются по дню, когда ОНИ ПРИШЛИ, а не когда оформили заявку.**
 * Так решил владелец, и это и есть касса: сегодня в кассу пришло столько-то,
 * неважно, за какую давнюю заявку. Все остальные цифры на странице оплат
 * считаются по дню оформления — это сознательное расхождение, и на странице
 * оно написано словами. Молча смешивать две разные вещи нельзя: сумма кассы за
 * месяц не обязана совпадать с плиткой «Получено», и человек должен понимать,
 * почему.
 *
 * **2. В смешанной заявке деньги делятся ПРОПОРЦИОНАЛЬНО сумме позиций.**
 * Клиент платит одним переводом за розу и хризантему сразу, и другого способа
 * разложить его нет. Тот же приём уже применяется в аналитике по производствам.
 * Делить поровну было бы хуже: заявка «розы на 300 000 и хризантемы на 20 000»
 * дала бы по 160 000 каждому — цифра, которой не было никогда.
 *
 * **3. Эустома — отдельная строка**, а не «в розу». Так решил владелец. По
 * производствам она относится к Rose Farm, но цветок это другой, и в кассе его
 * видно отдельно; сложить розу с эустомой глазами всегда можно, а разделить
 * слипшееся — уже нет.
 *
 * Отдельный случай — **заявка «объём на город»**: цены в позициях у неё нет по
 * замыслу, а поступления бухгалтер вписывает суммой. Делить их по сумме позиций
 * не выйдет — она нулевая, — поэтому такие деньги делятся ПО СТЕБЛЯМ. Это
 * честно: объём там и есть предмет разговора.
 *
 * Функция чистая и покрыта `scripts/check-cash-by-flower.ts`.
 */

export interface CashOrder {
  status: string;
  /** Когда деньги отмечены пришедшими. Пусто — в кассу не попадает. */
  paidAt: string;
  paidAmount: number;
  items: { flowerType: string; quantity: number; unitPrice: number }[];
}

export interface CashRow {
  flowerType: string;
  amount: number;
}

export interface CashByFlower {
  rows: CashRow[];
  total: number;
  /** Деньги, которые не удалось отнести ни к одному цветку (заявка без позиций). */
  unsplit: number;
}

/**
 * Как разложить ОДИН платёж по цветкам.
 *
 * Вынесено отдельно, потому что здесь два разных правила и путать их нельзя:
 * обычная заявка делится по деньгам позиций, городская — по стеблям.
 */
export function splitPaymentByFlower(order: CashOrder): Map<string, number> {
  const out = new Map<string, number>();
  const paid = Number(order.paidAmount) || 0;
  if (paid <= MONEY_EPSILON) return out;

  const weights = new Map<string, number>();
  let total = 0;
  for (const item of order.items) {
    const flower = (item.flowerType || "").trim();
    if (!flower) continue;
    const amount = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
    weights.set(flower, (weights.get(flower) ?? 0) + amount);
    total += amount;
  }

  // Цены нет вовсе — это объём на город. Делим по стеблям: объём там и есть
  // предмет разговора.
  if (total <= MONEY_EPSILON) {
    weights.clear();
    total = 0;
    for (const item of order.items) {
      const flower = (item.flowerType || "").trim();
      if (!flower) continue;
      const stems = Number(item.quantity) || 0;
      weights.set(flower, (weights.get(flower) ?? 0) + stems);
      total += stems;
    }
  }

  if (total <= 0) return out;

  // Раздаём копейки так, чтобы сумма частей была РАВНА платежу: остаток от
  // округления достаётся самой большой доле. Иначе касса не сходилась бы с
  // «Получено» на рубль-другой, и это заметили бы первым.
  const parts = [...weights.entries()].map(([flower, weight]) => ({
    flower,
    exact: (paid * weight) / total,
  }));
  let given = 0;
  for (const part of parts) {
    const rounded = Math.round(part.exact);
    out.set(part.flower, rounded);
    given += rounded;
  }
  const diff = Math.round(paid) - given;
  if (diff !== 0 && parts.length > 0) {
    const biggest = parts.reduce((a, b) => (b.exact > a.exact ? b : a));
    out.set(biggest.flower, (out.get(biggest.flower) ?? 0) + diff);
  }
  return out;
}

/**
 * Касса за период: сколько пришло по каждому цветку.
 *
 * `from` и `to` — дни в виде «ГГГГ-ММ-ДД» включительно.
 */
export function cashByFlower(orders: CashOrder[], from: string, to: string): CashByFlower {
  const sums = new Map<string, number>();
  let unsplit = 0;

  for (const order of orders) {
    // Отменённую заявку в кассу не берём: деньги по ней либо вернули, либо
    // разбирают рекламацией, и показывать их как приход было бы неправдой.
    if (order.status === ORDER_STATUSES.CANCELLED) continue;

    const day = toIsoDate(order.paidAt).slice(0, 10);
    if (!day || day < from || day > to) continue;

    const split = splitPaymentByFlower(order);
    if (split.size === 0) {
      const paid = Number(order.paidAmount) || 0;
      if (paid > MONEY_EPSILON) unsplit += Math.round(paid);
      continue;
    }
    for (const [flower, amount] of split) {
      sums.set(flower, (sums.get(flower) ?? 0) + amount);
    }
  }

  // Порядок строк — привычный порядок цветков, а не «кто сегодня больше»:
  // прыгающие строки заставляют искать нужную заново каждый день.
  const order = Object.values(FLOWER_TYPES) as string[];
  const rows: CashRow[] = order
    .map((flowerType) => ({ flowerType, amount: sums.get(flowerType) ?? 0 }))
    .concat(
      [...sums.keys()]
        .filter((f) => !order.includes(f))
        .sort()
        .map((flowerType) => ({ flowerType, amount: sums.get(flowerType) ?? 0 }))
    );

  const total = rows.reduce((sum, r) => sum + r.amount, 0) + unsplit;
  return { rows, total, unsplit };
}
