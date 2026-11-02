import { normalizeStore, ASTANA_STORE } from "@/lib/officeStore";

/**
 * Кто открывает «Склад Астана»: менеджер, который его ведёт (по городу профиля — `session.user.store`), РОП, админ и
 * зав. складом (видеть, что ушло фурой). Остальным менеджерам раздел не нужен — «не ваш склад».
 */
export function astanaAccess(role: string | null | undefined, store: string | null | undefined): { view: boolean; keeper: boolean } {
  const keeper = role === "manager" && normalizeStore(store) === ASTANA_STORE;
  return { view: keeper || role === "sales_head" || role === "admin" || role === "warehouse", keeper: keeper || role === "admin" };
}
