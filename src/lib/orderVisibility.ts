import { ROLES, getFarmFor } from "./constants";
import { farmScopeFor, isOwnClientOrder, isRetailOrder, retailTerritoryFor } from "./retail";
import { isRegionOrder } from "./orderKind";
import type { OrderWithItems } from "./types";

/**
 * Какие заявки видит человек — одно правило на список «Заявки», общий поиск и «Мой день».
 *
 * Раньше правило жило прямо в `orders/page.tsx`; с появлением поиска по всему сайту (19.10.2026) оно понадобилось
 * второй раз, а две копии правила видимости — это грабли 1.1-ter: одна отстанет, и зав. складом увидит чужой цветок
 * в подсказках поиска. Правило:
 *
 * - розница видит своё направление и свои клиентские заявки;
 * - менеджер — без розницы и без объёма на город (там нет его клиента);
 * - бухгалтер — всё, кроме розницы (по объёму на город она подтверждает поступления);
 * - зав. складом — только свой цветок: чужие позиции вырезаются, сумма пересчитывается, заявка без своего цветка не
 *   показывается; своя заявка в регион — целиком (`farmScopeFor`).
 */
export function visibleOrdersFor(
  all: OrderWithItems[],
  user: { role?: string | null; email?: string | null; farm?: string | null }
): OrderWithItems[] {
  const role = user.role ?? undefined;
  const myEmail = (user.email ?? "").toLowerCase();
  const territory = retailTerritoryFor(role);
  const visible = all.filter((o) => {
    if (territory) return (isRetailOrder(o) && o.retail === territory) || isOwnClientOrder(o, myEmail);
    if (role === ROLES.MANAGER) return !isRetailOrder(o) && !isRegionOrder(o);
    if (role === ROLES.ACCOUNTANT) return !isRetailOrder(o);
    return true;
  });
  return visible
    .map((order) => {
      const scope = farmScopeFor({ role, farm: user.farm ?? undefined, order, email: myEmail });
      if (!scope) return order;
      const items = order.items.filter((i) => getFarmFor(i.flowerType) === scope);
      const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      const share = order.totalAmount > 0 ? totalAmount / order.totalAmount : 0;
      return { ...order, items, totalAmount, paidAmount: order.paidAmount * share };
    })
    .filter((order) => order.items.length > 0);
}
