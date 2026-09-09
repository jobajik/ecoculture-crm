import { appendRow, appendRows, readTable, rowToRecord, SHEET_TABS, updateWhere } from "../sheets";
import { generateId } from "../id";
import { toIsoDate, toIsoDateTime } from "../sheetDate";
import { MONEY_EPSILON, ORDER_STATUSES, type FlowerType, type OrderStatus } from "../constants";
import type { Order, OrderItem, OrderWithItems } from "../types";
import { addPriceHistoryEntry } from "./priceHistory";

/** Пустая ячейка = «нет». Отмеченной считается только явная TRUE/ДА/1. */
function toFlag(value: string | undefined): boolean {
  const v = (value ?? "").toString().trim().toUpperCase();
  return v === "TRUE" || v === "ДА" || v === "1" || v === "YES";
}

/**
 * Даты заявки приводятся к нормальному виду ПРИ ЧТЕНИИ — грабли 1.9-bis.
 *
 * Таблица отдаёт то, что отображается: у ячейки с числовым форматом дата
 * доставки приходит как «46274», а `new Date("46274")` — это 1 января 46274
 * года. Ровно это и показала страница заявки. Чинить в местах использования
 * бесполезно: их полтора десятка, и следующее забудут.
 *
 * Если дату разобрать не удалось, поле остаётся пустым: «даты нет» честнее
 * выдуманной, а по пустому полю сразу видно, что с ячейкой что-то не так.
 */
function toOrder(record: Record<string, string>): Order {
  return {
    orderId: record.OrderID,
    // Дата оформления не должна теряться совсем: по ней заявка попадает в
    // списки и периоды. Если разобрать не вышло — оставляем как записано.
    createdAt: toIsoDateTime(record.CreatedAt) || record.CreatedAt || "",
    managerEmail: (record.ManagerEmail || "").toLowerCase(),
    clientName: record.ClientName || "",
    clientPhone: record.ClientPhone || "",
    deliveryDate: toIsoDate(record.DeliveryDate),
    status: (record.Status || ORDER_STATUSES.NEW) as OrderStatus,
    notes: record.Notes || "",
    managerConfirmed: toFlag(record.ManagerConfirmed),
    managerConfirmedAt: toIsoDateTime(record.ManagerConfirmedAt),
    paid: toFlag(record.Paid),
    paidAt: toIsoDateTime(record.PaidAt),
    paymentMethod: record.PaymentMethod || "",
    accountantEmail: (record.AccountantEmail || "").toLowerCase(),
    paidAmount: toMoney(record.PaidAmount),
    promisedAt: toIsoDate(record.PromisedAt),
    collectionNote: record.CollectionNote || "",
  };
}

