import { cityScopeOf, orderInScope, type ScopeUser } from "../cityScope";
import { getClientById } from "./clients";

/**
 * Заявка не из города менеджера (`cityScope.ts`) — для страниц одной заявки: по прямой ссылке чужая заявка не должна
 * открываться так же, как её нет в списке. У того, кто не посажен в город, всегда «своя».
 */
export async function orderOutOfScope(
  order: { managerEmail?: string | null; store?: string | null; direction?: string | null; clientId?: string | null },
  user: ScopeUser | null | undefined
): Promise<boolean> {
  const scope = cityScopeOf(user);
  if (!scope) return false;
  const client = order.clientId ? await getClientById(order.clientId) : null;
  return !orderInScope(order, scope, user?.email, () => client?.city);
}

/**
 * Общая страница хозяйства, закрытая менеджеру города (`CITY_CLOSED`): уводим в раздел его города. Первым это делает
 * middleware по пропуску, но пропуск обновляется не мгновенно — страница проверяет ещё раз по свежей посадке.
 */
export function cityHomeIfClosed(user: ScopeUser | null | undefined): string | null {
  const scope = cityScopeOf(user);
  return scope ? `/region/${scope}` : null;
}
