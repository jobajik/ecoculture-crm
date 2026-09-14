import {
  MONEY_EPSILON,
  ORDER_STATUSES,
  ROLES,
  flowerTypesForFarm,
  formatGrade,
  getFarmFor,
  getGradesFor,
} from "./constants";

/**
 * Правка заявки зав. складом — по своему цветку.
 *
 * Владелец попросил прямо: «дай возможность зав. складам изменять данные по
 * заявкам по цветкам сотрудников». Случай настоящий и ежедневный: менеджер
 * записал 800 шестидесятки, а утром в холодильнике 640, и половина из них
 * пятидесятка. Кто это видит — зав. складом; она же и собирает. До сих пор ей
 * оставалось звонить менеджеру и ждать, пока он поправит заявку, а цветок в это
 * время стоял.
 *
 * Границы выбраны так, чтобы дать ровно это и ничего сверх:
 *
 * - **только свой цветок.** Роза и эустома — Rose Farm, хризантема — Есентай.
 *   Чужие позиции не просто скрыты: присланные, они отвергаются сервером
 *   (грабли 1.11). Это то же разграничение, что и везде у склада, и ослаблять
 *   его здесь нельзя — иначе зав. складом Есентая правит розу;
 * - **количество, ростовка и цена** — так решил владелец. Сорт и тип цветка не
 *   меняются: другой сорт — это другая договорённость с клиентом, а другой
 *   цветок — вообще другое производство и другой счёт;
 * - **позиции не добавляются и не удаляются.** Склад ПОПРАВЛЯЕТ заказанное, а
 *   не переписывает заявку: убрать строку — значит вычеркнуть договорённость
 *   менеджера с клиентом, о которой склад не знает;
 * - **причина обязательна и уходит в журнал денег.** Правка меняет сумму
 *   заявки, а значит долг, собираемость и бонус менеджера. Через месяц вопрос
 *   «почему заявка стала меньше» должен иметь письменный ответ;
 * - **подтверждение менеджера НЕ снимается** — в отличие от обычной правки. Там
 *   оно снимается, чтобы склад не собрал состав, который никто не согласовывал;
 *   здесь состав меняет сама зав. складом, и снятая галочка просто заперла бы
 *   ей отгрузку, ради которой всё и затевалось;
 * - **отгруженное не уменьшается ниже отгруженного** — общая граница всей
 *   программы: цветок уехал, и стереть его со склада правкой нельзя.
 *
 * Отдельно про ОПЛАЧЕННУЮ заявку. Обычная правка позиций на ней запрещена:
 * сумма оплаченной заявки — предмет спора с клиентом, и меняет её бухгалтер
 * рекламацией. Здесь запрет пришлось бы применить почти всегда — отгрузку
 * открывает полная оплата, то есть к моменту сборки заявка уже оплачена, и
 * возможность вышла бы мёртвой. Поэтому правка разрешена и по оплаченной, но
 * платой за это идут три вещи: причина обязательна, запись уходит в журнал
 * денег наравне с рекламацией, а флаг оплаты и статус пересчитываются — иначе
 * заявка осталась бы «оплаченной» при выросшей сумме и уехала бы без денег.
 */

export interface WarehouseEditOrder {
  status: string;
  paidAmount: number;
  items: { itemId: string; flowerType: string; shippedQuantity: number }[];
  retail?: string;
  kind?: string;
}

/** Можно ли этому человеку править эту заявку. Пустая строка — можно. */
export function warehouseEditRefusal(
  order: WarehouseEditOrder,
  role: string | null | undefined,
  farm: string | null | undefined
): string {
  if (role !== ROLES.WAREHOUSE) return "Править позиции по своему цветку может только зав. складом";
  // Пустое производство закрывает доступ, а не открывает (грабли 1.10).
  if (!farm) return "У вас не указано производство — обратитесь к администратору";
  if (order.status === ORDER_STATUSES.CANCELLED) return "Заявка отменена — править её нечего";
  if (order.status === ORDER_STATUSES.SHIPPED) {
    return "Заявка отгружена — править её поздно. Если клиент недоволен, менеджер оформит рекламацию.";
  }
  if (myItems(order, farm).length === 0) {
    return "В этой заявке нет позиций вашего производства";
  }
  return "";
}

/** Позиции этой заявки, за которые отвечает данное производство. */
export function myItems<T extends { flowerType: string }>(
  order: { items: T[] },
  farm: string | null | undefined
): T[] {
  if (!farm) return [];
  const mine = new Set<string>(flowerTypesForFarm(farm));
  return order.items.filter((i) => mine.has(i.flowerType));
}

export interface WarehouseCurrentItem {
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  shippedQuantity: number;
}

export interface WarehouseEditedItem {
  itemId: string;
  grade: string;
  quantity: number;
  unitPrice: number;
}

const MAX_QUANTITY = 10_000_000;
const MAX_PRICE = 10_000_000;
const MIN_REASON = 5;

/**
 * Что не так с присланной правкой. Пустая строка — всё в порядке.
 *
 * Проверяются ИМЕННО присланные данные, а не то, что показала форма: серверное
 * действие вызывается обычным запросом, и чужой `itemId` дойдёт до таблицы,
 * если его здесь не остановить.
 */
