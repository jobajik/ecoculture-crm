import type { SectionTab } from "./sectionViews";
import type { RegionAccess } from "./regionTruck";

/**
 * Вкладки раздела города (`/region/<код>`, 17.11.2026). Чистый модуль без «use client» (грабли 1.8): его читают меню
 * (у директора вкладки — подпунктами его раздела) и сами страницы.
 */
export function regionTabsFor(store: string, access: Pick<RegionAccess, "keeper" | "money">): SectionTab[] {
  const base = `/region/${store}`;
  return [
    { href: base, label: "Остатки" },
    { href: `${base}/truck`, label: "Фура", match: [`${base}/truck`, `${base}/truck/new`] },
    { href: `${base}/ship`, label: "Отгрузка клиентам" },
    ...(access.keeper ? [{ href: `${base}/writeoff`, label: "Списание" }] : []),
    ...(access.money ? [{ href: `${base}/money`, label: "Оплаты и долги" }] : []),
  ];
}