/** «1 200,50» и «1200.5» — одно и то же число. Пустая ячейка — ноль. */
function toMoney(value: string | undefined): number {
  const cleaned = String(value ?? "").replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toOrderItem(record: Record<string, string>): OrderItem {
  return {
    orderId: record.OrderID,
    itemId: record.ItemID,
    flowerType: (record.FlowerType || "rose") as FlowerType,
    variety: record.Variety || "",
    grade: record.Grade || "",
    quantity: Number(record.Quantity) || 0,
    unitPrice: Number(record.UnitPrice) || 0,
    shippedQuantity: Number(record.ShippedQuantity) || 0,
  };
}

export interface NewOrderItemInput {
  flowerType: FlowerType;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
}

export interface NewOrderInput {
  managerEmail: string;
  clientName: string;
  clientPhone: string;
  deliveryDate: string;
  notes?: string;
  items: NewOrderItemInput[];
}

export async function listOrdersWithItems(): Promise<OrderWithItems[]> {
  const [ordersTable, itemsTable] = await Promise.all([
    readTable(SHEET_TABS.ORDERS),
    readTable(SHEET_TABS.ORDER_ITEMS),
  ]);

  const orders = ordersTable.rows.map((row) => toOrder(rowToRecord(SHEET_TABS.ORDERS, row)));
  const items = itemsTable.rows.map((row) => toOrderItem(rowToRecord(SHEET_TABS.ORDER_ITEMS, row)));

  return orders
    .map((order) => {
      const orderItems = items.filter((i) => i.orderId === order.orderId);
      const totalAmount = orderItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      // Заявки, оплаченные ДО появления частичной оплаты, несут только галочку —
      // колонка PaidAmount у них пустая. Считаем их оплаченными целиком, иначе
      // после обновления вся прошлая выручка разом уехала бы в долги.
      const paidAmount =
        order.paidAmount > 0 ? order.paidAmount : order.paid ? totalAmount : 0;
      return { ...order, paidAmount, items: orderItems, totalAmount };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getOrderById(orderId: string): Promise<OrderWithItems | null> {
  const all = await listOrdersWithItems();
  return all.find((o) => o.orderId === orderId) ?? null;
}

export async function createOrder(input: NewOrderInput): Promise<string> {
  const orderId = generateId("ORD");
  const createdAt = new Date().toISOString();

  await appendRow(SHEET_TABS.ORDERS, {
    OrderID: orderId,
    CreatedAt: createdAt,
    ManagerEmail: input.managerEmail,
    ClientName: input.clientName,
    ClientPhone: input.clientPhone,
    DeliveryDate: input.deliveryDate,
    Status: ORDER_STATUSES.NEW,
    Notes: input.notes ?? "",
    ManagerConfirmed: "FALSE",
    ManagerConfirmedAt: "",
    Paid: "FALSE",
    PaidAt: "",
    PaymentMethod: "",
    AccountantEmail: "",
    PaidAmount: 0,
    PromisedAt: "",
    CollectionNote: "",
  });

  const itemRecords = input.items.map((item, idx) => ({
    OrderID: orderId,
    ItemID: `${orderId}-I${idx + 1}`,
    FlowerType: item.flowerType,
    Variety: item.variety,
    Grade: item.grade,
    Quantity: item.quantity,
    UnitPrice: item.unitPrice,
    ShippedQuantity: 0,
  }));
  await appendRows(SHEET_TABS.ORDER_ITEMS, itemRecords);

  // Фиксируем цены в историю — понадобится для аналитики динамики цен.
  const today = createdAt.slice(0, 10);
  for (const item of input.items) {
    await addPriceHistoryEntry({
      date: today,
      flowerType: item.flowerType,
      variety: item.variety,
      grade: item.grade,
      price: item.unitPrice,
    });
  }

  return orderId;
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<boolean> {
  return updateWhere(
    SHEET_TABS.ORDERS,
    (record) => record.OrderID === orderId,
    () => ({ Status: status })
  );
}

export async function updateOrderNotes(orderId: string, notes: string): Promise<boolean> {
  return updateWhere(
    SHEET_TABS.ORDERS,
    (record) => record.OrderID === orderId,
    () => ({ Notes: notes })
  );
}

/**
 * Записывает, сколько денег по заявке получено.
 *
 * Флаг `Paid` («вторая зелёная галочка») здесь не вводится руками, а СЧИТАЕТСЯ
 * из суммы: оплачено целиком — значит внесено не меньше суммы заявки. Так два
 * поля не могут разойтись, а разошедшись, они дали бы худший из возможных
 * споров: галочка стоит, а денег нет.
 *
 * Допуск в одну тенге — из-за округления при пересчёте заявки: без него заявка
 * зависла бы в долгах из-за копейки.
 */
export async function setOrderPayment(
  orderId: string,
  paidAmount: number,
  totalAmount: number,
  accountantEmail: string,
  paymentMethod = ""
): Promise<boolean> {
  const amount = Math.max(0, Math.round(paidAmount * 100) / 100);
  const fully = amount > 0 && amount >= totalAmount - MONEY_EPSILON;

  return updateWhere(
    SHEET_TABS.ORDERS,
    (record) => record.OrderID === orderId,
    (record) => ({
      PaidAmount: amount,
      Paid: fully ? "TRUE" : "FALSE",
      // Дату первой оплаты не перетираем: она отвечает на вопрос «когда пришли
      // деньги», а не «когда бухгалтер последний раз трогала строку».
      PaidAt: amount > 0 ? (record.PaidAt || "").trim() || new Date().toISOString() : "",
      PaymentMethod: amount > 0 ? paymentMethod || record.PaymentMethod || "" : "",
      AccountantEmail: accountantEmail,
    })
  );
}

/** Оплата целиком или снятие оплаты — частый случай, обёртка над суммой. */
export async function setOrderPaid(
  orderId: string,
  paid: boolean,
  accountantEmail: string,
  paymentMethod = "",
  totalAmount = 0
): Promise<boolean> {
  return setOrderPayment(
    orderId,
    paid ? totalAmount : 0,
    totalAmount,
    accountantEmail,
    paymentMethod
  );
}

/** Обещание клиента заплатить и заметка бухгалтера по взысканию. */
export async function setOrderPromise(
  orderId: string,
  promisedAt: string,
  note: string
): Promise<boolean> {
  return updateWhere(
    SHEET_TABS.ORDERS,
    (record) => record.OrderID === orderId,
    () => ({ PromisedAt: promisedAt, CollectionNote: note })
  );
}

/**
 * Пересчёт позиции заявки — количество и цена.
 *
 * Нужен для рекламации: клиент получил тысячу стеблей, двести пришли с браком,
 * платит за восемьсот. Отгруженное количество при этом НЕ меняется — цветок со
 * склада действительно уехал, и подчищать историю склада ради счёта нельзя.
 */
export async function updateOrderItemAmounts(
  itemId: string,
  quantity: number,
  unitPrice: number
): Promise<boolean> {
  return updateWhere(
    SHEET_TABS.ORDER_ITEMS,
    (record) => record.ItemID === itemId,
    () => ({
      Quantity: Math.max(0, Math.round(quantity)),
      UnitPrice: Math.max(0, Math.round(unitPrice * 100) / 100),
    })
  );
}

/** Первая «зелёная галочка»: менеджер согласовал заявку с клиентом окончательно. */
export async function setOrderManagerConfirmed(orderId: string, confirmed: boolean): Promise<boolean> {
  return updateWhere(
    SHEET_TABS.ORDERS,
    (record) => record.OrderID === orderId,
    () =>
      confirmed
        ? { ManagerConfirmed: "TRUE", ManagerConfirmedAt: new Date().toISOString() }
        : { ManagerConfirmed: "FALSE", ManagerConfirmedAt: "" }
  );
}

/** Увеличивает ShippedQuantity у конкретной позиции заявки. Используется при регистрации отгрузки. */
export async function incrementItemShippedQuantity(itemId: string, addQuantity: number): Promise<OrderItem | null> {
  let updatedRecord: Record<string, string> | null = null;
  await updateWhere(
    SHEET_TABS.ORDER_ITEMS,
    (record) => record.ItemID === itemId,
    (record) => {
      const newShipped = (Number(record.ShippedQuantity) || 0) + addQuantity;
      updatedRecord = { ...record, ShippedQuantity: String(newShipped) };
      return { ShippedQuantity: newShipped };
    }
  );
  return updatedRecord ? toOrderItem(updatedRecord) : null;
}

/** Пересчитывает статус заявки на основе того, сколько позиций отгружено полностью. */
export async function recomputeOrderStatusFromItems(orderId: string): Promise<void> {
  const order = await getOrderById(orderId);
  if (!order) return;
  if (order.status === ORDER_STATUSES.CANCELLED) return;

  const allShipped = order.items.length > 0 && order.items.every((i) => i.shippedQuantity >= i.quantity);
  const anyShipped = order.items.some((i) => i.shippedQuantity > 0);

  let nextStatus: OrderStatus = order.status;
  if (allShipped) nextStatus = ORDER_STATUSES.SHIPPED;
  else if (anyShipped) nextStatus = ORDER_STATUSES.IN_PROGRESS;

  if (nextStatus !== order.status) {
    await updateOrderStatus(orderId, nextStatus);
  }
}
