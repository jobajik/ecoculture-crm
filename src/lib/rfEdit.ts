import { FLOWER_TYPE_LABELS, MONEY_EPSILON, ORDER_STATUSES, ROLES, formatGrade, getFarmFor } from "./constants";
import { cleanDirection } from "./direction";
import { cleanDeliveryDate } from "./orderEdit";
import { isRegionOrder } from "./orderKind";
import { statusAfterReturn } from "./orderReturn";
import {
  RUB_DIRECTION,
  cleanRub,
  formatRub,
  planRubItems,
  rubComment,
  rubLinesRefusal,
  rubNote,
  rubTotal,
  type RubBatch,
  type RubItemPlan,
  type RubLineInput,
} from "./rubShipment";

/**
 * Отгрузки в РФ: увидеть, поправить, отменить (16.11.2026).
 *
 * Владелец: «Не пойму, почему заявку по РФ я нигде не вижу. Дай возможность видеть её, редактировать и прочее».
 * Заявка в базе была (№ SALMN, Диана, 10 000 хризантем), но в «Заявках» выглядела строкой «клиент · 0 ₸ · отгружена»:
 * ни слова «РФ», ни рублей. А поправить её было нельзя вовсе — отгруженную заявку правит только администратор, и
 * обычная форма правки про рубли не знает: цену в рублях в ней не видно и не изменить.
 *
 * «Отгрузка в РФ» здесь — любая заявка по региону с направлением «РФ»: и новая, с клиентом и рублёвыми ценами
 * (`rubShipment.ts`), и заведённая старой формой «Опт в регион» без цен (Разия 14.11 завела так 21 позицию) — в неё
 * правкой дописывают клиента и цены.
 *
 * Что правится:
 * - день отгрузки, клиент, комментарий, цена в рублях — у любой позиции;
 * - количество — только ВНИЗ: лишнее возвращается в те партии, из которых уехало (последние отгрузки первыми), в
 *   журнал отгрузок ложится строка с минусом — как при возврате (`orderReturn.ts`, грабли 1.16);
 * - больше цветка — не цифрой, а строкой «партия — количество — цена»: склад должен списать настоящий срез, а не
 *   «откуда-нибудь». Тот же сорт по той же цене дописывается в свою позицию, по другой цене — новой строкой;
 * - отмена целиком: всё отгруженное возвращается в партии, заявка становится отменённой, строки остаются — видно,
 *   что и сколько уезжало.
 *
 * Кто: администратор и РОП — любую; зав. складом — ту, где весь цветок её производства (грабли 1.1-ter). После того
 * как бухгалтер вписал поступления, правит только администратор, а отменить нельзя никому, пока сумма не убрана.
 *
 * Модуль чистый — проверка `scripts/check-rf-edit.ts`; запись одним атомарным запросом — `repo/rfEdit.ts`.
 */

export interface RfItem {
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  shippedQuantity: number;
  priceRub?: number;
}

export interface RfOrder {
  status: string;
  kind?: string;
  direction?: string;
  clientId: string;
  clientName: string;
  paidAmount: number;
  deliveryDate: string;
  notes: string;
  items: RfItem[];
}

/** Заявка по региону с направлением «РФ» — с рублями или без. */
export function isRfShipment(order: { kind?: string; direction?: string } | null | undefined): boolean {
  return isRegionOrder(order) && cleanDirection(order?.direction) === RUB_DIRECTION;
}

const label = (i: { flowerType: string; variety: string; grade: string }) =>
  `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType} ${i.variety} ${formatGrade(i.grade)}`;

/** Можно ли этому человеку править отгрузку. Пустая строка — можно. */
export function rfEditRefusal(
  order: RfOrder,
  role: string | null | undefined,
  farm: string | null | undefined
): string {
  if (!isRfShipment(order)) return "Это не отгрузка в РФ";
  if (order.status === ORDER_STATUSES.CANCELLED) return "Отгрузка отменена — править её нечего";
  if (role === ROLES.ADMIN) return "";
  if (role === ROLES.WAREHOUSE) {
    // Пустое производство закрывает, а не открывает (грабли 1.10).
    if (!farm) return "У вас не указано производство. Попросите администратора заполнить его в «Настройки → Сотрудники».";
    if (order.items.some((i) => getFarmFor(i.flowerType) !== farm)) {
      return "В этой отгрузке есть цветок другого производства — её правит администратор или руководитель отдела продаж";
    }
  } else if (role !== ROLES.SALES_HEAD) {
    return "Отгрузку в РФ правит зав. складом (свой цветок), руководитель отдела продаж или администратор";
  }
  if (order.paidAmount > MONEY_EPSILON) {
    return "Бухгалтер уже вписал поступления по этой отгрузке — поправить её теперь может администратор";
  }
  return "";
}

