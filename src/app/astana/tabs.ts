/** Вкладки раздела «Склад Астана» — региональный склад (`officeStore.ts`, 02.11.2026). */
const ASTANA_TABS = [
  { href: "/astana", label: "Склад Астаны" },
  { href: "/astana/ship", label: "Отгрузка" },
  { href: "/astana/writeoff", label: "Списание" },
];

/** Списывает тот, кто ведёт склад (менеджер Астаны), и админ; РОП и зав. складом только смотрят. */
export function astanaTabsFor(role: string | null | undefined) {
  return role === "manager" || role === "admin" ? ASTANA_TABS : ASTANA_TABS.filter((t) => t.href !== "/astana/writeoff");
}
