/** Вкладки раздела «Офис» — подсклад для продаж после 12:00 (`officeStore.ts`). */
const OFFICE_TABS = [
  { href: "/office", label: "Склад офиса" },
  { href: "/office/ship", label: "Отгрузка" },
  { href: "/office/writeoff", label: "Списание" },
  { href: "/office/moves", label: "Перемещения" },
];

/** РОП смотрит и перемещает, но не отгружает и не списывает — «Списания» у него нет. */
export function officeTabsFor(role: string | null | undefined) {
  return role === "sales_head" ? OFFICE_TABS.filter((t) => t.href !== "/office/writeoff") : OFFICE_TABS;
}
