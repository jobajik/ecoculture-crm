/**
 * Что обнулить при загрузке нового файла прогноза.
 *
 * Агроном перезагружает файл целиком каждый раз, когда прогноз поменялся.
 * Значит загрузка — это ЗАМЕНА месяца, а не дописывание: позиция, которой в
 * новом файле нет, должна исчезнуть. Иначе прошлая цифра «прилипает» и потом
 * всплывает в балансе как урожай, которого никто не обещал.
 *
 * Заменяются только те цветки, чьи листы есть в файле: агроном может загрузить
 * файл с одними розами, и хризантему это трогать не должно.
 *
 * Функция чистая — её проверяет `check-forecast-excel`, не трогая таблицу.
 */

export interface ExistingRow {
  period: string;
  flowerType: string;
  /** Сорт или градация — что именно, зависит от таблицы. */
  key: string;
  targetStems: number;
}

export interface LoadedRow {
  period: string;
  flowerType: string;
  key: string;
}

export function rowsToZero(
  existing: ExistingRow[],
  loaded: LoadedRow[],
  /** Недели месяца, который заменяем. */
  weekCodes: string[]
): ExistingRow[] {
  // Цветки, которые вообще были в файле: только их и заменяем.
  const touchedFlowers = new Set(loaded.map((r) => r.flowerType));
  const loadedKeys = new Set(loaded.map((r) => `${r.period}|${r.flowerType}|${r.key}`));

  return existing.filter((row) => {
    if (!weekCodes.includes(row.period)) return false;
    if (!touchedFlowers.has(row.flowerType)) return false;
    if (row.targetStems === 0) return false; // уже ноль — писать нечего
    return !loadedKeys.has(`${row.period}|${row.flowerType}|${row.key}`);
  });
}
