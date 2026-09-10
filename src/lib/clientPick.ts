import { KASPI_ACCOUNTS, KASPI_METHOD, PAYMENT_METHODS } from "./constants";

/**
 * Порядок клиентов в подборщике заявки и правила каспи-реквизитов.
 *
 * Обе вещи чистые и живут здесь, а не внутри компонента: их проверяет тест
 * (`scripts/check-clients.ts`), а «удобно выбирать» и «в карточке не остаётся
 * мусор» — ровно то, что ломается незаметно.
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
  kaspiAccount: string;
  kaspiPhone1: string;
  kaspiPhone2: string;
}

/**
 * Каспи-реквизиты имеют смысл только при оплате Каспи.
 *
 * Если способ другой, они стираются: иначе в карточке остались бы номера, по
 * которым платить уже не будут, и бухгалтер сверял бы перевод не с тем. Номер
 * нашего счёта дополнительно проверяется по закрытому списку — выдуманное «3»
 * означало бы компанию, которой нет.
 */
export function kaspiFieldsFor(method: string, input: Partial<KaspiFieldValues>): KaspiFieldValues {
  const known = (PAYMENT_METHODS as readonly string[]).includes(method) ? method : "";
  if (known !== KASPI_METHOD) {
    return { kaspiAccount: "", kaspiPhone1: "", kaspiPhone2: "" };
  }
  const account = (input.kaspiAccount ?? "").trim();
  return {
    kaspiAccount: (KASPI_ACCOUNTS as readonly string[]).includes(account) ? account : "",
    kaspiPhone1: (input.kaspiPhone1 ?? "").trim(),
    kaspiPhone2: (input.kaspiPhone2 ?? "").trim(),
  };
}
