/**
 * Дробные числа для показа человеку.
 *
 * По-русски дробная часть отделяется ЗАПЯТОЙ. `toFixed()` всегда ставит точку,
 * и по сайту разошлись оба вида: в аналитике рядом стояли «25.8 %» и «5,6 дн.».
 * Два разных написания одного и того же цепляют глаз и заставляют искать
 * разницу там, где её нет.
 *
 * Поэтому дробное число нигде не собирается руками через `toFixed()` — только
 * здесь. Целое остаётся целым: «7,0 дн.» выглядит как незаконченная правка.
 */

/** Дробное число с запятой: 25.8 → «25,8». Целое — без хвоста: 7 → «7». */
export function decimal(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(digits);
  // «7.0» → «7»: нулевой хвост не несёт смысла и только удлиняет строку.
  const trimmed = fixed.replace(/\.0+$/, "");
  return trimmed.replace(".", ",");
}

/** Процент: 25.8 → «25,8 %». Пробел перед знаком неразрывный. */
export function percent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${decimal(value, digits)} %`;
}

/** Крупные деньги коротко: 1 262 500 → «1,3 млн ₸», 208 000 → «208 тыс ₸». */
export function shortMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${decimal(value / 1_000_000)} млн ₸`;
  if (abs >= 1_000) return `${Math.round(value / 1_000).toLocaleString("ru-RU")} тыс ₸`;
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}
