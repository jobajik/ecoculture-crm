/**
 * Вкладки раздела «Клиенты»: список карточек, лиды (кто ещё не покупал) и
 * аналитика за месяц. Месяц переносится в аналитику, если он уже выбран.
 */
export function clientsTabsFor(period?: string) {
  return [
    { href: "/clients", label: "Список" },
    { href: "/clients/leads", label: "Лиды" },
    // Разбор переписки WhatsApp с лидами: оценка менеджеров, возражения, кто ждёт ответа.
    { href: "/clients/leads/talks", label: "Разговоры" },
    { href: period ? `/clients/analytics?period=${period}` : "/clients/analytics", label: "Аналитика" },
  ];
}
