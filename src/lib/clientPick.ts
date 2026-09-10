import {
  FARM_LABELS,
  KASPI_FIELD_BY_FARM,
  KASPI_METHOD,
  PAYMENT_METHODS,
  getFarmFor,
} from "./constants";

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
  kaspiRoseFarm: string;
  kaspiEsentai: string;
  kaspiClient: string;
}

/**
 * Каспи-поля имеют смысл только при оплате Каспи.
 *
 * Если способ другой, они стираются: иначе в карточке остались бы реквизиты,
 * по которым платить уже не будут, и бухгалтер сверял бы перевод не с тем.
 */
export function kaspiFieldsFor(method: string, input: Partial<KaspiFieldValues>): KaspiFieldValues {
  const known = (PAYMENT_METHODS as readonly string[]).includes(method) ? method : "";
  if (known !== KASPI_METHOD) {
    return { kaspiRoseFarm: "", kaspiEsentai: "", kaspiClient: "" };
  }
  return {
    kaspiRoseFarm: (input.kaspiRoseFarm ?? "").trim(),
    kaspiEsentai: (input.kaspiEsentai ?? "").trim(),
    kaspiClient: (input.kaspiClient ?? "").trim(),
  };
}

export interface KaspiTarget {
  farm: string;
  farmLabel: string;
  /** Куда платить. Пустая строка — реквизит в карточке не заполнен. */
  account: string;
}

/**
 * На какой Kaspi Pay выставлять счёт по этой заявке.
 *
 * Компанию НЕ выбирают руками: она однозначно следует из цветка — роза и
 * эустома идут от Rose Farm, хризантема от Есентай Агро Хим. В смешанной
 * заявке счетов два, и это нормально: клиент платит двумя переводами, по
 * одному каждому ТОО. Раньше это выбиралось галочкой «1 или 2», и в смешанной
 * заявке любой выбор был наполовину неверным.
 *
 * Порядок — как в заявке: сначала тот цветок, что стоит первой позицией, чтобы
 * бухгалтер читал сверху вниз и не сверялся с порядком компаний в коде.
 */
export function kaspiTargetsFor(
  client: Partial<KaspiFieldValues> & { paymentMethod?: string },
  flowerTypes: string[]
): KaspiTarget[] {
  if ((client.paymentMethod ?? "") !== KASPI_METHOD) return [];

  const seen: string[] = [];
  for (const flowerType of flowerTypes) {
    const farm = getFarmFor(flowerType);
    if (farm && !seen.includes(farm)) seen.push(farm);
  }

  return seen.map((farm) => {
    const key = KASPI_FIELD_BY_FARM[farm];
    return {
      farm,
      farmLabel: FARM_LABELS[farm] ?? farm,
      account: key ? ((client[key] ?? "") as string).trim() : "",
    };
  });
}
