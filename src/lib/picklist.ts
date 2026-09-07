import { listOrdersWithItems } from "./repo/orders";
import { listBatches } from "./repo/batches";
import { listUsers } from "./repo/users";
import { ORDER_STATUSES, getFarmFor } from "./constants";
import type { OrderWithItems } from "./types";

// ---------------------------------------------------------------------------
// Сводная заявка на день — рабочий документ склада.
//
// Собирается по дате доставки: сколько всего каждого сорта и длины нужно
// набрать за день (по этому листу зав. складом идёт к холодильнику), плюс
// разбивка по клиентам — чтобы разложить собранное по заявкам.
// ---------------------------------------------------------------------------

export interface PicklistLine {
  key: string;
  flowerType: string;
  variety: string;
  grade: string;
  /** Сколько нужно собрать всего по всем заявкам. */
  quantity: number;
  /** Сколько уже отгружено по этим заявкам. */
  shipped: number;
  /** Остаток на складе по этой позиции — видно нехватку сразу. */
  available: number;
  /** Разбивка «кому сколько» для этой позиции. */
  perOrder: { orderId: string; clientName: string; managerName: string; quantity: number }[];
}

export interface PicklistOrder {
  orderId: string;
  clientName: string;
  clientPhone: string;
  managerName: string;
  managerEmail: string;
  status: string;
  notes: string;
  /** Две «зелёные галочки»: менеджер согласовал и бухгалтер увидел деньги. */
  managerConfirmed: boolean;
  paid: boolean;
  readyToCollect: boolean;
  totalStems: number;
  totalAmount: number;
  items: { flowerType: string; variety: string; grade: string; quantity: number; shipped: number }[];
}

export interface Picklist {
  generatedAt: string;
  date: string;
  dateLabel: string;
  /** Производство, по которому собран лист (null — сводно по всем). */
  farm: string | null;
  totalOrders: number;
  totalStems: number;
  totalAmount: number;
  shortageStems: number;
  /** Сколько заявок дня ещё не готовы к сборке (нет обеих галочек). */
  notReadyOrders: number;
  notReadyStems: number;
  lines: PicklistLine[];
  orders: PicklistOrder[];
  /** Заявки без даты доставки — чтобы они не потерялись. */
  ordersWithoutDate: PicklistOrder[];
}

function toDateKey(value: string): string {
  if (!value) return "";
  // Дата доставки хранится как YYYY-MM-DD, дата создания — как ISO-строка.
  return value.length >= 10 ? value.slice(0, 10) : value;
}

export async function getPicklist(
  date: string,
  now: Date = new Date(),
  injected?: {
    orders: OrderWithItems[];
    batches: Awaited<ReturnType<typeof listBatches>>;
    users: Awaited<ReturnType<typeof listUsers>>;
  },
  /** Лист печатается для конкретного производства: в него попадает только его цветок. */
  farmFilter?: string | null
): Promise<Picklist> {
  const [orders, batches, users] = injected
    ? [injected.orders, injected.batches, injected.users]
    : await Promise.all([listOrdersWithItems(), listBatches(), listUsers()]);

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));

  const active = orders.filter(
    (o) => o.status !== ORDER_STATUSES.CANCELLED && o.status !== ORDER_STATUSES.SHIPPED
  );

  const forDate = active.filter((o) => toDateKey(o.deliveryDate) === date);
  const withoutDate = active.filter((o) => !o.deliveryDate);

  // Остатки на складе по каждой позиции.
  const stockByKey = new Map<string, number>();
  for (const b of batches) {
    if (b.quantityRemaining <= 0) continue;
    const key = `${b.flowerType}|${b.variety.trim().toLowerCase()}|${b.grade.trim().toLowerCase()}`;
    stockByKey.set(key, (stockByKey.get(key) ?? 0) + b.quantityRemaining);
  }

  const belongsToFarm = (flowerType: string) => !farmFilter || getFarmFor(flowerType) === farmFilter;

  const toPicklistOrder = (order: OrderWithItems): PicklistOrder => ({
    orderId: order.orderId,
    clientName: order.clientName,
    clientPhone: order.clientPhone,
    managerName: nameByEmail.get(order.managerEmail) ?? order.managerEmail,
    managerEmail: order.managerEmail,
    status: order.status,
    notes: order.notes,
    managerConfirmed: order.managerConfirmed,
    paid: order.paid,
    readyToCollect: order.managerConfirmed && order.paid,
    totalStems: order.items
      .filter((i) => belongsToFarm(i.flowerType))
      .reduce((sum, i) => sum + i.quantity, 0),
    totalAmount: order.totalAmount,
    items: order.items
      .filter((i) => belongsToFarm(i.flowerType))
      .map((i) => ({
        flowerType: i.flowerType,
        variety: i.variety,
        grade: i.grade,
        quantity: i.quantity,
        shipped: i.shippedQuantity,
      })),
  });

  // Сводка по позициям.
  const lineMap = new Map<string, PicklistLine>();
  for (const order of forDate) {
    const managerName = nameByEmail.get(order.managerEmail) ?? order.managerEmail;
    for (const item of order.items) {
      if (!belongsToFarm(item.flowerType)) continue;
      const key = `${item.flowerType}|${item.variety.trim().toLowerCase()}|${item.grade.trim().toLowerCase()}`;
      const line = lineMap.get(key) ?? {
        key,
        flowerType: item.flowerType,
        variety: item.variety,
        grade: item.grade,
        quantity: 0,
        shipped: 0,
        available: stockByKey.get(key) ?? 0,
        perOrder: [],
      };
      line.quantity += item.quantity;
      line.shipped += item.shippedQuantity;
      line.perOrder.push({
        orderId: order.orderId,
        clientName: order.clientName,
        managerName,
        quantity: item.quantity,
      });
      lineMap.set(key, line);
    }
  }

  const lines = Array.from(lineMap.values()).sort((a, b) => {
    if (a.flowerType !== b.flowerType) return a.flowerType.localeCompare(b.flowerType);
    if (a.variety !== b.variety) return a.variety.localeCompare(b.variety, "ru");
    return a.grade.localeCompare(b.grade, "ru");
  });

  const shortageStems = lines.reduce(
    (sum, l) => sum + Math.max(0, l.quantity - l.shipped - l.available),
    0
  );

  const picklistOrders = forDate
    .map(toPicklistOrder)
    .filter((o) => o.items.length > 0)
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "ru"));

  const [y, m, d] = date.split("-").map(Number);
  const dateLabel = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  });

  return {
    generatedAt: now.toISOString(),
    date,
    dateLabel,
    farm: farmFilter ?? null,
    totalOrders: picklistOrders.length,
    totalStems: lines.reduce((sum, l) => sum + l.quantity, 0),
    totalAmount: picklistOrders.reduce((sum, o) => sum + o.totalAmount, 0),
    notReadyOrders: picklistOrders.filter((o) => !o.readyToCollect).length,
    notReadyStems: picklistOrders
      .filter((o) => !o.readyToCollect)
      .reduce((sum, o) => sum + o.totalStems, 0),
    shortageStems,
    lines,
    orders: picklistOrders,
    ordersWithoutDate: withoutDate.map(toPicklistOrder).filter((o) => o.items.length > 0),
  };
}
