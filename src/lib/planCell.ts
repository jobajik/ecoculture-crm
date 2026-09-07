/**
 * Ключ ячейки плана отгрузок: неделя + направление + цветок.
 *
 * Лежит в `lib`, а не в компоненте, намеренно: функция нужна и странице
 * (сервер), и форме (браузер). Экспорт из файла с «use client» сервер получает
 * как заглушку, и вызов падает с «TypeError: x is not a function».
 * См. CLAUDE.md, грабли 1.8, и проверку `scripts/check-client-imports.ts`.
 */
export function planCellKey(week: string, direction: string, flowerType: string): string {
  return `${week}|${direction}|${flowerType}`;
}