export interface RfEditInput {
  deliveryDate: string;
  /** Пусто — клиента не меняем (а если его не было и цен нет — так и остаётся без клиента). */
  clientId: string;
  comment: string;
  /** ВСЕ позиции отгрузки: количество (0 — убрать строку) и цена в рублях. */
  items: { itemId: string; quantity: number; priceRub: number }[];
  /** Дописать из партий. */
  add: RubLineInput[];
}

export interface RfLinePlan {
  was: RfItem;
  quantity: number;
  shipped: number;
  priceRub: number;
  /** Сколько отгруженных стеблей возвращается в партии. */
  backToStock: number;
  remove: boolean;
}

export interface RfEditPlan {
  deliveryDate: string;
  /** Новый клиент или null — не меняется. */
  client: { clientId: string; name: string; phone: string } | null;
  notes: string;
  lines: RfLinePlan[];
  /** Дописать в существующую позицию: тот же сорт по той же цене. */
  more: { itemId: string; quantity: number; parts: { batchId: string; quantity: number }[] }[];
  /** Новые позиции. */
  created: RubItemPlan[];
  newStatus: string;
  rubBefore: number;
  rubAfter: number;
  backToStock: number;
  added: number;
  /** Словами — для журнала и для ответа человеку. Пусто — ничего не изменилось. */
  describe: string[];
}

const MAX_PRICE = 100_000;
const nf = (n: number) => n.toLocaleString("ru-RU");

/**
 * Проверка и расчёт правки. Строка — отказ, объект — что записать. Проверяется именно присланное (грабли 1.11): чужая
 * позиция, дробные стебли, количество больше отгруженного и цена-опечатка отвергаются здесь, а не в форме.
 */
