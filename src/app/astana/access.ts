import { normalizeStore, ASTANA_STORE } from "@/lib/officeStore";

/**
 * С 17.11.2026 НЕ ИСПОЛЬЗУЕТСЯ: «Склад Астаны» стал одним из городов раздела «Регионы», права — `regionAccess`
 * (`src/lib/regionTruck.ts`). Файл оставлен до уборки, страницы `/astana…` только переадресуют.
 *
 * Кто открывает «Склад Астана»: менеджер, который его ведёт (по городу профиля — `session.user.store`), РОП, админ и
 * зав. складом (видеть, что ушло фурой). Остальным менеджерам раздел не нужен — «не ваш склад».
 */
export function astanaAccess(role: string | null | undefined, store: string | null | undefined): { view: boolean; keeper: boolean } {
  const keeper = role === "manager" && normalizeStore(store) === ASTANA_STORE;
  return { view: keeper || role === "sales_head" || role === "admin" || role === "warehouse", keeper: keeper || role === "admin" };
}
