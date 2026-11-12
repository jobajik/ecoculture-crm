import { tabOfViews, type SectionTab } from "@/lib/sectionViews";

/**
 * Вкладки раздела «Клиенты». До 12.11.2026 их было одиннадцать, и пять из них — взгляды на одних и тех же лидов.
 * Теперь вкладок до пяти, а взгляды — переключатель вверху страницы (`sectionViews.ts`):
 * «Клиенты» (список / аналитика), «Постоянники», «Лиды» (доска / решения ИИ / с рекламы / обзвон), «Переписки»
 * (чаты / разбор разговоров), «Рассылки». Кому какой вид виден — правила прежние; у кого вид один, у того вкладка
 * называется как этот вид и переключателя нет. Месяц переносится в аналитику, если он уже выбран.
 */
export function clientsTabsFor(period?: string, role?: string | null): SectionTab[] {
  // Маркетолог (12.11.2026): из раздела ему открыты только переписки — на просмотр.
  if (role === "marketer") return [{ href: "/clients/chats", label: "Переписки" }];
  const manage = role === "admin" || role === "sales_head";
  const leadgen = role === "leadgen";
  // Переписки WhatsApp и решения ИИ (16.10.2026): владелец и РОП — по всем номерам, менеджер и Земфира — по своему.
  const chats = manage || role === "manager" || leadgen;
  const leads = tabOfViews("Лиды", [
    { href: "/clients/leads", label: leadgen ? "Лиды" : "Доска лидов" },
    // Решения ИИ: продать сейчас, написать позже, отказ (15.10.2026).
    chats && { href: "/clients/leads/decide", label: "Решения ИИ" },
    (manage || leadgen) && { href: "/clients/leads/ads", label: "С рекламы" },
    // Обзвон базы: менеджер звонит по очереди и ставит итог одним нажатием, РОП видит итоги.
    !leadgen && { href: "/clients/leads/calls", label: "Обзвон" },
  ]).map((t) => (t.views ? t : { ...t, label: "Лиды" }));
  const talk = tabOfViews("Переписки", [
    chats && { href: "/clients/chats", label: "Чаты" },
    // Разбор переписки WhatsApp с лидами: оценка менеджеров, возражения, кто ждёт ответа.
    !leadgen && { href: "/clients/leads/talks", label: "Разбор разговоров" },
  ]).map((t) => (t.views ? t : { ...t, label: t.href === "/clients/chats" ? "Переписки" : "Разговоры" }));
  // Земфира: свои лиды, итог по ним и переписка — больше ей в разделе ничего не нужно.
  if (leadgen) return [...leads, ...talk];
  return [
    ...tabOfViews("Клиенты", [
      { href: "/clients", label: "Список" },
      { href: period ? `/clients/analytics?period=${period}` : "/clients/analytics", label: "Аналитика" },
    ]),
    // Постоянники (09.11.2026): кто заказывает регулярно и как идут напоминания от имени менеджеров; менеджер — своих.
    ...(manage || role === "manager" ? [{ href: "/clients/habits", label: "Постоянники", match: ["/clients/habits"] }] : []),
    ...leads,
    ...talk,
    // Рассылки WhatsApp запускают только админ и РОП — остальным вкладка ни к чему.
    ...(manage ? [{ href: "/clients/broadcasts", label: "Рассылки" }] : []),
  ];
}
