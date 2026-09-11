import { MONEY_EPSILON, ORDER_STATUSES, ROLES, formatGrade, getGradesFor } from "./constants";
import { isRegionOrder } from "./orderKind";
import { ownerRoleFor } from "./orderRules";

/**
 * Правка уже оформленной заявки.
 *
 * До этого заявку нельзя было исправить вовсе: ошибся в количестве, забыл дату
 * доставки, клиент попросил добавить ещё сотню — и единственным выходом было
 * отменить заявку и завести заново. На деле это означало, что в базе копятся
 * отменённые заявки-двойники, а менеджер правит цифры в Google-таблице руками,
 * в обход всех проверок. Владелец попросил дать правку прямо в программе.
 *
 * Границы правки — решение владельца, и они разные для разных полей:
 *
 * - **дата доставки, телефон и комментарий** правятся, пока заявка не закрыта.
 *   Это не деньги: перенос доставки на день вперёд не меняет ни сумму, ни
 *   выручку, ни бонус. Ровно этот случай («не забил дату») и был первым;
 * - **позиции — количество, цена, состав** правятся, пока БУХГАЛТЕР НЕ ПРОВЁЛ
 *   ДЕНЬГИ. Как только деньги проведены, сумма заявки становится предметом
 *   спора с клиентом, и меняет её бухгалтер через рекламацию — там есть и
 *   причина, и след в журнале, и пересчёт долга. Дать менеджеру тихо поменять
 *   оплаченную заявку значило бы завести второй, необъяснённый путь к тем же
 *   деньгам;
 * - **отгруженное не правится вообще.** Цветок уехал; уменьшить заявку ниже
 *   отгруженного — значит стереть со склада стебли, которых уже нет;
 * - **клиент (а у городской заявки — регион) не меняется.** Другой клиент —
 *   это другая заявка: у неё другой счёт, другая история и другая статистика.
 *   Ошиблись — отмените и заведите заново, тогда обе записи останутся честными.
 *
 * Правка позиций СНИМАЕТ подтверждение менеджера — так решил владелец. Склад
 * видит «✓» и собирает по нему; если состав изменился, подтверждён был другой
 * состав, и согласиться с новым менеджер должен осознанно.
 */

export interface EditableOrder {
  status: string;
  managerEmail: string;
  /** Сколько денег по заявке уже проведено. Больше нуля — позиции заморожены. */
  paidAmount: number;
  items: { shippedQuantity: number }[];
  retail?: string;
  kind?: string;
}

/** Общая часть: та ли роль, своя ли заявка, не закрыта ли она. */
function baseRefusal(
  order: EditableOrder,
  role: string | null | undefined,
  email: string | null | undefined
): string {
  if (order.status === ORDER_STATUSES.CANCELLED) return "Заявка отменена — править её нечего";
  if (order.status === ORDER_STATUSES.SHIPPED) {
    return "Заявка отгружена — править её поздно. Если клиент недоволен, оформите рекламацию.";
  }
  if (role === ROLES.ADMIN) return "";

  const mine = order.managerEmail === (email || "").trim().toLowerCase();
  if (!ownerRoleFor(order, role)) return "Править заявку может только тот, кто её составил";
  if (!mine) return "Это заявка другого менеджера";
  return "";
}

/**
 * Правка «шапки»: дата доставки, телефон для доставки, комментарий.
 * Пустая строка означает «можно».
 */
export function editHeaderRefusal(
  order: EditableOrder,
  role: string | null | undefined,
  email: string | null | undefined
): string {
  return baseRefusal(order, role, email);
}

