import { analyticsTabsFor } from "../analytics/tabs";

/** Вкладки раздела «Продажи» — верхнее меню держим коротким. */
export const SALES_TABS = [
  { href: "/sales", label: "Рейтинг и бонусы" },
  { href: "/sales/plan", label: "План и факт" },
  { href: "/sales/flowers", label: "По цветам" },
  { href: "/sales/day", label: "Продажи за день" },
  { href: "/prices", label: "Прайс-лист" },
];

/**
 * Прайс-лист заводит РОП, поэтому у него и у администратора вкладка живёт в
 * разделе «Планы» и здесь не дублируется: один и тот же пункт в двух разделах
 * заставляет каждый раз вспоминать, где он «настоящий».
 *
 * Менеджеру прайс нужен на просмотр — он по нему продаёт, — и для него вкладка
 * остаётся тут. Остальные вкладки одинаковы у всех.
 */
export function salesTabsFor(role: string | null | undefined): { href: string; label: string; match?: string[] }[] {
  // У владельца и РОПа «Продажи» — часть «Планов и цифр»: вкладки цифр общие (`analyticsTabsFor`), а «План и факт»,
  // «По цветам» и «Продажи за день» лежат в архиве отчётов (12.11.2026).
  if (role === "sales_head" || role === "admin") return analyticsTabsFor(role);
  return SALES_TABS;
}