export function warehouseEditedRefusal(input: {
  current: WarehouseCurrentItem[];
  next: WarehouseEditedItem[];
  farm: string | null | undefined;
  reason: string;
  /** У городской заявки цены нет по замыслу — она не проверяется, а обнуляется. */
  region: boolean;
}): string {
  const { current, next, farm, region } = input;
  const reason = (input.reason || "").trim();

  if (next.length === 0) return "Не прислано ни одной позиции";
  if (reason.length < MIN_REASON) {
    return "Напишите причину: через месяц по ней будут разбирать, почему заявка изменилась";
  }

  const byId = new Map(current.map((i) => [i.itemId, i]));
  const mine = new Set<string>(flowerTypesForFarm(farm));
  const seen = new Set<string>();

  for (const item of next) {
    const was = byId.get((item.itemId || "").trim());
    if (!was) return "Позиция не из этой заявки";
    if (seen.has(was.itemId)) return "Одна и та же позиция прислана дважды";
    seen.add(was.itemId);

    // Главная граница. Чужая позиция не «не показывается» — она отвергается.
    if (!mine.has(was.flowerType)) {
      return `«${was.variety} ${formatGrade(was.grade)}» — не ваше производство`;
    }

    const grade = (item.grade || "").trim();
    if (!grade) return "У каждой позиции должна быть выбрана длина или категория";
    // Список закрытый, но старую позицию с градацией не из списка правка ломать
    // не должна: оставить как было можно, ввести новую такую — нет.
    if (!getGradesFor(was.flowerType).includes(grade) && was.grade !== grade) {
      return `Неизвестная длина или категория: ${formatGrade(grade)}`;
    }

    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return "Количество должно быть больше нуля";
    if (!Number.isInteger(quantity)) return "Количество считается в целых стеблях";
    if (quantity > MAX_QUANTITY) return "Слишком большое количество";
    if (quantity < was.shippedQuantity) {
      return `«${was.variety} ${formatGrade(was.grade)}»: отгружено ${was.shippedQuantity} шт., меньше этого заказ быть не может`;
    }

    if (!region) {
      const price = Number(item.unitPrice);
      if (!Number.isFinite(price) || price < 0) return "Цена не может быть отрицательной";
      if (price > MAX_PRICE) return "Слишком большая цена";
    }
  }

  if (describeWarehouseChanges({ current, next, region }).length === 0) {
    return "Ничего не изменилось";
  }

  return "";
}

/** Что именно изменилось — словами, для журнала денег. */
export function describeWarehouseChanges(input: {
  current: WarehouseCurrentItem[];
  next: WarehouseEditedItem[];
  region: boolean;
}): string[] {
  const { current, next, region } = input;
  const byId = new Map(current.map((i) => [i.itemId, i]));
  const changes: string[] = [];

  for (const item of next) {
    const was = byId.get((item.itemId || "").trim());
    if (!was) continue;
    const parts: string[] = [];
    if (was.quantity !== Number(item.quantity)) {
      parts.push(`${was.quantity} → ${item.quantity} шт`);
    }
    if (was.grade !== (item.grade || "").trim()) {
      parts.push(`${formatGrade(was.grade)} → ${formatGrade((item.grade || "").trim())}`);
    }
    if (!region && was.unitPrice !== Number(item.unitPrice)) {
      parts.push(`${was.unitPrice} → ${item.unitPrice} ₸`);
    }
    if (parts.length > 0) changes.push(`${was.variety}: ${parts.join(", ")}`);
  }

  return changes;
}

/**
 * Итоговый состав заявки после правки склада: свои позиции заменены, чужие
 * оставлены ровно как были.
 *
 * Собирается здесь, а не в обработчике, чтобы «чужое не тронуто» было свойством,
 * которое можно проверить тестом.
 */
export function applyWarehouseEdit(input: {
  current: WarehouseCurrentItem[];
  next: WarehouseEditedItem[];
  region: boolean;
}): WarehouseCurrentItem[] {
  const { current, next, region } = input;
  const byId = new Map(next.map((i) => [(i.itemId || "").trim(), i]));
  return current.map((item) => {
    const edit = byId.get(item.itemId);
    if (!edit) return item;
    return {
      ...item,
      grade: (edit.grade || "").trim(),
      quantity: Math.round(Number(edit.quantity)),
      unitPrice: region ? 0 : Math.round(Number(edit.unitPrice) * 100) / 100,
    };
  });
}

/** Сумма заявки после правки. */
export function totalAfterWarehouseEdit(items: WarehouseCurrentItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
}

/**
 * Предупреждение о деньгах — его человек должен увидеть ДО сохранения.
 *
 * Правка на оплаченной заявке разрешена намеренно (иначе возможность была бы
 * мёртвой), но молчать о последствиях нельзя: уменьшили — появилась переплата,
 * увеличили — заявка перестала быть оплаченной и её нельзя отгружать, пока
 * бухгалтер не проведёт остаток.
 *
 * СУММ в тексте нет, и это не небрежность. Предупреждение читает зав. складом,
 * а в смешанной заявке итог складывается из обоих производств — назвать его
 * значило бы показать ей деньги чужого цветка (грабли 1.1-ter). Что произошло,
 * ей знать нужно; сколько именно — нет, это разговор бухгалтера с клиентом.
 */
export function moneyWarning(paidAmount: number, before: number, after: number): string {
  if (paidAmount <= MONEY_EPSILON) return "";
  if (after < before - MONEY_EPSILON && paidAmount - after > MONEY_EPSILON) {
    return "Заявка была оплачена — после правки по ней появится переплата. Её вернёт бухгалтер.";
  }
  if (after > before + MONEY_EPSILON && paidAmount < after - MONEY_EPSILON) {
    return "Сумма заявки выросла и оплачена не полностью. Пока бухгалтер не проведёт остаток, отгружать её нельзя.";
  }
  return "";
}

/** Производство, к которому относится позиция, — для подписи в списке. */
export function farmOfItem(flowerType: string): string {
  return getFarmFor(flowerType) ?? "";
}
