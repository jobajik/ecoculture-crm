import type { PriceRow } from "./priceList";
import { priceKey } from "./priceList";

/**
 * История изменений прайса: когда, что и на сколько поменяли.
 *
 * Вкладка PriceHistory копит строки, но сама по себе она нечитаема: тысяча
 * строк «дата, цветок, сорт, длина, цена», где непонятно, какие из них были
 * изменением, а какие — просто повтором вчерашней цены. Владелец попросил
 * «запоминать дату изменения прайсов и вести аналитику», поэтому здесь история
 * превращается в список СОБЫТИЙ: в такой-то день такая-то позиция стоила
 * столько, стала стоить столько.
 *
 * Изменением считается только настоящее изменение цены. Если РОП сохранил
 * прайс, не тронув строку, событие не появляется — иначе в истории было бы
 * поровну шума и смысла.
 *
 * Модуль чистый и лежит в lib: его зовёт и страница (сервер), и проверочный
 * скрипт (см. грабли 1.8).
 */

export interface PriceChange {
  date: string;
  flowerType: string;
  /** Пустая строка — цена «на все сорта». */
  variety: string;
  grade: string;
  /** Прежняя цена. null — цену задали впервые. */
  from: number | null;
  to: number;
  /** Насколько изменилась, %. null — сравнивать не с чем. */
  changePercent: number | null;
}

export interface PriceChangeDay {
  date: string;
  changes: PriceChange[];
  /** Сколько позиций подорожало, подешевело, появилось впервые и снято с цены. */
  up: number;
  down: number;
  added: number;
  removed: number;
  /** Среднее изменение по позициям, у которых было с чем сравнивать, %. */
  avgChangePercent: number | null;
}

/**
 * Список изменений по дням, новые сверху.
 *
 * Строки предварительно раскладываются по позициям и сортируются по дате: в
 * таблице они лежат в порядке записи, а не в порядке дат (правку задним числом
 * никто не запрещал).
 */
export function priceChangeDays(rows: PriceRow[]): PriceChangeDay[] {
  const byKey = new Map<string, PriceRow[]>();
  for (const row of rows) {
    if (!row.date || !row.flowerType || !row.grade) continue;
    const key = priceKey(row.flowerType, row.variety, row.grade);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const changes: PriceChange[] = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    let prev: number | null = null;
    for (const row of sorted) {
      if (prev !== null && prev === row.price) continue; // не изменение, а повтор
      changes.push({
        date: row.date,
        flowerType: row.flowerType,
        variety: row.variety,
        grade: row.grade,
        from: prev,
        to: row.price,
        changePercent: prev !== null && prev > 0 ? ((row.price - prev) / prev) * 100 : null,
      });
      prev = row.price;
    }
  }

  const byDate = new Map<string, PriceChange[]>();
  for (const change of changes) {
    const list = byDate.get(change.date) ?? [];
    list.push(change);
    byDate.set(change.date, list);
  }

  return Array.from(byDate.entries())
    .map(([date, list]) => {
      const withBase = list.filter((c) => c.changePercent !== null);
      return {
        date,
        changes: list.sort(
          (a, b) =>
            a.flowerType.localeCompare(b.flowerType, "ru") ||
            a.variety.localeCompare(b.variety, "ru") ||
            a.grade.localeCompare(b.grade, "ru")
        ),
        up: list.filter((c) => c.from !== null && c.to > c.from).length,
        down: list.filter((c) => c.from !== null && c.to > 0 && c.to < c.from).length,
        added: list.filter((c) => c.from === null && c.to > 0).length,
        // Ноль — это «цену сняли», а не «подешевело до нуля».
        removed: list.filter((c) => c.from !== null && c.from > 0 && c.to === 0).length,
        avgChangePercent:
          withBase.length > 0
            ? withBase.reduce((s, c) => s + (c.changePercent ?? 0), 0) / withBase.length
            : null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Сколько дней прайс не трогали. null — не меняли ни разу. */
export function daysSinceLastChange(days: PriceChangeDay[], today: string): number | null {
  const last = days[0]?.date;
  if (!last) return null;
  const from = new Date(`${last}T00:00:00`);
  const to = new Date(`${today}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
}
