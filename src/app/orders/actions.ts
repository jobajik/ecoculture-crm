"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { createOrder, getOrderById, type NewOrderInput, updateOrderStatus } from "@/lib/repo/orders";
import { logMoney } from "@/lib/repo/moneyLog";
import { cancelRefusal } from "@/lib/orderRules";
import { getClientById } from "@/lib/repo/clients";
import { canFillRegions, canOrderForShop, isOwnShop, isRetailRole } from "@/lib/retail";
import { canSetDirection, cleanDirection, directionRefusal } from "@/lib/direction";
import {
  canFillRegionOrders,
  isRegionOrder,
  regionIncomeRefusal,
  regionOrderRefusal,
} from "@/lib/orderKind";
import { setOrderPayment } from "@/lib/repo/orders";
import { setOrderDirection } from "@/lib/repo/orders";
import { MONEY_LOG_ACTIONS, ORDER_KINDS, ORDER_STATUSES, ROLES } from "@/lib/constants";

export async function createOrderAction(input: Omit<NewOrderInput, "managerEmail">) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  // Зав. складом производства заводит заявки в регионы — пока так решил
  // владелец. Что именно ей разрешено, проверяется ниже по самой карточке.
  if (
    role !== ROLES.MANAGER &&
    role !== ROLES.ADMIN &&
    role !== ROLES.SALES_HEAD &&
    !isRetailRole(role) &&
    !canFillRegions(role)
  ) {
    throw new Error("Недостаточно прав: заявки создают менеджеры");
  }
  if (!input.items || input.items.length === 0) {
    throw new Error("Добавьте хотя бы одну позицию в заявку");
  }

  // На кого оформлена заявка — на клиента или на наш магазин, — решает КАРТОЧКА,
  // а не то, что прислал браузер (грабли 1.11). Отсюда же берётся направление
  // розницы: подставить его руками нельзя, иначе обычную продажу можно было бы
  // объявить внутренним перемещением и вывести из выручки и долгов.
  const client = input.clientId ? await getClientById(input.clientId) : null;
  if (!client) throw new Error("Выберите клиента из базы");

  const shop = isOwnShop(client);
  if (shop && !canOrderForShop(role, client)) {
    throw new Error("Это магазин другого направления");
  }
  if (!shop && (isRetailRole(role) || role === ROLES.WAREHOUSE)) {
    throw new Error("Эта роль оформляет заявки только на наши магазины");
  }

  // Направление отгрузки ставит только РОП, и только обычной заявке: у
  // перемещения в наш магазин направления не бывает. Проверка здесь, а не в
  // форме, — поле можно и не показать, а запрос всё равно придёт (грабли 1.11).
  const direction = cleanDirection(input.direction);
  const refusal = directionRefusal({ role, direction, isShop: shop });
  if (refusal) throw new Error(refusal);

  // РОП клиентских заявок не оформляет вовсе: его работа — объём на город,
  // и для неё есть своя форма (`createRegionOrderAction`). Раньше здесь стояла
  // проверка «РОПу можно, если выбрал направление» — это была моя попытка
  // приделать региональный опт к клиентской форме, и владелец её забраковал.
  if (role === ROLES.SALES_HEAD) {
    throw new Error(
      "Заявки на клиентов оформляют менеджеры. Объём в регион заводится в разделе «Регионы»."
    );
  }

  const orderId = await createOrder({
    ...input,
    retail: shop ? client.retail : "",
    direction,
    managerEmail: session.user.email,
  });
  revalidatePath("/orders");
  revalidatePath("/retail");
  revalidatePath("/plans/regions");
  return orderId;
}

/**
 * Проставить направление уже оформленной заявке.
 *
 * Нужно ровно для одного случая: заявка в регион пришла через менеджера, у
 * которого поля направления нет. РОП видит её в своём разделе отдельным
 * списком и помечает одним нажатием.
 */
export async function setOrderDirectionAction(orderId: string, direction: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (!canSetDirection(session.user.role)) {
    throw new Error("Направление отгрузки ставит руководитель отдела продаж");
  }

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const clean = cleanDirection(direction);
  const refusal = directionRefusal({
    role: session.user.role,
    direction: clean,
    isShop: Boolean((order.retail || "").trim()),
  });
  if (refusal) throw new Error(refusal);

  await setOrderDirection(orderId, clean);
  revalidatePath("/plans/regions");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}

