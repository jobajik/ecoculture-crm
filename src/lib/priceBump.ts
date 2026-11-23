import { BASE_VARIETY, priceKey, type PriceRow } from "./priceList";

/**
 * Поднять (или опустить) прайс разом на сумму — «роза +10 ₸ на все виды и ростовки, эустома Стандарт +100 ₸»
 * (23.11.2026, владелец). В прайсе цена лежит строками «цветок · сорт · длина»: общая «Все сорта» и отдельные цены
 * сортов, которые её перебивают. Двигаются ОБЕ: поднять только общую — сорта со своей ценой останутся на старой.
 *
 * Правила: трогаем только строки с ценой (ноль — «цены нет», прибавка сделала бы из пустоты цену 10 ₸); взятые у
 * другого цветка (`borrowedFrom`) не пишем — они сдвинутся сами вместе с источником или не должны сдвигаться вовсе;
 * цена не может стать нулём или минусом. Модуль чистый — проверка `scripts/check-price-bump.ts`.
 */
export interface BumpRule {
  flowerType: string;
  /** Пусто — все длины и категории этого цветка. */
  grade?: string;
  /** На сколько тенге изменить цену стебля (минус — опустить). */
  delta: number;
}

export interface BumpLine {
  flowerType: string;
  variety: string;
  grade: string;
  before: number;
  after: number;
}

export function planPriceBump(prices: Map<string, PriceRow>, rules: BumpRule[]): { lines: BumpLine[]; empty: BumpRule[] } | string {
  const lines = new Map<string, BumpLine>();
  const empty: BumpRule[] = [];
  for (const rule of rules) {
    const delta = Number(rule.delta);
    if (!rule.flowerType || !Number.isFinite(delta) || delta === 0) return "В правиле нужен цветок и сумма, отличная от нуля";
    let hit = 0;
    for (const row of prices.values()) {
      if (row.flowerType !== rule.flowerType || row.borrowedFrom || !(row.price > 0)) continue;
      if (rule.grade && row.grade !== rule.grade) continue;
      const key = priceKey(row.flowerType, row.variety, row.grade);
      if (lines.has(key)) return `Позиция «${row.variety || "Все сорта"} · ${row.grade}» попала в два правила — уберите пересечение`;
      const after = Math.round((row.price + delta) * 100) / 100;
      if (!(after > 0)) return `«${row.variety || "Все сорта"} · ${row.grade}»: цена ${row.price} ₸ после изменения на ${delta} ₸ стала бы не больше нуля`;
      lines.set(key, { flowerType: row.flowerType, variety: row.variety, grade: row.grade, before: row.price, after });
      hit++;
    }
    if (hit === 0) empty.push(rule);
  }
  const list = Array.from(lines.values()).sort(
    (a, b) => a.flowerType.localeCompare(b.flowerType) || Number(a.variety !== BASE_VARIETY) - Number(b.variety !== BASE_VARIETY) || a.variety.localeCompare(b.variety, "ru") || a.grade.localeCompare(b.grade, "ru", { numeric: true })
  );
  return { lines: list, empty };
}
