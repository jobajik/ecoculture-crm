import { appendRow, appendRows, readTable, rowToRecord, SHEET_TABS, updateWhere } from "../sheets";
import { generateId } from "../id";
import { ORDER_STATUSES, type FlowerType, type OrderStatus } from "../constants";
import type { Order, OrderItem, OrderWithItems } from "../types";
import { addPriceHistoryEntry } from "./priceHistory";

function toOrder(record: Record<string, string>): Order {
  return {
    orderId: record.OrderID,
    createdAt: record.CreatedAt,
    managerEmail: (record.ManagerEmail || "").toLowerCase(),
    clientName: record.ClientName || "",
    clientPhone: record.ClientPhone || "",
    deliveryDate: record.DeliveryDate || "",
    status: (record.Status || ORDER_STATUSES.NEW) as OrderStatus,
    notes: record.Notes || "",
  };
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
      return { ...order, items: orderItems, totalAmount };
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
