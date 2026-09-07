import { ROLES } from "@/lib/constants";

/**
 * Вкладки раздела «Планы». Список зависит от роли, потому что вкладка не должна
 * вести туда, куда человека не пустят: РОП не ведёт прогноз срезки, и вкладка
 * «Прогноз срезки» у него просто выкинула бы его на главную.
 *
 * Администратор видит все три — за счёт этого прогноз не занимает отдельный
 * пункт в верхнем меню, которое и так на пределе.
 */
export function plansTabsFor(role: string | null | undefined) {
  const tabs = [
    { href: "/plans", label: "Планы менеджеров" },
    { href: "/plans/shipments", label: "План отгрузок" },
    { href: "/plans/balance", label: "Баланс" },
  ];
  if (role === ROLES.ADMIN) tabs.push({ href: "/forecast", label: "Прогноз срезки" });
  return tabs;
}
