"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import {
  createOrder,
  deleteOrder,
  getOrderById,
  saveOrderItems,
  setOrderManagerConfirmed,
  updateOrderHeader,
  type NewOrderInput,
  updateOrderStatus,
} from "@/lib/repo/orders";
import { logMoney } from "@/lib/repo/moneyLog";
import { cancelRefusal } from "@/lib/orderRules";
import { deleteOrderRefusal, describeDeletedOrder } from "@/lib/orderDelete";
import { listShipments } from "@/lib/repo/shipments";
import { listClaims } from "@/lib/repo/claims";
import {
  cleanDeliveryDate,
  describeItemChanges,
  editHeaderRefusal,
  editItemsRefusal,
  editedItemsRefusal,
  type EditedItem,
} from "@/lib/orderEdit";
import { getClientById } from "@/lib/repo/clients";
import { canFillRegions, canOrderForShop, isOwnShop, isRetailRole } from "@/lib/retail";
import {
  cleanDirection,
  directionEditRefusal,
  directionFor,
  directionRefusal,
} from "@/lib/direction";
import {
  canFillRegionOrders,
  isRegionOrder,
  regionIncomeRefusal,
  regionOrderRefusal,
} from "@/lib/orderKind";
import { setOrderPayment } from "@/lib/repo/orders";
import { setOrderDirection } from "@/lib/repo/orders";
import { MONEY_EPSILON, MONEY_LOG_ACTIONS, ORDER_KINDS, ORDER_STATUSES, ROLES } from "@/lib/constants";
import { guard } from "@/lib/actionResult";