export function planRfEdit(input: {
  order: RfOrder;
  edit: RfEditInput;
  /** Карточка клиента по `edit.clientId` (как её прочитал сервер); null — не выбрана или не нашлась. */
  client: { clientId: string; name: string; phone?: string; active: boolean; retail?: string } | null;
  role: string | null | undefined;
  farm: string | null | undefined;
  batches: Map<string, RubBatch>;
  today: string;
}): RfEditPlan | string {
  const { order, edit } = input;
  const refusal = rfEditRefusal(order, input.role, input.farm);
  if (refusal) return refusal;

  const deliveryDate = cleanDeliveryDate(edit.deliveryDate);
  if (!deliveryDate) return "Укажите дату отгрузки";

  const sent = new Map<string, { quantity: number; priceRub: number }>();
  for (const raw of edit.items ?? []) {
    const itemId = String(raw.itemId || "").trim();
    if (!order.items.some((i) => i.itemId === itemId)) return "Позиция не из этой отгрузки — обновите страницу";
    if (sent.has(itemId)) return "Одна и та же позиция прислана дважды";
    sent.set(itemId, { quantity: Number(raw.quantity), priceRub: Number(raw.priceRub) });
  }

  const lines: RfLinePlan[] = [];
  for (const item of order.items) {
    const next = sent.get(item.itemId);
    // Позиции, которой в форме не было (её отгрузили, пока форма была открыта), не трогаем молча — просим обновить.
    if (!next) return "Состав отгрузки изменился, пока вы её правили — обновите страницу";
    const name = label(item);
    if (!Number.isFinite(next.quantity) || next.quantity < 0) return `${name}: укажите количество`;
    if (!Number.isInteger(next.quantity)) return `${name}: количество считается в стеблях, целым числом`;
    if (next.quantity > item.quantity) {
      return `${name}: было ${nf(item.quantity)} шт. Чтобы добавить, выберите партию в блоке «Добавить из партий» — так со склада спишется нужный срез`;
    }
    if (!Number.isFinite(next.priceRub) || next.priceRub < 0) return `${name}: цена в рублях указана неверно`;
    if (next.priceRub > MAX_PRICE) return `${name}: цена ${next.priceRub} ₽ за стебель — похоже на опечатку`;
    lines.push({
      was: item,
      quantity: next.quantity,
      shipped: Math.min(item.shippedQuantity, next.quantity),
      priceRub: cleanRub(next.priceRub),
      backToStock: Math.max(0, item.shippedQuantity - next.quantity),
      remove: next.quantity === 0,
    });
  }

  const add = (edit.add ?? []).map((l) => ({ batchId: String(l.batchId || ""), quantity: Number(l.quantity), priceRub: cleanRub(Number(l.priceRub)) }));
  if (add.length > 0) {
    const addRefusal = rubLinesRefusal({ role: input.role, farm: input.farm, lines: add, batches: input.batches });
    if (addRefusal) return addRefusal;
  }
  const more: RfEditPlan["more"] = [];
  const created: RubItemPlan[] = [];
  for (const item of planRubItems(add, input.batches)) {
    const same = lines.find(
      (l) => !l.remove && l.was.flowerType === item.flowerType && l.was.variety === item.variety && l.was.grade === item.grade && l.priceRub === item.priceRub
    );
    if (same) more.push({ itemId: same.was.itemId, quantity: item.quantity, parts: item.parts });
    else created.push(item);
  }

  // Что получится: оставшиеся позиции с дописанным и новые (они отгружены целиком — из партий).
  const after = [
    ...lines
      .filter((l) => !l.remove)
      .map((l) => {
        const extra = more.filter((m) => m.itemId === l.was.itemId).reduce((s, m) => s + m.quantity, 0);
        return { name: label(l.was), quantity: l.quantity + extra, shippedQuantity: l.shipped + extra, priceRub: l.priceRub };
      }),
    ...created.map((c) => ({ name: label(c), quantity: c.quantity, shippedQuantity: c.quantity, priceRub: c.priceRub })),
  ];
  if (after.length === 0) {
    return "В отгрузке не осталось ни одной позиции. Если она не состоялась — нажмите «Отменить отгрузку»: цветок вернётся на склад";
  }

  // Рубли — у всех позиций или ни у одной. «Ни у одной» — только там, где их и не было (старый объём на РФ).
  const hadPrices = order.items.some((i) => (i.priceRub ?? 0) > 0);
  const priced = after.filter((i) => i.priceRub > 0);
  if (hadPrices || priced.length > 0) {
    const empty = after.find((i) => !(i.priceRub > 0));
    if (empty) return `${empty.name}: укажите цену в рублях`;
  }

  // Клиент: у рублёвой отгрузки он обязателен (решение владельца: «на клиента из базы»), убрать его нельзя.
  let client: RfEditPlan["client"] = null;
  const asked = String(edit.clientId || "").trim();
  if (asked && asked !== order.clientId) {
    if (!input.client || input.client.clientId !== asked) return "Клиент не найден — выберите из списка";
    if (!input.client.active) return "Карточка этого клиента выключена — выберите другого или попросите администратора включить её";
    if ((input.client.retail || "").trim()) return "Это наш магазин, а не покупатель — для него есть заявка в магазин";
    client = { clientId: input.client.clientId, name: input.client.name, phone: input.client.phone || "" };
  }
  if (!asked && order.clientId) return "Выберите клиента из базы";
  if (priced.length > 0 && !asked) return "У отгрузки с ценами в рублях должен быть клиент — выберите его из базы";

  const allShipped = after.every((i) => i.shippedQuantity >= i.quantity);
  if (allShipped && deliveryDate > input.today) return "Отгрузка уже состоялась — её дата не может быть в будущем";

  const rubBefore = rubTotal(order.items);
  const rubAfter = rubTotal(after);
  const comment = String(edit.comment ?? "").trim().slice(0, 300);
  const notes = priced.length > 0 ? rubNote(rubAfter, comment) : comment;

  const describe: string[] = [];
  if (deliveryDate !== order.deliveryDate) describe.push(`день отгрузки: ${order.deliveryDate || "—"} → ${deliveryDate}`);
  if (client) describe.push(`клиент: ${order.clientId ? order.clientName : "не был указан"} → ${client.name}`);
  for (const l of lines) {
    const name = `${l.was.variety} ${formatGrade(l.was.grade)}`;
    const back = l.backToStock > 0 ? ` (${nf(l.backToStock)} шт. вернули на склад)` : "";
    if (l.remove) describe.push(`${name}: убрана${back}`);
    else {
      if (l.quantity !== l.was.quantity) describe.push(`${name}: ${nf(l.was.quantity)} → ${nf(l.quantity)} шт.${back}`);
      if (l.priceRub !== cleanRub(l.was.priceRub ?? 0)) {
        describe.push(`${name}: цена ${(l.was.priceRub ?? 0) > 0 ? formatRub(l.was.priceRub ?? 0) : "не была указана"} → ${formatRub(l.priceRub)}`);
      }
    }
  }
  for (const item of planRubItems(add, input.batches)) {
    describe.push(`добавлено: ${item.variety} ${formatGrade(item.grade)} — ${nf(item.quantity)} шт. по ${formatRub(item.priceRub)}`);
  }
  if (rubComment(order.notes) !== comment) describe.push(comment ? `комментарий: ${comment}` : "комментарий убран");
  if (describe.length > 0 && rubAfter !== rubBefore) describe.push(`сумма: ${formatRub(rubBefore)} → ${formatRub(rubAfter)}`);

  return {
    deliveryDate,
    client,
    notes,
    lines,
    more,
    created,
    newStatus: statusAfterReturn(order.status, after),
    rubBefore,
    rubAfter,
    backToStock: lines.reduce((s, l) => s + l.backToStock, 0),
    added: add.reduce((s, l) => s + l.quantity, 0),
    describe,
  };
}

