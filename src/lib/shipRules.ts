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

/**
 * Отгрузка из НЕСКОЛЬКИХ партий одним нажатием.
 *
 * Появилась по просьбе зав. складом Rose Farm: 310 стеблей одной позиции
 * лежали в десяти партиях по датам срезки (70, 90, 30…), и отгрузить их можно
 * было только десятью нажатиями «Отгрузить» — выбрать партию, дождаться,
 * выбрать следующую. На третьем-четвёртом нажатии Google вдобавок отвечал
 * «превышен лимит запросов», потому что каждое нажатие заново читало всю
 * таблицу.
 *
 * Правило то же, что и у одной партии, — `shipmentRefusal()` для каждой части,
 * — с одной поправкой: «сколько осталось отгрузить по позиции» считается С
 * УЧЁТОМ предыдущих частей этой же отгрузки. Иначе три части по 200 прошли бы
 * каждая по отдельности при остатке 300, и в заявке оказалось бы отгружено
 * вдвое больше заказанного — ровно та беда, от которой написан этот файл.
 *
 * Одна и та же партия дважды в одной отгрузке — отказ, а не сложение:
 * так бывает только при ошибке в форме, и молча складывать её нельзя.
 */
export function shipmentPartsRefusal(input: {
  orderId: string;
  item: ShipItem | null | undefined;
  batches: Map<string, ShipBatch>;
  parts: { batchId: string; quantity: number }[];
}): string {
  const { orderId, item, batches, parts } = input;
  if (parts.length === 0) return "Отметьте хотя бы одну партию";

  const seen = new Set<string>();
  let before = 0;
  for (const part of parts) {
    if (seen.has(part.batchId)) return `Партия ${part.batchId} отмечена дважды`;
    seen.add(part.batchId);

    const refusal = shipmentRefusal({
      orderId,
      item: item ? { ...item, shippedQuantity: item.shippedQuantity + before } : item,
      batch: batches.get(part.batchId),
      quantity: part.quantity,
    });
    if (refusal) {
      // Первая часть объясняет себя сама; у следующих уточняем, что считали
      // вместе с уже отмеченными — иначе «осталось 40» при заказе 310 выглядит
      // как ошибка программы.
      if (before > 0 && refusal.startsWith("По позиции осталось")) {
        const total = parts.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
        const left = item ? item.quantity - item.shippedQuantity : 0;
        return `Отмечено ${total} шт., а по позиции осталось отгрузить ${left} шт.`;
      }
      return refusal;
    }
    before += part.quantity;
  }
  return "";
}

/**
 * Статус заявки после отгрузки: всё уехало — «отгружена», что-то уехало — «в
 * работе». Отменённую не трогаем. Одна функция на оба пути отгрузки, чтобы
 * они не разошлись.
 */
export function statusAfterShipping(
  status: string,
  items: { quantity: number; shippedQuantity: number }[]
): string {
  if (status === "cancelled") return status;
  const allShipped = items.length > 0 && items.every((i) => i.shippedQuantity >= i.quantity);
  if (allShipped) return "shipped";
  if (items.some((i) => i.shippedQuantity > 0)) return "in_progress";
  return status;
}

// ---------------------------------------------------------------------------
// «Отгрузить всю заявку» — одним нажатием
//
// По журналу видно, как склад отгружал: заявка из девяти позиций — девять
// отдельных отгрузок, серии по десять записей с интервалом в минуту. На это
// уходило время, и отметку откладывали: 63 % отгрузок по живой базе отмечены
// уже после дня доставки. Теперь программа сама раскладывает всю заявку по
// партиям — от старых срезок к свежим (та же подсказка FIFO, что и в ручной
// отгрузке), а человек видит раскладку и подтверждает одним нажатием. Ручной
// выбор партий остаётся для случаев, когда нужно отдать не самую старую.
// ---------------------------------------------------------------------------

export interface WholeShipItem {
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  shippedQuantity: number;
}

export interface WholeShipBatch {
  batchId: string;
  flowerType: string;
  variety: string;
  grade: string;
  harvestDate: string;
  quantityRemaining: number;
}

export interface WholeShipPlan {
  lines: { itemId: string; parts: { batchId: string; quantity: number }[] }[];
  /** Сколько стеблей отгрузится. */
  total: number;
  /** Чего не хватает на складе: позиция и сколько стеблей. */
  shortages: { itemId: string; label: string; missing: number }[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function planWholeOrderShipment(items: WholeShipItem[], batches: WholeShipBatch[]): WholeShipPlan {
  const left = new Map(batches.map((b) => [b.batchId, Math.max(0, b.quantityRemaining)]));
  const lines: WholeShipPlan["lines"] = [];
  const shortages: WholeShipPlan["shortages"] = [];
  let total = 0;
  for (const item of items) {
    let need = Math.max(0, item.quantity - item.shippedQuantity);
    if (need === 0) continue;
    const pool = batches
      .filter(
        (b) =>
          b.flowerType === item.flowerType &&
          norm(b.variety) === norm(item.variety) &&
          norm(b.grade) === norm(item.grade) &&
          (left.get(b.batchId) ?? 0) > 0
      )
      .sort((a, b) => (a.harvestDate < b.harvestDate ? -1 : a.harvestDate > b.harvestDate ? 1 : 0));
    const parts: { batchId: string; quantity: number }[] = [];
    for (const b of pool) {
      if (need === 0) break;
      const take = Math.min(need, left.get(b.batchId) ?? 0);
      if (take <= 0) continue;
      parts.push({ batchId: b.batchId, quantity: take });
      left.set(b.batchId, (left.get(b.batchId) ?? 0) - take);
      need -= take;
      total += take;
    }
    if (parts.length > 0) lines.push({ itemId: item.itemId, parts });
    if (need > 0) shortages.push({ itemId: item.itemId, label: `${item.variety} ${item.grade}`, missing: need });
  }
  return { lines, total, shortages };
}