async function createOrderActionInner(input: Omit<NewOrderInput, "managerEmail">) {
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

  // Направление отгрузки ставит МЕНЕДЖЕР САМ — так решил владелец. Раньше это
  // была работа РОПа, и выходило глупо: менеджер договорился с клиентом из
  // Бишкека, а в план отгрузок заявка попадала только после того, как РОП это
  // заметит и пометит вручную. Форма подставляет направление по городу клиента
  // («Бишкек» → «Киргизия»), менеджер может поправить.
  //
  // У перемещения в наш магазин направления не бывает. Присланное теми, у кого
  // его не бывает вовсе (розница, склад), МОЛЧА отбрасывается, а не отвергается:
  // их формы про это поле не знают, но общий код заявки может его донести, и
  // отказ тогда упирался бы в поле, которого человек не видит.
  const direction = directionFor(role, input.direction);
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
 * Правка уже оформленной заявки менеджером.
 *
 * До неё исправить ошибку в заявке было нельзя вовсе: забыл дату доставки,
 * ошибся в количестве, клиент попросил добавить позицию — и оставалось отменить
 * заявку и завести заново либо править Google-таблицу руками, в обход всех
 * проверок. Владелец попросил дать нормальный путь.
 *
 * Все границы — в `src/lib/orderEdit.ts`, чистыми функциями под тестом: кто
 * правит, до какого момента, и что вообще можно прислать. Здесь остаётся
 * последовательность и след в журнале.
 */
async function updateOrderActionInner(
  orderId: string,
  input: {
    deliveryDate: string;
    clientPhone?: string;
    notes?: string;
    /** Не передан — позиции не трогаем вовсе (их могли и не показать). */
    items?: EditedItem[];
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  const email = session.user.email.toLowerCase();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const headerRefusal = editHeaderRefusal(order, role, email);
  if (headerRefusal) throw new Error(headerRefusal);

  const region = isRegionOrder(order);
  const deliveryDate = cleanDeliveryDate(input.deliveryDate);
  if (input.deliveryDate.trim() && !deliveryDate) {
    throw new Error("Дата доставки указана неверно");
  }
  // У городской заявки день отгрузки — это вся её суть: по нему она попадает в
  // план недели. Пустой он там значит «объём никуда не отнесён».
  if (region && !deliveryDate) throw new Error("Укажите день отгрузки");

  const before = order.totalAmount;
  let changes: string[] = [];
  let unconfirmed = false;

  if (input.items) {
    const itemsRefusal = editItemsRefusal(order, role, email);
    if (itemsRefusal) throw new Error(itemsRefusal);

    const next = input.items.map((item) => ({
      itemId: (item.itemId || "").trim(),
      flowerType: item.flowerType,
      variety: (item.variety || "").trim(),
      grade: (item.grade || "").trim(),
      quantity: Math.round(Number(item.quantity)),
      // Цены у городской заявки нет по замыслу: ноль здесь — не «забыли
      // заполнить», а её природа. Присланное значение не проверяем, а стираем.
      unitPrice: region ? 0 : Math.round(Number(item.unitPrice) * 100) / 100,
    }));

    const refusal = editedItemsRefusal({ current: order.items, next, region });
    if (refusal) throw new Error(refusal);

    changes = describeItemChanges({ current: order.items, next, region });
    if (changes.length > 0) {
      await saveOrderItems(
        orderId,
        next.map((item) => ({
          ...item,
          flowerType: item.flowerType as NewOrderInput["items"][number]["flowerType"],
        }))
      );

      // Состав изменился — подтверждение менеджера снимается. Так решил
      // владелец: склад видит «✓» и собирает по нему, а подтверждён был другой
      // состав. Согласиться с новым менеджер должен осознанно.
      if (order.managerConfirmed) {
        await setOrderManagerConfirmed(orderId, false);
        unconfirmed = true;
      }
    }
  }

  // Пишем только те поля, которые правка ДЕЙСТВИТЕЛЬНО прислала. Иначе форма,
  // где телефона и комментария нет вовсе (городская заявка, заявка в наш
  // магазин), молча стёрла бы их значения: «не прислали» превратилось бы в
  // «прислали пустое».
  await updateOrderHeader(orderId, {
    deliveryDate,
    ...(!region && input.clientPhone !== undefined ? { clientPhone: input.clientPhone.trim() } : {}),
    ...(!region && input.notes !== undefined ? { notes: input.notes.trim() } : {}),
  });

  // В журнал идёт только то, что меняет ДЕНЬГИ. Дописанная дата доставки —
  // это доведение заявки до ума, а не событие, о котором через месяц спорят;
  // заваливать ими журнал бухгалтера значит сделать его нечитаемым.
  const after = await getOrderById(orderId);
  const total = after?.totalAmount ?? before;
  if (Math.abs(total - before) > MONEY_EPSILON) {
    await logMoney({
      actorEmail: email,
      orderId,
      action: MONEY_LOG_ACTIONS.ORDER_EDITED,
      details: `${changes.join("; ")}${unconfirmed ? " · подтверждение снято" : ""}`,
      amountBefore: before,
      amountAfter: total,
    });
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/warehouse");
  revalidatePath("/retail");
  revalidatePath("/plans/regions");
  revalidatePath("/analytics");

  return { changes, unconfirmed };
}

/**
 * Проставить (или поправить) направление уже оформленной заявке.
 *
 * Два случая, и оба настоящие: менеджер забыл выбрать направление или выбрал не
 * то — правит у себя на заявке; РОП досматривает базу и помечает то, что
 * осталось без направления, одним нажатием в своём разделе.
 *
 * Кто и какую заявку может трогать — `directionEditRefusal()`: менеджер только
 * свою, РОП и администратор любую, а городскую и магазинную не трогает никто.
 */
async function setOrderDirectionActionInner(orderId: string, direction: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const clean = cleanDirection(direction);
  const refusal = directionEditRefusal({
    role: session.user.role,
    actorEmail: session.user.email,
    orderManagerEmail: order.managerEmail,
    direction: clean,
    isShop: Boolean((order.retail || "").trim()),
    isRegion: isRegionOrder(order),
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
async function cancelOrderActionInner(orderId: string, reason: string) {
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
 * Удаление заявки СОВСЕМ — только администратору и только «чистой».
 *
 * Обычный путь — отмена: заявка остаётся в базе, помечается отменённой и
 * выходит из выручки, долгов и бонусов. Но заявку, заведённую по ошибке или
 * дважды, отмена не убирает — она копится в списках и каждый раз заставляет
 * вспоминать, что это было. Владелец попросил дать возможность убирать такие
 * совсем.
 *
 * Вернуть удалённое НЕЛЬЗЯ: в Google-таблице нет корзины. Поэтому границы —
 * в `src/lib/orderDelete.ts`, чистой функцией под тестом, а здесь остаётся
 * порядок действий и запись в журнал.
 */
async function deleteOrderActionInner(orderId: string, reason: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  // Отгрузки и рекламации читаем ЗДЕСЬ, а не доверяем присланному: правило
  // «по заявке ничего не происходило» держится именно на них (грабли 1.11).
  const [shipments, claims] = await Promise.all([listShipments(), listClaims()]);
  const refusal = deleteOrderRefusal({
    order,
    role: session.user.role,
    shipments: shipments.filter((s) => s.orderId === orderId).length,
    claims: claims.filter((c) => c.orderId === orderId).length,
    shippedStatus: ORDER_STATUSES.SHIPPED,
  });
  if (refusal) throw new Error(refusal);

  const why = (reason || "").trim();
  if (!why) throw new Error("Напишите, почему удаляете заявку");

  // Запись в журнал идёт ПОСЛЕ удаления: если удалить не получится, в журнале
  // не должно остаться следа о том, чего не было. Журнал только дописывается —
  // он и будет единственным, что останется от этой заявки.
  await deleteOrder(orderId);

  await logMoney({
    actorEmail: session.user.email,
    orderId,
    action: MONEY_LOG_ACTIONS.ORDER_DELETED,
    details: describeDeletedOrder({
      orderId,
      clientName: order.clientName,
      managerEmail: order.managerEmail,
      totalAmount: order.totalAmount,
      items: order.items,
      reason: why,
    }),
    amountBefore: order.totalAmount,
    amountAfter: 0,
  });

  revalidatePath("/orders");
  revalidatePath("/retail");
  revalidatePath("/warehouse");
  revalidatePath("/warehouse/picklist");
  revalidatePath("/finance");
  revalidatePath("/finance/log");
  revalidatePath("/plans/regions");
  revalidatePath("/sales");
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
async function createRegionOrderActionInner(input: {
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
async function setRegionIncomeActionInner(orderId: string, amount: number) {
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

// ---------------------------------------------------------------------------
// Обёртки: отказ ВОЗВРАЩАЕТСЯ, а не бросается.
//
// Next.js в боевой сборке подменяет текст любой брошенной ошибки на
// английскую заглушку, и человек вместо «сначала снимите оплату» видит абзац
// про Server Components. Возвращённое значение он не трогает — поэтому
// наружу смотрят эти обёртки, а вся работа осталась в функциях выше.
//
// Подробности и правило целиком — в src/lib/actionResult.ts.
// В браузере вызов оборачивается unwrap(); за этим следит
// scripts/check-action-refusals.ts.
// ---------------------------------------------------------------------------

export async function createOrderAction(...args: Parameters<typeof createOrderActionInner>) {
  return guard(() => createOrderActionInner(...args));
}

export async function updateOrderAction(...args: Parameters<typeof updateOrderActionInner>) {
  return guard(() => updateOrderActionInner(...args));
}

export async function setOrderDirectionAction(...args: Parameters<typeof setOrderDirectionActionInner>) {
  return guard(() => setOrderDirectionActionInner(...args));
}

export async function cancelOrderAction(...args: Parameters<typeof cancelOrderActionInner>) {
  return guard(() => cancelOrderActionInner(...args));
}

export async function deleteOrderAction(...args: Parameters<typeof deleteOrderActionInner>) {
  return guard(() => deleteOrderActionInner(...args));
}

export async function createRegionOrderAction(...args: Parameters<typeof createRegionOrderActionInner>) {
  return guard(() => createRegionOrderActionInner(...args));
}

export async function setRegionIncomeAction(...args: Parameters<typeof setRegionIncomeActionInner>) {
  return guard(() => setRegionIncomeActionInner(...args));
}
