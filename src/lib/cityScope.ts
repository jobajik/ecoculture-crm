import { ROLES } from "./constants";
import { cleanDirection } from "./direction";
import { isRegionStore, normalizeStore, regionStoreForCity, type StoreCode } from "./officeStore";
import { cityClosedPath } from "./access";

/**
 * «Свой город» — что видит менеджер, посаженный в город (22.11.2026).
 *
 * Владелец: «Каждый регион должен видеть остатки только свои, соответственно продажи, заявки и всё остальное». До этого
 * менеджер города был обычным менеджером с добавочным разделом города: в «Заявках» — клиентские заявки всей компании, в
 * «Клиентах» — вся база, в «Продажах» — рейтинг и выручка всех, в «Сортах и ростовках» — основной склад, офис и чужие
 * города. Его собственный раздел был ограничен городом, а всё остальное — нет.
 *
 * Правило одно на страницы, поиск, API и действия (две копии правила видимости расходятся — грабли 1.1-ter):
 *
 * - **своё** — заявка, карточка или лид, где менеджер — он сам; плюс всё, что относится к его городу: заявка со склада
 *   города, с направлением в город или клиенту из города (то же, что «Оплаты и долги» города — `cityClientOrders`),
 *   карточка клиента из города, ничей лид из города;
 * - **общие страницы хозяйства закрыты** (`CITY_CLOSED` в `access.ts`): аналитика, план и факт, продажи по цветам и за
 *   день, остатки всех складов, аналитика клиентской базы. Свои цифры — в разделе города;
 * - остальных ролей и менеджеров без города правило не касается: пустой город — «не ограничен» только у того, кто не
 *   посажен. Сбой чтения посадки даёт «не посажен», но тогда у человека нет и раздела города, и склада города.
 *
 * Модуль чистый — проверка `scripts/check-city-scope.ts`.
 */

export interface ScopeUser {
  role?: string | null;
  email?: string | null;
  store?: string | null;
}

/** Город, которым ограничен человек; «» — не ограничен. */
export function cityScopeOf(user: ScopeUser | null | undefined): StoreCode {
  if (!user || user.role !== ROLES.MANAGER) return "";
  const store = normalizeStore(user.store);
  return isRegionStore(store) ? store : "";
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Карточка клиента: своя или клиент из этого города. */
export function clientInScope(client: { managerEmail?: string | null; city?: string | null }, scope: StoreCode, email: string | null | undefined): boolean {
  if (!scope) return true;
  return same(client.managerEmail, email) || regionStoreForCity(client.city) === scope;
}

/** Заявка: своя, со склада города, с направлением в город или клиенту из города. */
export function orderInScope(
  order: { managerEmail?: string | null; store?: string | null; direction?: string | null; clientId?: string | null },
  scope: StoreCode,
  email: string | null | undefined,
  cityOfClient: (clientId: string) => string | null | undefined
): boolean {
  if (!scope) return true;
  if (same(order.managerEmail, email)) return true;
  if (normalizeStore(order.store) === scope) return true;
  if (regionStoreForCity(cleanDirection(order.direction ?? "")) === scope) return true;
  return !!order.clientId && regionStoreForCity(cityOfClient(order.clientId)) === scope;
}

/** Лид: свой или ничей из этого города. Чужой и ничей из другого города (или без города) — нет. */
export function leadInScope(lead: { managerEmail?: string | null; city?: string | null }, scope: StoreCode, email: string | null | undefined): boolean {
  if (!scope) return true;
  if (lead.managerEmail) return same(lead.managerEmail, email);
  return regionStoreForCity(lead.city) === scope;
}

/** Закрыта ли страница менеджеру города. */
export function closedForCity(user: ScopeUser | null | undefined, path: string): boolean {
  return cityScopeOf(user) !== "" && cityClosedPath(path);
}

/** «Город клиента по номеру карточки» из списка клиентов — для `orderInScope`. */
export function cityLookup(clients: { clientId: string; city?: string | null }[]): (clientId: string) => string | undefined {
  const map = new Map(clients.map((c) => [c.clientId, c.city ?? ""]));
  return (id) => map.get(id);
}
