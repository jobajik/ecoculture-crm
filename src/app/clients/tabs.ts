/**
 * Вкладки раздела «Клиенты»: список карточек, лиды (кто ещё не покупал) и
 * аналитика за месяц. Месяц переносится в аналитику, если он уже выбран.
 */
export function clientsTabsFor(period?: string, role?: string | null) {
  // Земфира: свои лиды и итог по ним — больше ей в разделе ничего не нужно.
  if (role === "leadgen") {
    return [
      { href: "/clients/leads", label: "Лиды" },
      // Решения ИИ по её лидам: продать сейчас, написать позже, отказ (15.10.2026).
      { href: "/clients/leads/decide", label: "Решения ИИ" },
      { href: "/clients/chats", label: "Переписки" },
      { href: "/clients/leads/ads", label: "С рекламы" },
    ];
  }
  const manage = role === "admin" || role === "sales_head";
  const ads = manage ? [{ href: "/clients/leads/ads", label: "С рекламы" }] : [];
  // Переписки WhatsApp и решения ИИ (16.10.2026): владелец и РОП — по всем номерам, менеджер — по своему.
  const ai =
    manage || role === "manager"
      ? [
          { href: "/clients/chats", label: "Переписки" },
          { href: "/clients/leads/decide", label: "Решения ИИ" },
        ]
      : [];
  // Рассылки WhatsApp запускают только админ и РОП — остальным вкладка ни к чему.
  const broadcasts = role === "admin" || role === "sales_head" ? [{ href: "/clients/broadcasts", label: "Рассылки" }] : [];
  return [
    { href: "/clients", label: "Список" },
    { href: "/clients/leads", label: "Лиды" },
    ...ai,
    ...ads,
    // Обзвон базы: менеджер звонит по очереди и ставит итог одним нажатием, РОП видит итоги.
    { href: "/clients/leads/calls", label: "Обзвон" },
    // Разбор переписки WhatsApp с лидами: оценка менеджеров, возражения, кто ждёт ответа.
    { href: "/clients/leads/talks", label: "Разговоры" },
    ...broadcasts,
    { href: period ? `/clients/analytics?period=${period}` : "/clients/analytics", label: "Аналитика" },
  ];
}