export interface RfCancelPlan {
  /** Сколько вернуть в партии по каждой позиции — всё отгруженное. */
  lines: { itemId: string; variety: string; backToStock: number }[];
  backToStock: number;
  describe: string;
}

const MIN_REASON = 5;

/** Отмена отгрузки целиком: всё уехавшее возвращается в партии. Строка — отказ. */
export function planRfCancel(input: {
  order: RfOrder;
  role: string | null | undefined;
  farm: string | null | undefined;
  reason: string;
}): RfCancelPlan | string {
  const { order } = input;
  // Сначала деньги: отменённая отгрузка с вписанными поступлениями — это деньги ни за что (как у обычной заявки).
  if (isRfShipment(order) && order.status !== ORDER_STATUSES.CANCELLED && order.paidAmount > MONEY_EPSILON) {
    return "По отгрузке вписаны поступления. Сначала бухгалтер убирает сумму, потом отгрузку можно отменить";
  }
  const refusal = rfEditRefusal(order, input.role, input.farm);
  if (refusal) return refusal;
  const reason = String(input.reason ?? "").trim();
  if (reason.length < MIN_REASON) return "Напишите причину отмены: через месяц по ней будут разбирать, куда делся цветок";
  const lines = order.items
    .filter((i) => i.shippedQuantity > 0)
    .map((i) => ({ itemId: i.itemId, variety: `${i.variety} ${formatGrade(i.grade)}`, backToStock: i.shippedQuantity }));
  const backToStock = lines.reduce((s, l) => s + l.backToStock, 0);
  return {
    lines,
    backToStock,
    describe: `Отгрузка в РФ отменена${backToStock > 0 ? `, ${nf(backToStock)} шт. вернули на склад` : ""} · причина: ${reason}`,
  };
}

/** Сводка по списку отгрузок в РФ — строка над списком «Заявки → РФ». */
export function rfSummary(orders: { status: string; paidAmount: number; items: { quantity: number; priceRub?: number }[] }[]): {
  count: number;
  stems: number;
  rub: number;
  income: number;
  noPrices: number;
} {
  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED);
  return {
    count: live.length,
    stems: live.reduce((s, o) => s + o.items.reduce((n, i) => n + i.quantity, 0), 0),
    rub: cleanRub(live.reduce((s, o) => s + rubTotal(o.items), 0)),
    income: live.reduce((s, o) => s + (o.paidAmount || 0), 0),
    noPrices: live.filter((o) => !o.items.some((i) => (i.priceRub ?? 0) > 0)).length,
  };
}
