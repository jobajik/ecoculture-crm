import { MONEY_EPSILON, ORDER_STATUSES, ROLES, flowerTypesForFarm, formatGrade } from "./constants";
import { isRegionOrder } from "./orderKind";
import { ownerRoleFor } from "./orderRules";
import { isRetailOrder } from "./retail";

/**
 * Возврат и перемещение в наш магазин — по строкам заявки.
 *
 * Менеджер Ильяс прислал заявку (роза Love Lydia 45 шт и хризантема 150 шт):
 * «Из-за неоплаты вернул хризантемы на теплицу — как возврат оформить?» и
 * «Лав Лидия 60 — 45 шт переместил на Спутник — как перемещение сделать?».
 * Ответа у программы не было. Правка заявки умела только менять состав, отмена
 * — только всю заявку целиком, а «цветок ушёл в наш магазин вместо клиента» не
 * описывалось ничем: стебли оставались висеть в клиентской заявке, а магазин
 * получал их без единой записи.
 *
 * Здесь две операции над одной строкой, и их можно сделать за раз:
 *
 * - **«вернуть»** — клиент не берёт (или вернул) часть. Не отгруженные стебли
 *   просто снимаются с заявки: со склада они и не списывались, в партиях они
 *   уже есть. ОТГРУЖЕННЫЕ (клиент привёз обратно) возвращаются в те партии,
 *   из которых уехали, — последние отгрузки первыми, — и в журнал отгрузок
 *   ложится строка с минусом. Так журнал по-прежнему сходится с «отгружено»
 *   (аудит сентября, грабли 1.16);
 * - **«в магазин»** — стебли уходят в наш магазин. Появляется обычная заявка
 *   магазину (одна галочка, внутренняя цена), а клиентская уменьшается. Если
 *   цветок уже увезли и перемещает склад — стебли можно сразу списать со
 *   склада (отгрузить новую заявку от старых срезок к свежим); менеджер так не
 *   может, он не отгружает — заявка магазину встанет складу в очередь.
 *
 * Если после этого в заявке ничего не осталось — она ОТМЕНЯЕТСЯ, а строки
 * остаются как были: по отменённой заявке через месяц видно, что клиент
 * заказывал и почему не взял. Отменить заявку с деньгами нельзя (правило
 * отмены): полный возврат по оплаченной — сначала бухгалтер снимает платёж.
 *
 * Кто может — ровно те, кто отвечает за эти стебли:
 * - менеджер своей заявки (как отмена и правка) — любые строки, но только
 *   НЕ отгруженное: вернуть на склад уехавший цветок может тот, кто его примет;
 * - зав. складом — свои позиции (грабли 1.1-ter), в том числе отгруженные;
 * - администратор — всё.
 *
 * Всё записывается одним атомарным запросом (грабли 1.16): заявка, партии,
 * журнал и новая заявка магазину — целиком или никак.
 */

export interface ReturnItem {
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  shippedQuantity: number;
}

export interface ReturnOrder {
  orderId: string;
  status: string;
  managerEmail: string;
  retail?: string;
  kind?: string;
  paidAmount: number;
  items: ReturnItem[];
}

export interface ReturnAccess {
  refusal: string;
  /** Строки, которые этот человек может трогать. */
  itemIds: string[];
  /** Может вернуть на склад УЖЕ отгруженные стебли. */
  canTakeShipped: boolean;
  /** Может перемещать в наш магазин (только из клиентской заявки). */
  canMove: boolean;
  /** Может сразу списать перемещённое со склада (отгрузить заявку магазину). */
  canShipNow: boolean;
}

/** Отказ по отменённой заявке — его страница узнаёт, чтобы показать итог только что сделанного возврата. */
export const RETURN_CANCELLED = "Заявка отменена — возвращать нечего";

const NONE: Omit<ReturnAccess, "refusal"> = {
  itemIds: [],
  canTakeShipped: false,
  canMove: false,
  canShipNow: false,
};

/** Клиентская заявка — не наш магазин и не объём на город. Только из неё переносят в магазин. */
export function isClientOrder(order: { retail?: string; kind?: string }): boolean {
  return !isRetailOrder(order) && !isRegionOrder(order);
}