/** Правка позиций: количество, цена, состав. */
export function editItemsRefusal(
  order: EditableOrder,
  role: string | null | undefined,
  email: string | null | undefined
): string {
  const base = baseRefusal(order, role, email);
  if (base) return base;

  const shipped = order.items.reduce((sum, i) => sum + i.shippedQuantity, 0);
  if (shipped > 0) {
    return (
      `По заявке уже отгружено ${shipped.toLocaleString("ru-RU")} шт. — позиции менять нельзя: ` +
      "цветок уехал. Уменьшить сумму можно рекламацией."
    );
  }

  // Оплата закрывает состав заявки. У городской заявки в том же поле лежит
  // подтверждённая бухгалтером сумма поступлений, и разговор там другой —
  // рекламации по городу не бывает, потому что нет ни клиента, ни счёта.
  if (order.paidAmount > MONEY_EPSILON) {
    return isRegionOrder(order)
      ? "Бухгалтер уже подтвердил поступления по этому городу. Чтобы поправить объём, попросите убрать сумму."
      : "Бухгалтер уже провёл деньги по заявке — состав и суммы меняются рекламацией, а не правкой.";
  }
  return "";
}

/** Правится ли заявка вообще — по этому показывается кнопка «Изменить». */
export function canEditOrder(
  order: EditableOrder,
  role: string | null | undefined,
  email: string | null | undefined
): boolean {
  return editHeaderRefusal(order, role, email) === "";
}

// ---------------------------------------------------------------------------
// Проверка самих позиций
// ---------------------------------------------------------------------------

export interface CurrentItem {
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  shippedQuantity: number;
}

export interface EditedItem {
  /** Пусто — новая позиция; иначе правим существующую. */
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
}

const MAX_QUANTITY = 10_000_000;
const MAX_PRICE = 10_000_000;

/**
 * Что не так с присланным составом заявки. Пустая строка — всё в порядке.
 *
 * Проверка живёт здесь, а не в форме, потому что форма — это подсказка, а не
 * запрет (грабли 1.11): серверное действие вызывается обычным запросом, и
 * присланное туда количество «-500» или чужой itemId дойдут до таблицы, если
 * их не остановить на сервере.
 */
export function editedItemsRefusal(input: {
  current: CurrentItem[];
  next: EditedItem[];
  /** У городской заявки цены нет по замыслу — она не проверяется, а обнуляется. */
  region: boolean;
}): string {
  const { current, next, region } = input;
  if (next.length === 0) return "В заявке должна остаться хотя бы одна позиция";

  const byId = new Map(current.map((i) => [i.itemId, i]));
  const seen = new Set<string>();

  for (const item of next) {
    const was = item.itemId ? byId.get(item.itemId) : null;
    if (item.itemId && !was) return "Позиция не из этой заявки";
    if (item.itemId) {
      if (seen.has(item.itemId)) return "Одна и та же позиция прислана дважды";
      seen.add(item.itemId);
    }

    const variety = (item.variety || "").trim();
    if (!variety) return "У каждой позиции должен быть выбран сорт";

    const grade = (item.grade || "").trim();
    if (!grade) return "У каждой позиции должна быть выбрана длина или категория";
    // Список градаций закрытый — свободный ввод превратил бы «60» и «60 см» в
    // две разные позиции. Но старую заявку с градацией не из списка правка
    // ломать не должна: оставить как было можно, ввести новую такую — нет.
    if (!getGradesFor(item.flowerType).includes(grade) && was?.grade !== grade) {
      return `Неизвестная длина или категория: ${formatGrade(grade)}`;
    }

    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return "Количество должно быть больше нуля";
    }
    if (!Number.isInteger(quantity)) return "Количество считается в целых стеблях";
    if (quantity > MAX_QUANTITY) return "Слишком большое количество";
    if (was && quantity < was.shippedQuantity) {
      return `«${was.variety} ${formatGrade(was.grade)}»: отгружено ${was.shippedQuantity} шт., меньше этого заказ быть не может`;
    }

    if (!region) {
      const price = Number(item.unitPrice);
      if (!Number.isFinite(price) || price < 0) return "Цена не может быть отрицательной";
      if (price > MAX_PRICE) return "Слишком большая цена";
    }
  }

  // Удалять можно только то, по чему ничего не уехало. Эта проверка дублирует
  // общий запрет «есть отгрузки — позиции заморожены», и намеренно: запрет
  // когда-нибудь могут ослабить, а потеря отгруженной строки — это стебли,
  // пропавшие со склада без единой записи.
  for (const item of current) {
    if (!seen.has(item.itemId) && item.shippedQuantity > 0) {
      return `«${item.variety} ${formatGrade(item.grade)}» уже отгружена — удалить её нельзя`;
    }
  }

  return "";
}

