/**
 * Разделы верхнего меню — один список на две навигации: шапку (компьютер) и
 * нижнюю панель (телефон).
 *
 * Файл отдельный и БЕЗ «use client» намеренно: список нужен обоим клиентским
 * компонентам, и если положить его в один из них, второй потащит из первого
 * значение — ровно те грабли 1.8, на которых проект уже дважды падал.
 *
 * Порядок важен: на телефоне первые четыре пункта попадают в нижнюю панель, а
 * остальные — в шторку «Ещё». Поэтому сверху то, что открывают каждый день.
 */
export interface NavLink {
  href: string;
  label: string;
  /** Короткая подпись для нижней панели: там на пункт ~70 px. */
  short?: string;
  roles?: string[];
}

// В шапке — только разделы, по одному пункту на область работы. Всё, что внутри
// раздела, живёт во вкладках на самой странице (SectionTabs). Иначе у админа
// набегало десять пунктов и меню переставало читаться.
export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Главная" },
  { href: "/orders", label: "Заявки" },
  { href: "/warehouse", label: "Склад", roles: ["warehouse", "admin"] },
  { href: "/sales", label: "Продажи", roles: ["manager", "sales_head", "admin"] },
  { href: "/finance", label: "Оплаты", roles: ["accountant", "admin"] },
  { href: "/plans", label: "Планы", roles: ["sales_head", "admin"] },
  // У администратора прогноз срезки живёт вкладкой внутри «Планов» — иначе
  // верхнее меню снова разрастается до девяти пунктов.
  { href: "/forecast", label: "Прогноз срезки", short: "Срезка", roles: ["agronomist"] },
  { href: "/analytics", label: "Аналитика", short: "Аналит." },
  { href: "/admin", label: "Настройки", short: "Настр.", roles: ["admin"] },
];

export function navLinksFor(role: string): NavLink[] {
  return NAV_LINKS.filter((l) => !l.roles || l.roles.includes(role));
}