/**
 * Отмена заявки — единственный способ поменять статус руками.
 *
 * Раньше здесь была `updateOrderStatusAction`, которая ставила ЛЮБОЙ статус,
 * ЛЮБОМУ залогиненному, в любой момент, и не проверяла даже, что переданная
 * строка — вообще статус. Кнопки в интерфейсе не было ни одной: то есть
 * функция была одновременно открытой дверью и недоделанной возможностью.
 * Клиент отказывается от заявки — обычное дело, и системе нужен для этого
 * честный путь, а не правка Google-таблицы руками.
 *
 * Правила отмены живут в `src/lib/orderRules.ts` и покрыты тестами.
 */
export async function cancelOrderAction(orderId: string, reason: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const refusal = cancelRefusal(order, session.user.role, session.user.email);
  if (refusal) throw new Error(refusal);

  if (!reason.trim()) throw new Error("Напишите, почему заявка отменяется");

  const amount = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  await updateOrderStatus(orderId, ORDER_STATUSES.CANCELLED);
  // Отмена убирает из выручки, долгов и бонусов целую заявку — такое обязано
  // оставлять след, иначе «куда делись деньги за сентябрь» не разобрать.
  await logMoney({
    actorEmail: session.user.email,
    orderId,
    action: MONEY_LOG_ACTIONS.ORDER_CANCELLED,
    details: reason.trim(),
    amountBefore: amount,
    amountAfter: 0,
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/warehouse");
  revalidatePath("/finance");
  revalidatePath("/analytics");
}

/**
 * Оптовый объём на город — заявка без клиента и без цены.
 *
 * Отдельное действие, а не ветка в `createOrderAction`: у этой заявки другой
 * состав полей (нет клиента, нет телефона, нет цены), другие права и другая
 * проверка. Ветка внутри чужого действия означала бы, что половина проверок
 * клиентской заявки выполняется вхолостую, а половина — мешает.
 */
export async function createRegionOrderAction(input: {
  direction: string;
  deliveryDate: string;
  items: { flowerType: string; variety: string; grade: string; quantity: number }[];
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;

  const direction = cleanDirection(input.direction);
  const refusal = regionOrderRefusal({
    role,
    direction,
    deliveryDate: input.deliveryDate,
    items: input.items,
  });
  if (refusal) throw new Error(refusal);

  const orderId = await createOrder({
    kind: ORDER_KINDS.REGION,
    direction,
    // Клиента нет — это и есть смысл такой заявки. В имени стоит город: по
    // спискам заявок человек должен понимать, о чём строка, не открывая её.
    clientId: "",
    clientName: direction,
    clientPhone: "",
    deliveryDate: input.deliveryDate,
    items: input.items.map((i) => ({
      flowerType: i.flowerType as NewOrderInput["items"][number]["flowerType"],
      variety: i.variety.trim(),
      grade: i.grade,
      quantity: i.quantity,
      // Цены нет по замыслу. Ноль здесь — не «забыли заполнить», а природа
      // заявки: город получает объём, а деньги подтверждаются отдельно.
      unitPrice: 0,
    })),
    managerEmail: session.user.email,
  });

  revalidatePath("/orders");
  revalidatePath("/plans/regions");
  return orderId;
}

/**
 * Сколько по этой городской заявке поступило денег. Вписывает бухгалтер.
 *
 * Сумма НЕ сверяется с суммой заявки: суммы у заявки нет — цены в позициях
 * тоже. Поэтому обычная панель оплаты здесь не годится: она считает долг как
 * «счёт минус внесено» и на нулевом счёте показала бы переплату.
 */
export async function setRegionIncomeAction(orderId: string, amount: number) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");
  if (!isRegionOrder(order)) {
    throw new Error("Это не заявка по региону — оплата проводится обычным порядком");
  }

  const refusal = regionIncomeRefusal({
    role: session.user.role,
    amount,
    status: order.status,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });
  if (refusal) throw new Error(refusal);

  const clean = Math.round(amount * 100) / 100;
  // Пишем в то же поле, что и обычную оплату: это «сколько денег пришло по
  // этой строке», и заводить ради городской заявки вторую колонку с тем же
  // смыслом значило бы получить два числа об одном и том же.
  //
  // Вторым числом передаём саму сумму: тогда флаг «оплачено» встанет верно и
  // заявка не будет вечно выглядеть недоплаченной. Долга по ней всё равно нет —
  // в расчёты долгов городские заявки не попадают вовсе.
  await setOrderPayment(orderId, clean, clean, session.user.email, "", []);

  await logMoney({
    actorEmail: session.user.email,
    orderId,
    action: MONEY_LOG_ACTIONS.PAYMENT,
    details: `Поступления по региону ${order.direction}: ${clean.toLocaleString("ru-RU")} ₸`,
    amountBefore: order.paidAmount,
    amountAfter: clean,
  });

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/plans/regions");
}
