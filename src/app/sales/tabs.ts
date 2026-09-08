/** Вкладки раздела «Продажи» — верхнее меню держим коротким. */
export const SALES_TABS = [
  { href: "/sales", label: "Рейтинг и бонусы" },
  { href: "/sales/plan", label: "План и факт" },
  { href: "/sales/day", label: "Продажи за день" },
  { href: "/prices", label: "Прайс-лист" },
];

/**
 * Прайс видят все, кто работает с продажами; бухгалтеру он тоже не помешает,
 * но рейтинг и бонусы ему не нужны — поэтому список зависит от роли.
 */
export function salesTabsFor(role: string) {
  if (role === "sales_head") {
    return SALES_TABS.filter((t) => t.href !== "/sales/day");
  }
  return SALES_TABS;
}
