import { KASPI_METHOD, PAYMENT_METHODS } from "./constants";

/**
 * Порядок клиентов в подборщике заявки и правила Kaspi Pay.
 *
 * Всё чистое и живёт здесь, а не внутри компонентов: это проверяет тест
 * (`scripts/check-clients.ts`), а «удобно выбирать» и «счёт ушёл от той
 * компании» — ровно то, что ломается незаметно.
 */

export interface PickCandidate {
  name: string;
  /** Свой ли клиент у того, кто оформляет заявку. */
  mine: boolean;
  orders: number;
  /** Дней с последнего заказа; -1 — заказов не было. */
  daysSinceLast: number;
}

/**
 * Сортировка: свои перед чужими, недавние перед давними, покупавшие перед
 * теми, кто ещё ничего не брал.
 *
 * Алфавит здесь бесполезен: менеджер девять раз из десяти оформляет заявку
 * старому клиенту, с которым работал на этой неделе, а по алфавиту тот стоял
 * бы где-то в середине трёхсот строк. Внутри равных — по имени, чтобы список
 * не прыгал от случая к случаю.
 */
export function orderForPicker<T extends PickCandidate>(clients: T[]): T[] {
  const rank = (c: PickCandidate) => {
    if (c.orders === 0) return 9999;
    return c.daysSinceLast < 0 ? 9998 : c.daysSinceLast;
  };
  return [...clients].sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "ru");
  });
}

export interface KaspiFieldValues {
  kaspiPay1: string;
  kaspiPay2: string;
}

/**
 * Каспи-номера КЛИЕНТА. Их бывает несколько — платит то с личного, то с
 * магазинного, — поэтому два поля со свободным вводом, а не выбор из списка.
 *
 * Компанию, которая выставляет счёт, тут выбирать не нужно и нельзя: она
 * следует из цветка (роза и эустома — Rose Farm, хризантема — Есентай), и это
 * считается в `src/lib/orderMoney.ts` по самой заявке.
 *
 * Если клиент платит не Каспи, поля стираются: иначе в карточке остались бы
 * реквизиты, по которым платить уже не будут, и бухгалтер сверял бы перевод
 * не с тем.
 */
export function kaspiFieldsFor(method: string, input: Partial<KaspiFieldValues>): KaspiFieldValues {
  const known = (PAYMENT_METHODS as readonly string[]).includes(method) ? method : "";
  if (known !== KASPI_METHOD) {
    return { kaspiPay1: "", kaspiPay2: "" };
  }
  return {
    kaspiPay1: (input.kaspiPay1 ?? "").trim(),
    kaspiPay2: (input.kaspiPay2 ?? "").trim(),
  };
}
