/**
 * Классы таблиц нового вида (19.10.2026). Лежат в `lib`, а не в клиентском компоненте: их берут и серверные
 * страницы (грабли 1.8). `src/lib` входит в `content` у Tailwind.
 */
/** Строка шапки таблицы внутри карточки. */
export const THEAD_ROW = "text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60";
/** Ячейка шапки. */
export const TH = "px-4 py-2.5 font-medium";
/** Строка тела. */
export const TR = "border-b border-line-hairline last:border-0 hover:bg-surface-plane/60";
