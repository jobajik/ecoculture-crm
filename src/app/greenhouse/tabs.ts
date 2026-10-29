import type { GreenhouseScope } from "@/lib/greenhouse/access";

/**
 * Вкладки раздела «Теплица» (29.10.2026, владелец: «выдели это в отдельную вкладку»). Файл без "use client": его
 * читают страницы и меню (грабли 1.8). Компания едет параметром, `match` — адрес без параметра, иначе вкладка не горит.
 */
export const GH_WORK_PATHS = ["/greenhouse/work", "/greenhouse/work/journal", "/greenhouse/work/analytics", "/greenhouse/work/pay"];

export function greenhouseTabsFor(scope: GreenhouseScope | null, farm = ""): { href: string; label: string; match?: string[] }[] {
  if (!scope) return [];
  const q = farm ? `?farm=${farm}` : "";
  const tabs: { href: string; label: string; match?: string[] }[] = [
    { href: `/greenhouse${q}`, label: "Циклы и блоки", match: ["/greenhouse"] },
    { href: `/greenhouse/harvest${q}`, label: "Срезка", match: ["/greenhouse/harvest"] },
    { href: `/greenhouse/cuttings${q}`, label: "Черенкование", match: ["/greenhouse/cuttings"] },
    { href: `/greenhouse/waste${q}`, label: "Брак", match: ["/greenhouse/waste"] },
    { href: `/greenhouse/analytics${q}`, label: "Аналитика", match: ["/greenhouse/analytics"] },
  ];
  // Выработка цветоводов — из модуля зарплаты: у кого там роли нет, вкладки нет.
  if (scope.payroll) tabs.push({ href: `/greenhouse/work${q}`, label: "Выработка", match: GH_WORK_PATHS });
  return tabs;
}
