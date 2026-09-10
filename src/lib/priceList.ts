/**
 * Прайс-лист: цена стебля по цветку, длине (категории) и, если нужно, сорту.
 *
 * Устройство намеренно двухуровневое. В хозяйстве цена почти всегда зависит от
 * ДЛИНЫ, а не от сорта: роза 60 см стоит столько-то, чей бы куст её ни дал.
 * Поэтому основная строка — «Все сорта»: заполнил её один раз, и весь цветок
 * оценён. И только там, где сорт действительно дороже или дешевле (Red Naomi,
 * пионовидные), ставится отдельная цена, которая перебивает общую.
 *
 * Если бы цену требовали для каждой пары «сорт × длина», их было бы под триста
 * на одну розу, и прайс просто не заполнили бы ни разу.
 *
 * Функции лежат в lib, а не в компоненте: их зовут и страница (сервер), и форма
 * (браузер) — см. CLAUDE.md, грабли 1.8.
 */

/**
 * Прайсов два, и это не удвоение справочника, а два разных договора.
 *
 * Клиентский прайс — то, по чему продают наружу. Внутренний — по какой цене
 * цветок передаётся в НАШ магазин; продажей это не считается, но цену знать
 * надо, иначе не сказать, на сколько тенге ушло в розницу. Ставит оба РОП.
 *
 * Разделение сделано колонкой `Kind`, а не второй вкладкой: механика поиска
 * цены («сорт перебивает „Все сорта“», «берём самую свежую на дату») ровно та
 * же, и разъехаться двум её копиям было бы делом времени.
 */
export const PRICE_KINDS = {
  CLIENT: "",
  RETAIL: "retail",
} as const;
export type PriceKind = (typeof PRICE_KINDS)[keyof typeof PRICE_KINDS];

export const PRICE_KIND_LABELS: Record<string, string> = {
  "": "Прайс для клиентов",
  retail: "Внутренний прайс — наши магазины",
};

/** Пустая ячейка — клиентский прайс. Неизвестное значение тоже: см. грабли 1.10. */
export function cleanPriceKind(value: string | null | undefined): string {
  const clean = (value ?? "").trim().toLowerCase();
  return clean === PRICE_KINDS.RETAIL ? PRICE_KINDS.RETAIL : PRICE_KINDS.CLIENT;
}

/** Значение колонки Variety для строки «на все сорта». */
export const BASE_VARIETY = "";

/** Подпись этой строки в интерфейсе. */
export const BASE_VARIETY_LABEL = "Все сорта";

export interface PriceRow {
  /** Дата, с которой действует цена, «ГГГГ-ММ-ДД». */
  date: string;
  flowerType: string;
  /** Пустая строка — цена на все сорта этого цветка. */
  variety: string;
  grade: string;
  price: number;
  /**
   * Какой это прайс: пусто — клиентский, «retail» — внутренний. Поле
   * необязательное намеренно: отбор по виду делается один раз при чтении
   * (`listPrices`), а всё, что считает цену, о видах прайса знать не должно —
   * иначе одно и то же правило подстановки пришлось бы держать в двух копиях.
   */
  kind?: string;
}

export function priceKey(flowerType: string, variety: string, grade: string): string {
  return `${flowerType}|${variety}|${grade}`;
}

/**
 * Оставляет по каждой позиции самую свежую цену на дату `asOf`.
 * История в таблице копится намеренно: по ней видно, когда и на сколько меняли.
 */
export function currentPrices(rows: PriceRow[], asOf: string): Map<string, PriceRow> {
  const best = new Map<string, PriceRow>();
  for (const row of rows) {
    if (!row.date || row.date > asOf) continue;
    const key = priceKey(row.flowerType, row.variety, row.grade);
    const found = best.get(key);
    if (!found || row.date >= found.date) best.set(key, row);
  }
  return best;
}

/**
 * Цена позиции: сначала ищем цену самого сорта, иначе общую по длине.
 * Ноль означает «цены нет» — менеджер поставит руками, и это видно.
 */
export function priceFor(
  prices: Map<string, PriceRow>,
  flowerType: string,
  variety: string,
  grade: string
): number {
  const own = prices.get(priceKey(flowerType, variety, grade));
  if (own && own.price > 0) return own.price;
  const base = prices.get(priceKey(flowerType, BASE_VARIETY, grade));
  return base?.price ?? 0;
}

/** Плоская карта «ключ → цена» для передачи в браузер: Map через границу не ходит. */
export function priceMapForClient(prices: Map<string, PriceRow>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, row] of prices) out[key] = row.price;
  return out;
}

/** Та же логика подстановки, но по плоской карте — для формы заявки в браузере. */
export function priceFromMap(
  map: Record<string, number>,
  flowerType: string,
  variety: string,
  grade: string
): number {
  const own = map[priceKey(flowerType, variety, grade)];
  if (own && own > 0) return own;
  return map[priceKey(flowerType, BASE_VARIETY, grade)] ?? 0;
}
