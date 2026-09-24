/**
 * Вкладки раздела «Клиенты»: список карточек и аналитика за месяц. Месяц
 * переносится в аналитику, если он уже выбран.
 */
export function clientsTabsFor(period?: string) {
  return [
    { href: "/clients", label: "Список" },
    { href: period ? `/clients/analytics?period=${period}` : "/clients/analytics", label: "Аналитика" },
  ];
}
