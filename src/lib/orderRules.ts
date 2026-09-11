import { ORDER_STATUSES, ROLES } from "./constants";
import { canFillRegions, isRetailOrder, isRetailRole } from "./retail";
import { canFillRegionOrders, hasNoClientInvoice, isRegionOrder } from "./orderKind";

/**
 * Правила жизненного цикла заявки — в одном месте и без обращений к таблице,
 * чтобы их можно было проверить тестами, а не «на живой базе».
 *
 * Раньше правил не было вовсе: `updateOrderStatusAction` меняла статус на
 * любой, кому угодно и в любой момент — единственной проверкой было «человек
 * залогинен». Серверное действие Next.js вызывается обычным запросом, поэтому
 * агроном мог отменить чужую заявку или пометить отгруженной ту, по которой не
 * уехало ни стебля. Кнопки в интерфейсе при этом не было ни одной — то есть
 * функция была одновременно дырой и недоделанной возможностью.
 */

export interface CancelCheckOrder {
  status: string;
  managerEmail: string;
  items: { shippedQuantity: number }[];
  /** Направление собственной розницы; пусто — обычная продажа наружу. */
  retail?: string;
  /** Вид заявки: «region» — оптовый объём на город. */
  kind?: string;
}

/** Заявка закрыта: отменять и трогать её больше нельзя. */
export function isClosed(status: string): boolean {
  return status === ORDER_STATUSES.SHIPPED || status === ORDER_STATUSES.CANCELLED;
}

/**
 * Может ли этот человек отменить эту заявку. Возвращает причину отказа или
 * пустую строку, если можно.
 *
 * Три правила, и каждое стоило бы дорого:
 * 1) отменяет свой менеджер или администратор — чужую заявку не трогают.
 *    Для розницы «свой менеджер» — это менеджер розницы, оформивший заявку:
 *    ждать здесь обычного менеджера не от кого, заявку заводил не он;
 * 2) уже отгруженную или отменённую не отменяют повторно;
 * 3) заявку, по которой хоть что-то уехало, отменить нельзя: цветок у клиента,
 *    а отмена вычеркнула бы заявку из выручки, долгов и бонусов — стебли ушли
 *    бы со склада, не оставив следа ни в продажах, ни в списаниях.
 */
export function cancelRefusal(
  order: CancelCheckOrder,
  role: string | null | undefined,
  email: string | null | undefined
): string {
  const mine = order.managerEmail === (email || "").trim().toLowerCase();
  // Заявку заводит обычный менеджер, менеджер розницы или зав. складом (по
  // регионам) — отменяет её тот же человек. Чьё это направление, проверять
  // отдельно не нужно: почта в заявке и так принадлежит ровно одному из них.
  const ownRole =
    role === ROLES.MANAGER ||
    isRetailRole(role) ||
    (isRetailOrder(order) && canFillRegions(role)) ||
    // Городскую заявку заводит РОП — он же её и отменяет.
    (isRegionOrder(order) && canFillRegionOrders(role));
  if (role !== ROLES.ADMIN && !(ownRole && mine)) {
    return "Отменить заявку может только её менеджер или администратор";
  }
  if (order.status === ORDER_STATUSES.CANCELLED) return "Заявка уже отменена";
  if (order.status === ORDER_STATUSES.SHIPPED) {
    return "Заявка отгружена — отменять её поздно. Оформите рекламацию.";
  }
  const shipped = order.items.reduce((sum, i) => sum + i.shippedQuantity, 0);
  if (shipped > 0) {
    return (
      `По заявке уже отгружено ${shipped} шт. — отменять нельзя: цветок уехал, ` +
      "а отмена стёрла бы его из всех отчётов. Уменьшите количество через рекламацию."
    );
  }
  return "";
}

/**
 * Кто ставит «зелёную галочку» подтверждения — и когда её ставить уже нельзя.
 *
 * Подтверждение открывает отгрузку, поэтому правило то же, что и у отмены:
 * ставит ТОТ, КТО ЗАЯВКУ ЗАВЁЛ, и никто больше (админ — по любой, он и чинит).
 * Проверка «своя заявка» идёт по почте, а не по роли: у розничной заявки
 * менеджером записан менеджер розницы или зав. складом производства, у обычной —
 * оптовый менеджер, и одна и та же почта не бывает и там, и там.
 *
 * Снятое подтверждение по закрытой заявке запрещено: цветок уехал, а отчёты
 * пересчитались бы задним числом.
 */
export function confirmRefusal(
  order: { status: string; managerEmail: string; retail?: string; kind?: string },
  role: string | null | undefined,
  email: string | null | undefined,
  confirmed: boolean
): string {
  const closed =
    !confirmed && isClosed(order.status)
      ? order.status === ORDER_STATUSES.SHIPPED
        ? "Заявка отгружена — снимать подтверждение поздно"
        : "Заявка отменена"
      : "";

  if (role === ROLES.ADMIN) return closed;

  const mine = order.managerEmail === (email || "").trim().toLowerCase();
  // Кому вообще положено подтверждать заявку такого рода.
  const rightRole = isRegionOrder(order)
    ? canFillRegionOrders(role)
    : isRetailOrder(order)
      ? isRetailRole(role) || canFillRegions(role)
      : role === ROLES.MANAGER;

  if (!rightRole) {
    return hasNoClientInvoice(order)
      ? "Эту заявку подтверждает тот, кто её составил"
      : "Подтвердить заявку может только менеджер, который её оформил";
  }
  if (!mine) return "Это заявка другого менеджера";
  return closed;
}

/**
 * Можно ли ещё трогать деньги по заявке.
 *
 * Снять оплату с отгруженной заявки — значит вернуть её в долги и в список
 * звонков, обнулить бонус менеджера за уже уехавший товар и убрать деньги из
 * календаря. Если клиент действительно вернул деньги, это рекламация, а не
 * «снять галочку».
 */
export function moneyRefusal(status: string): string {
  if (status === ORDER_STATUSES.CANCELLED) return "Заявка отменена — деньги по ней не проводятся";
  if (status === ORDER_STATUSES.SHIPPED) {
    return "Заявка отгружена — снимать оплату нельзя. Если клиент вернул деньги, проведите рекламацию.";
  }
  return "";
}
