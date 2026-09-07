/**
 * Ключи ячеек прогноза срезки.
 *
 * Файл отдельный НЕ случайно. Функции нужны и странице (сервер), и сеткам ввода
 * (браузер). Если держать их в компоненте с «use client», сервер получит не
 * функцию, а заглушку-ссылку на клиентский модуль, и вызов упадёт с
 * «TypeError: x is not a function». Так уже ломалось дважды; см. CLAUDE.md,
 * грабли 1.8, и проверку `scripts/check-client-imports.ts`.
 */

/** Ячейка «сорт × неделя». */
export function forecastCellKey(week: string, flowerType: string, variety: string): string {
  return `${week}|${flowerType}|${variety}`;
}

/** Ячейка ростовки «градация × неделя» — на весь цветок. */
export function mixCellKey(week: string, flowerType: string, grade: string): string {
  return `${week}|${flowerType}|${grade}`;
}
