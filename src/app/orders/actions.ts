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
import { setOrderDirection } from "@/lib/repo/orders";
import { MONEY_LOG_ACTIONS, ORDER_STATUSES, ROLES } from "@/lib/constants";

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

  // РОП заводит ТОЛЬКО региональные заявки. Алматы остаётся за менеджерами —
  // так решил владелец, и правило это не косметическое: заявка без
  // направления, оформленная РОПом, забрала бы у менеджера его же продажу.
  if (role === ROLES.SALES_HEAD && !direction) {
    throw new Error(
      "Заявки по Алматы оформляют менеджеры. Выберите направление отгрузки — " +
        "в регионы заявку заводите вы."
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
