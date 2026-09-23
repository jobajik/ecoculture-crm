import { priceKey } from "./priceList";

/** Сорта с одинаковой ценой по всем длинам — одна строка прайса. */
export interface PriceGroup {
  id: string;
  members: string[];
}

/**
 * Раскладывает сорта цветка по ценовым группам: в группе — сорта, у которых
 * цена совпадает по КАЖДОЙ длине (ноль — «своей цены нет» — тоже часть
 * совпадения). Сорта без единой своей цены идут отдельной кучкой: они живут по
 * общей цене «Все сорта». Большие группы первыми, внутри — порядок справочника.
 *
 * Чистая функция: её зовёт экран прайса и проверка `check-price-groups`.
 */
export function groupVarietiesByPrice(
  flowerType: string,
  varieties: readonly string[],
  grades: readonly string[],
  prices: Record<string, number>
): { groups: PriceGroup[]; none: string[] } {
  const byVector = new Map<string, string[]>();
  const none: string[] = [];
  for (const variety of varieties) {
    const vector = grades.map((g) => prices[priceKey(flowerType, variety, g)] ?? 0);
    if (vector.every((p) => !(p > 0))) {
      none.push(variety);
      continue;
    }
    const key = vector.join("/");
    byVector.set(key, [...(byVector.get(key) ?? []), variety]);
  }
  const groups = Array.from(byVector.values())
    .map((members, order) => ({ members, order }))
    .sort((a, b) => b.members.length - a.members.length || a.order - b.order)
    .map(({ members }, i) => ({ id: `g${i}`, members }));
  return { groups, none };
}