export function returnAccess(
  order: ReturnOrder,
  role: string | null | undefined,
  email: string | null | undefined,
  farm: string | null | undefined
): ReturnAccess {
  const me = (email || "").trim().toLowerCase();
  if (!me) return { refusal: "Не авторизован", ...NONE };
  if (order.status === ORDER_STATUSES.CANCELLED) return { refusal: RETURN_CANCELLED, ...NONE };

  const client = isClientOrder(order);
  let access: Omit<ReturnAccess, "refusal">;
  if (role === ROLES.ADMIN) {
    access = { itemIds: order.items.map((i) => i.itemId), canTakeShipped: true, canMove: client, canShipNow: true };
  } else if (role === ROLES.WAREHOUSE) {
    // Пустое производство закрывает, а не открывает (грабли 1.10).
    if (!farm) return { refusal: "У вас не указано производство — обратитесь к администратору", ...NONE };
    const mine = new Set<string>(flowerTypesForFarm(farm));
    const own = order.items.filter((i) => mine.has(i.flowerType)).map((i) => i.itemId);
    if (own.length === 0) return { refusal: "В этой заявке нет позиций вашего производства", ...NONE };
    access = { itemIds: own, canTakeShipped: true, canMove: client, canShipNow: true };
  } else if (ownerRoleFor(order, role) && order.managerEmail === me) {
    access = {
      itemIds: order.items.map((i) => i.itemId),
      canTakeShipped: false,
      canMove: client,
      canShipNow: false,
    };
  } else {
    return {
      refusal: "Оформить возврат может менеджер заявки, зав. складом (по своему цветку) или администратор",
      ...NONE,
    };
  }

  const touchable = order.items.filter((i) => access.itemIds.includes(i.itemId));
  const something = touchable.some((i) =>
    access.canTakeShipped ? i.quantity > 0 : i.quantity - i.shippedQuantity > 0
  );
  if (!something) {
    return {
      refusal: access.canTakeShipped
        ? "В заявке нечего возвращать"
        : "Всё уже отгружено — вернуть уехавший цветок на склад оформляет зав. складом",
      ...NONE,
    };
  }
  return { refusal: "", ...access };
}

export interface ReturnLineInput {
  itemId: string;
  /** Вернуть: снять с заявки (а отгруженное — вернуть в партии). */
  back: number;
  /** Переместить в наш магазин. */
  toShop: number;
}

export interface ReturnLinePlan extends ReturnItem {
  back: number;
  toShop: number;
  /** Сколько из «вернуть» — уже отгруженные стебли: они едут обратно в партии. */
  fromShipped: number;
  newQuantity: number;
  newShipped: number;
}

export interface ReturnPlan {
  lines: ReturnLinePlan[];
  /** «cancel» — в заявке ничего не осталось, она отменяется; иначе строки меняются. */
  outcome: "cancel" | "partial";
  /** Строки, которые удаляются (в них ничего не осталось, а заявка живёт дальше). */
  deleteItemIds: string[];
  totalBefore: number;
  totalAfter: number;
  newStatus: string;
  /** Флаг «оплачено целиком» после правки. */
  paid: boolean;
  /** Что уходит в магазин. */
  moved: { flowerType: string; variety: string; grade: string; quantity: number }[];
  /** Сколько стеблей возвращается в партии (отгруженные). */
  backToStock: number;
  /** Словами, для журнала. */
  describe: string[];
}

const MIN_REASON = 5;
const MAX_QTY = 10_000_000;

function whole(n: unknown): number | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v) || v > MAX_QTY) return null;
  return v;
}

/** Статус после изменения строк: «отгружена», «частично» или обратно «новая». */
export function statusAfterReturn(
  status: string,
  items: { quantity: number; shippedQuantity: number }[]
): string {
  if (status === ORDER_STATUSES.CANCELLED) return status;
  if (items.length > 0 && items.every((i) => i.shippedQuantity >= i.quantity)) return ORDER_STATUSES.SHIPPED;
  if (items.some((i) => i.shippedQuantity > 0)) return ORDER_STATUSES.IN_PROGRESS;
  // Вернули всё отгруженное — заявка снова ждёт сборки, а не «отгружена».
  if (status === ORDER_STATUSES.SHIPPED || status === ORDER_STATUSES.IN_PROGRESS) return ORDER_STATUSES.NEW;
  return status;
}

/**
 * Проверка и расчёт. Строка — отказ, объект — что записать.
 *
 * Проверяется ИМЕННО присланное (грабли 1.11): чужая строка, дробные стебли,
 * «в магазин» больше неотгруженного и «вернуть» больше заказанного отвергаются
 * здесь, а не в форме.
 */
