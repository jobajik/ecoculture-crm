import { ROLES } from "./constants";
import { priceFromMap } from "./priceList";
import { canSellToClients, isOwnClientOrder, isRetailOrder, isRetailRole, retailTerritoryFor } from "./retail";
import { isRegionOrder } from "./orderKind";

/**
 * «Повторить заявку» и «+ Заявка» с карточки клиента: кто может и куда ведёт.
 * Чистые функции — их зовут и сервер, и страницы (грабли 1.8).
 */

/** Может ли человек оформить заявку клиенту (обычную, со счётом). */
export function canCreateClientOrder(role: string | null | undefined): boolean {
  return canSellToClients(role) || role === ROLES.ADMIN;
}

/** Адрес формы новой заявки клиенту; у розницы — с `sale=1`, иначе откроется форма магазина. */
export function newClientOrderHref(
  role: string | null | undefined,
  clientId: string,
  fromOrderId?: string
): string {
  const params = new URLSearchParams({ client: clientId });
  if (fromOrderId) params.set("from", fromOrderId);
  if (isRetailRole(role)) params.set("sale", "1");
  return `/orders/new?${params.toString()}`;
}

/** Клиентская заявка (не магазин и не объём на город). */
export function isClientOrder(order: { clientId?: string; retail?: string | null; kind?: string; direction?: string }): boolean {
  return Boolean((order.clientId || "").trim()) && !isRetailOrder(order) && !isRegionOrder(order);
}

/**
 * Видна ли заявка человеку как образец для повтора — то же правило, что у
 * списка и страницы заявки: розница — только свои клиентские, остальные
 * продавцы — любые клиентские.
 */
export function canRepeatFrom(
  order: { managerEmail: string; clientId?: string; retail?: string | null; kind?: string; direction?: string },
  role: string | null | undefined,
  email: string
): boolean {
  if (!canCreateClientOrder(role)) return false;
  if (!isClientOrder(order)) return false;
  if (retailTerritoryFor(role)) return isOwnClientOrder(order, email);
  return true;
}

/** Позиции для формы: цветок, сорт, градация и количество — цена по ТЕКУЩЕМУ прайсу. */
export function repeatFormItems(
  items: { flowerType: string; variety: string; grade: string; quantity: number }[],
  prices: Record<string, number>,
  catalog?: Record<string, string[]>
): { flowerType: string; variety: string; grade: string; quantity: string; unitPrice: string }[] {
  return items
    .filter((it) => it.quantity > 0)
    .map((it) => {
      const list = catalog?.[it.flowerType];
      // Сорт, которого больше нет в справочнике, — пусто: пусть выберут заново.
      const variety = list && !list.includes(it.variety) ? "" : it.variety;
      const price = it.grade ? priceFromMap(prices, it.flowerType, variety, it.grade) : 0;
      return {
        flowerType: it.flowerType,
        variety,
        grade: it.grade,
        quantity: String(it.quantity),
        unitPrice: price > 0 ? String(price) : "",
      };
    });
}
