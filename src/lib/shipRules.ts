/**
 * Правила отгрузки, которые обязан проверить СЕРВЕР.
 *
 * Раньше единственной проверкой на сервере был остаток партии. Всё остальное —
 * «не больше, чем осталось отгрузить» — жило в браузере, в `ShipmentForm`, и
 * считалось от количества, отрисованного в момент открытия страницы. Это не
 * теория про подделанный запрос, а обычная работа: зав. складом отгрузила
 * тысячу с телефона, а на компьютере у неё открыта та же страница со вчерашним
 * числом — нажатие проходит, и в заявке оказывается отгружено вдвое больше,
 * чем заказано.
 *
 * Ещё две вещи не проверялись вовсе:
 *  - что позиция принадлежит именно этой заявке. Готовность спрашивалась по
 *    заявке, а списание шло по позиции: оплаченная заявка «прикрывала» отгрузку
 *    по позиции соседней, неоплаченной;
 *  - что в партии лежит то, что заказано. Клиенту можно было отгрузить другой
 *    сорт или другую длину, и в истории осталась бы ровная запись.
 *
 * Функция чистая — её проверяют тесты (`scripts/check-ship-gate.ts`).
 */

export interface ShipItem {
  itemId: string;
  orderId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  shippedQuantity: number;
}

export interface ShipBatch {
  batchId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantityRemaining: number;
}

/** Сравнение названий: в таблице встречается и «Red Naomi», и «red naomi ». */
function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Причина отказа или пустая строка, если отгружать можно.
 * Порядок проверок — от самой грубой ошибки к самой тонкой.
 */
export function shipmentRefusal(input: {
  orderId: string;
  item: ShipItem | null | undefined;
  batch: ShipBatch | null | undefined;
  quantity: number;
}): string {
  const { orderId, item, batch, quantity } = input;

  if (!Number.isFinite(quantity) || quantity <= 0) return "Укажите количество к отгрузке";
  if (!Number.isInteger(quantity)) return "Количество стеблей — целое число";
  if (!item) return "Позиция заявки не найдена";
  if (!batch) return "Партия не найдена";

  if (item.orderId !== orderId) {
    return "Позиция относится к другой заявке — отгрузка отклонена";
  }

  const left = item.quantity - item.shippedQuantity;
  if (left <= 0) return "По этой позиции уже всё отгружено";
  if (quantity > left) {
    return `По позиции осталось отгрузить ${left} шт., запрошено ${quantity}`;
  }

  if (batch.quantityRemaining < quantity) {
    return `В партии ${batch.batchId} осталось ${batch.quantityRemaining} шт., запрошено ${quantity}`;
  }

  if (batch.flowerType !== item.flowerType || !same(batch.variety, item.variety)) {
    return `В партии ${batch.batchId} лежит ${batch.variety}, а в заявке ${item.variety}`;
  }
  if (!same(batch.grade, item.grade)) {
    return `В партии ${batch.batchId} ${batch.grade}, а в заявке ${item.grade}`;
  }

  return "";
}