/**
 * Что именно изменилось — словами, для журнала действий по деньгам.
 *
 * Через месяц вопрос звучит как «почему заявка стала меньше», и ответом должна
 * быть строка журнала, а не память менеджера.
 */
export function describeItemChanges(input: {
  current: CurrentItem[];
  next: EditedItem[];
  region: boolean;
}): string[] {
  const { current, next, region } = input;
  const byId = new Map(current.map((i) => [i.itemId, i]));
  const seen = new Set<string>();
  const changes: string[] = [];

  for (const item of next) {
    const name = `${(item.variety || "").trim()} ${formatGrade(item.grade)}`;
    const was = item.itemId ? byId.get(item.itemId) : null;
    if (!was) {
      changes.push(
        region
          ? `добавлено: ${name} — ${item.quantity} шт.`
          : `добавлено: ${name} — ${item.quantity} шт. по ${item.unitPrice} ₸`
      );
      continue;
    }
    seen.add(item.itemId);

    const parts: string[] = [];
    if (was.quantity !== item.quantity) parts.push(`${was.quantity} → ${item.quantity} шт`);
    if (!region && was.unitPrice !== item.unitPrice) {
      parts.push(`${was.unitPrice} → ${item.unitPrice} ₸`);
    }
    if (was.variety.trim() !== (item.variety || "").trim() || was.grade !== item.grade) {
      parts.push(`${was.variety} ${formatGrade(was.grade)} → ${name}`);
    }
    if (parts.length > 0) changes.push(`${name}: ${parts.join(", ")}`);
  }

  for (const item of current) {
    if (!seen.has(item.itemId)) {
      changes.push(`убрано: ${item.variety} ${formatGrade(item.grade)} — ${item.quantity} шт.`);
    }
  }

  return changes;
}

/** Сумма присланного состава — чтобы сравнить её с прежней. */
export function editedTotal(next: EditedItem[], region: boolean): number {
  if (region) return 0;
  return next.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
}

/**
 * Номера для новых позиций.
 *
 * Позиции нумеруются внутри заявки («ORD-1234-I3»), и продолжать надо с
 * наибольшего занятого номера, а не с количества строк: удалили вторую из трёх,
 * добавили новую — и по счёту строк она получила бы номер уже существующей.
 * Две строки с одним ItemID означали бы, что отгрузка уходит не в ту позицию.
 */
export function nextItemIds(orderId: string, existingIds: string[], count: number): string[] {
  let max = 0;
  for (const id of existingIds) {
    const match = /-I(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) ids.push(`${orderId}-I${max + i}`);
  return ids;
}

/**
 * Что сделать со строками позиций: какие переписать, какие завести, какие убрать.
 *
 * Вынесено сюда отдельно от записи, потому что здесь я уже ошибся. В первой
 * версии список «оставить» собирался только из ПРИСЛАННЫХ номеров, а номера
 * новых позиций выдаются при записи — и удаление, идущее следом, сносило
 * только что добавленную строку. На живой базе это выглядело бы как «добавил
 * позицию, сохранил, её нет»; поймать такое глазами почти нельзя.
 */
export function planItemSave(
  orderId: string,
  existingIds: string[],
  items: { itemId: string }[]
): { keep: string[]; newIds: string[]; deleted: string[] } {
  const submitted = items.map((i) => (i.itemId || "").trim());
  const newIds = nextItemIds(orderId, existingIds, submitted.filter((id) => !id).length);
  const keep = [...submitted.filter(Boolean), ...newIds];
  const keepSet = new Set(keep);
  return { keep, newIds, deleted: existingIds.filter((id) => !keepSet.has(id)) };
}

/** Дата доставки: пустая допустима (её и приходят дописывать), кривая — нет. */
export function cleanDeliveryDate(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const [year, month, day] = raw.split("-").map(Number);
  if (year < 2020 || year > 2100) return "";
  // Обратная сверка: «2026-02-31» JS молча превращает в третье марта, и без
  // этой проверки в заявке оказалась бы дата, которой человек не вводил.
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "";
  }
  return raw;
}