export function planReturn(input: {
  order: ReturnOrder;
  lines: ReturnLineInput[];
  access: ReturnAccess;
  reason: string;
  /** Выбран ли магазин (нужен, если что-то уходит в магазин). */
  shopChosen: boolean;
}): ReturnPlan | string {
  const { order, access } = input;
  if (access.refusal) return access.refusal;

  const byId = new Map(order.items.map((i) => [i.itemId, i]));
  const seen = new Set<string>();
  const planned = new Map<string, ReturnLinePlan>();

  for (const raw of input.lines) {
    const itemId = (raw.itemId || "").trim();
    const item = byId.get(itemId);
    if (!item) return "Позиция не из этой заявки";
    if (seen.has(itemId)) return "Одна и та же позиция прислана дважды";
    seen.add(itemId);
    const back = whole(raw.back);
    const toShop = whole(raw.toShop);
    if (back === null || toShop === null) return "Количество — целое число стеблей, не меньше нуля";
    if (back === 0 && toShop === 0) continue;
    const label = `«${item.variety} ${formatGrade(item.grade)}»`;
    if (!access.itemIds.includes(itemId)) return `${label} — не ваше производство`;

    const unshipped = item.quantity - item.shippedQuantity;
    if (toShop > 0 && !access.canMove) {
      return isClientOrder(order)
        ? "Перемещать в магазин может менеджер заявки, зав. складом или администратор"
        : "Из заявки магазина или на город в другой магазин не перемещают — поправьте саму заявку";
    }
    if (toShop > unshipped) {
      return `${label}: в магазин можно передать только не отгруженное — это ${Math.max(0, unshipped)} шт.`;
    }
    if (back + toShop > item.quantity) {
      return `${label}: заказано ${item.quantity} шт., а вернуть и переместить просят ${back + toShop}`;
    }
    const fromShipped = Math.max(0, back - (unshipped - toShop));
    if (fromShipped > 0 && !access.canTakeShipped) {
      return `${label}: ${fromShipped} шт. уже отгружены — вернуть их на склад оформляет зав. складом или администратор`;
    }
    planned.set(itemId, {
      ...item,
      back,
      toShop,
      fromShipped,
      newQuantity: item.quantity - back - toShop,
      newShipped: item.shippedQuantity - fromShipped,
    });
  }

  if (planned.size === 0) return "Укажите, сколько вернуть или передать в магазин";
  const moving = Array.from(planned.values()).some((l) => l.toShop > 0);
  if (moving && !input.shopChosen) return "Выберите магазин";
  if ((input.reason || "").trim().length < MIN_REASON) {
    return "Напишите причину: через месяц по ней будут разбирать, куда делся цветок";
  }

  const after = order.items.map((i) => {
    const p = planned.get(i.itemId);
    return p ? { ...i, quantity: p.newQuantity, shippedQuantity: p.newShipped } : i;
  });
  const totalBefore = order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const totalAfter = after.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const empty = after.every((i) => i.quantity === 0);

  if (empty && order.paidAmount > MONEY_EPSILON) {
    return (
      "По заявке уже есть оплата — вернуть её целиком значит вернуть деньги. " +
      "Сначала бухгалтер снимет платёж или оформит возврат денег, потом оформите возврат цветка."
    );
  }

  const lines = Array.from(planned.values());
  const kept = after.filter((i) => i.quantity > 0);
  const describe = lines.map((l) => {
    const parts: string[] = [];
    if (l.back > 0) parts.push(`вернули ${l.back} шт.${l.fromShipped > 0 ? ` (из них ${l.fromShipped} отгруженных — на склад)` : ""}`);
    if (l.toShop > 0) parts.push(`в магазин ${l.toShop} шт.`);
    return `${l.variety} ${formatGrade(l.grade)}: ${parts.join(", ")}`;
  });

  return {
    lines,
    outcome: empty ? "cancel" : "partial",
    deleteItemIds: empty ? [] : lines.filter((l) => l.newQuantity === 0).map((l) => l.itemId),
    totalBefore,
    totalAfter: empty ? 0 : totalAfter,
    newStatus: empty ? ORDER_STATUSES.CANCELLED : statusAfterReturn(order.status, kept),
    paid: !empty && order.paidAmount > 0 && order.paidAmount >= totalAfter - MONEY_EPSILON,
    moved: lines
      .filter((l) => l.toShop > 0)
      .map((l) => ({ flowerType: l.flowerType, variety: l.variety, grade: l.grade, quantity: l.toShop })),
    backToStock: lines.reduce((s, l) => s + l.fromShipped, 0),
    describe,
  };
}

/**
 * Из каких партий вернуть отгруженные стебли позиции: по журналу отгрузок,
 * последние отгрузки первыми. Учитываются и прежние возвраты (строки с минусом),
 * чтобы в одну партию не вернулось больше, чем из неё уехало.
 *
 * Если по журналу вернуть столько нельзя (журнал неполный — так бывало до
 * сентябрьской починки), возвращается то, что нашлось, и `missing` > 0:
 * тогда запись не делается, а человек получает объяснение.
 */
export function batchesToReturn(
  journal: { batchId: string; quantity: number; createdAt: string }[],
  quantity: number
): { parts: { batchId: string; quantity: number }[]; missing: number } {
  const net = new Map<string, number>();
  const lastAt = new Map<string, string>();
  for (const row of journal) {
    net.set(row.batchId, (net.get(row.batchId) ?? 0) + row.quantity);
    if (row.quantity > 0 && (lastAt.get(row.batchId) ?? "") < row.createdAt) lastAt.set(row.batchId, row.createdAt);
  }
  const order = Array.from(net.entries())
    .filter(([, n]) => n > 0)
    .sort((a, b) => ((lastAt.get(a[0]) ?? "") < (lastAt.get(b[0]) ?? "") ? 1 : -1));
  let need = quantity;
  const parts: { batchId: string; quantity: number }[] = [];
  for (const [batchId, n] of order) {
    if (need <= 0) break;
    const take = Math.min(need, n);
    parts.push({ batchId, quantity: take });
    need -= take;
  }
  return { parts, missing: Math.max(0, need) };
}
