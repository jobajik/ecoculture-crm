"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import {
  getOrderById,
  setOrderManagerConfirmed,
  setOrderPayment,
  setOrderPaymentByFarm,
  setOrderPromise,
  setOrderInvoiceSent,
  updateOrderItemAmounts,
  recomputeOrderStatusFromItems,
} from "@/lib/repo/orders";
import { createClaim, decideClaim, listClaims } from "@/lib/repo/claims";
import { logMoney } from "@/lib/repo/moneyLog";
import { confirmRefusal, moneyRefusal } from "@/lib/orderRules";
import { invoiceByFarm } from "@/lib/orderMoney";
import { isRetailOrder, isRetailRole } from "@/lib/retail";
import { isRegionOrder } from "@/lib/orderKind";
import { invoiceSentRefusal } from "@/lib/paymentStage";
import {
  CLAIM_REASONS,
  CLAIM_STATUSES,
  MONEY_LOG_ACTIONS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  ROLES,
} from "@/lib/constants";

/**
 * Заявка в наш магазин деньгами не сопровождается вовсе: счёта нет, платить
 * некому. Отметить по ней оплату значило бы создать выручку из воздуха.
 */
const RETAIL_MONEY_REFUSAL =
  "Это заявка в наш магазин — внутреннее перемещение. Оплата по ней не проводится.";

/** Деньгами распоряжается бухгалтер и администратор — больше никто. */
async function requireAccountant() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (session.user.role !== ROLES.ACCOUNTANT && session.user.role !== ROLES.ADMIN) {
    throw new Error("Недостаточно прав: деньгами по заявке распоряжается бухгалтер");
  }
  return session.user.email.toLowerCase();
}

/** Страницы, на которых цифры меняются вслед за деньгами. */
function refreshMoneyPages(orderId: string) {
  revalidatePath("/finance");
  revalidatePath("/finance/debts");
  revalidatePath("/finance/claims");
  revalidatePath("/finance/log");
  revalidatePath("/finance/report");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/warehouse/picklist");
  revalidatePath("/sales");
  revalidatePath("/analytics");
}

/**
 * Записывает полученную по заявке сумму. Оплата бывает частичной: клиент вносит
 * предоплату, потом остаток — поэтому здесь сумма, а не галочка. Галочку
 * «оплачено целиком» система ставит сама, когда сумма догоняет счёт.
 */
export async function setPaymentAction(
  orderId: string,
  paidAmount: number,
  paymentMethod: string
) {
  const email = await requireAccountant();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");
  if (isRetailOrder(order)) throw new Error(RETAIL_MONEY_REFUSAL);
  // По городской заявке счёта нет — деньги отмечаются отдельной суммой
  // поступлений на самой заявке, а не обычной оплатой по счёту.
  if (isRegionOrder(order)) {
    throw new Error(
      "Это объём на город: счёта по нему нет. Впишите поступившую сумму в блоке " +
        "«Поступления по городу» на самой заявке."
    );
  }

  // Снять оплату с ОТГРУЖЕННОЙ заявки — значит вернуть её в долги и в список
  // звонков, обнулить бонус менеджера за уже уехавший товар и убрать деньги из
  // календаря того дня. Если клиент вернул деньги, это рекламация, а не
  // «снятая галочка». По отменённой заявке денег быть не должно вовсе.
  const closed = moneyRefusal(order.status);
  if (closed && Number(paidAmount) < order.paidAmount) throw new Error(closed);

  const amount = Number(paidAmount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Сумма не может быть отрицательной");
  if (amount > 1_000_000_000) throw new Error("Слишком большая сумма");
  if (amount > 0 && paymentMethod && !PAYMENT_METHODS.includes(paymentMethod as never)) {
    throw new Error(`Неизвестный способ оплаты: ${paymentMethod}`);
  }

  const before = order.paidAmount;
  // Разбивку по компаниям пересчитываем пропорционально счёту: сумма внесена
  // одним числом, и оставить старую разбивку значило бы получить строку, где
  // «получено всего» не сходится с суммой по ТОО.
  await setOrderPayment(
    orderId,
    amount,
    order.totalAmount,
    email,
    amount > 0 ? paymentMethod : "",
    invoiceByFarm(order.items)
  );

  await logMoney({
    actorEmail: email,
    orderId,
    action: amount > 0 ? MONEY_LOG_ACTIONS.PAYMENT : MONEY_LOG_ACTIONS.PAYMENT_CLEARED,
    details:
      amount > 0
        ? `Получено ${Math.round(amount).toLocaleString("ru-RU")} ₸ из ${Math.round(
            order.totalAmount
          ).toLocaleString("ru-RU")} ₸${paymentMethod ? ` · ${paymentMethod}` : ""}`
        : "Оплата снята",
    amountBefore: before,
    amountAfter: amount,
  });

  refreshMoneyPages(orderId);
  return { ok: true };
}

/**
 * Оплата ПО КОМПАНИЯМ — для смешанной заявки.
 *
 * Розу и эустому продаёт Rose Farm, хризантему — Есентай Агро Хим, счёта два, и
 * клиент платит двумя переводами. Раньше здесь была одна общая сумма, и самый
 * частый случай — «одно ТОО деньги получило, второе ещё нет» — выглядел как
 * недоплата. Теперь бухгалтер отмечает каждую компанию отдельно, а «получено
 * всего» складывается из частей, а не вводится вторым числом: два поля,
 * отвечающие за одно и то же, рано или поздно разъезжаются.
 */
export async function setPaymentByFarmAction(
  orderId: string,
  byFarm: Record<string, number>,
  paymentMethod: string
) {
  const email = await requireAccountant();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const invoice = invoiceByFarm(order.items);
  if (invoice.length === 0) throw new Error("В заявке нет позиций");

  let amount = 0;
  const clean: Record<string, number> = {};
  for (const row of invoice) {
    const value = Number(byFarm[row.farm] ?? 0);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${row.farmLabel}: сумма не может быть отрицательной`);
    }
    if (value > 1_000_000_000) throw new Error(`${row.farmLabel}: слишком большая сумма`);
    clean[row.farm] = value;
    amount += value;
  }
  // Компания, которой в заявке нет, оплаты получить не может: иначе деньги
  // ушли бы в колонку ТОО, у которого по этой заявке счёта нет вовсе.
  for (const farm of Object.keys(byFarm)) {
    if (!invoice.some((row) => row.farm === farm)) {
      throw new Error("Этой компании в заявке нет");
    }
  }

  const closed = moneyRefusal(order.status);
  if (closed && amount < order.paidAmount) throw new Error(closed);

  if (amount > 0 && paymentMethod && !PAYMENT_METHODS.includes(paymentMethod as never)) {
    throw new Error(`Неизвестный способ оплаты: ${paymentMethod}`);
  }

  const before = order.paidAmount;
  await setOrderPaymentByFarm(
    orderId,
    clean,
    invoice,
    order.totalAmount,
    email,
    amount > 0 ? paymentMethod : ""
  );

  await logMoney({
    actorEmail: email,
    orderId,
    action: amount > 0 ? MONEY_LOG_ACTIONS.PAYMENT : MONEY_LOG_ACTIONS.PAYMENT_CLEARED,
    details:
      amount > 0
        ? `Получено ${invoice
            .map(
              (row) =>
                `${row.farmLabel} ${Math.round(clean[row.farm] ?? 0).toLocaleString(
                  "ru-RU"
                )} из ${Math.round(row.amount).toLocaleString("ru-RU")} ₸`
            )
            .join(" · ")}${paymentMethod ? ` · ${paymentMethod}` : ""}`
        : "Оплата снята",
    amountBefore: before,
    amountAfter: amount,
  });

  refreshMoneyPages(orderId);
  return { ok: true };
}

/** Оплата целиком или снятие оплаты — то же действие, но одной кнопкой. */
export async function setPaidAction(orderId: string, paid: boolean, paymentMethod: string) {
  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");
  return setPaymentAction(orderId, paid ? order.totalAmount : 0, paymentMethod);
}

/**
 * Обещание клиента заплатить. Нужно ради списка «кому звонить сегодня»: без
 * даты в нём каждый день висят одни и те же люди, и звонить перестают всем.
 */
/**
 * Отметка «счёт отправлен клиенту».
 *
 * Нужна потому, что «не оплачено» отвечало сразу на два разных вопроса: счёт
 * ещё не выставили или клиент тянет с деньгами. Бухгалтер видела одну и ту же
 * строку, а разговор с клиентом в этих случаях противоположный.
 *
 * Ставит только бухгалтер — так решил владелец. Дата первой отправки не
 * перетирается повторным нажатием: она отвечает на вопрос «когда мы вообще про
 * эти деньги напоминали».
 */
export async function setInvoiceSentAction(orderId: string, sent: boolean) {
  const email = await requireAccountant();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const session = await getServerSession(authOptions);
  const refusal = invoiceSentRefusal({
    role: session?.user?.role,
    order,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });
  if (refusal) throw new Error(refusal);

  await setOrderInvoiceSent(orderId, sent);

  // В журнал это идёт наравне с оплатой: «счёт отправляли?» — первый вопрос
  // при разборе долга, и отвечать на него по памяти нельзя.
  await logMoney({
    actorEmail: email,
    orderId,
    action: MONEY_LOG_ACTIONS.INVOICE_SENT,
    details: sent ? "Счёт отправлен клиенту" : "Отметка об отправке счёта снята",
    amountBefore: order.totalAmount,
    amountAfter: order.totalAmount,
  });

  refreshMoneyPages(orderId);
}

export async function setPromiseAction(orderId: string, promisedAt: string, note: string) {
  const email = await requireAccountant();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const date = (promisedAt || "").trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Неверная дата обещания");
  const text = (note || "").trim().slice(0, 500);

  await setOrderPromise(orderId, date, text);
  await logMoney({
    actorEmail: email,
    orderId,
    action: MONEY_LOG_ACTIONS.PROMISE,
    details: date
      ? `Обещал заплатить до ${new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU")}${
          text ? ` · ${text}` : ""
        }`
      : "Обещание снято",
    amountBefore: order.totalAmount - order.paidAmount,
    amountAfter: order.totalAmount - order.paidAmount,
  });

  revalidatePath("/finance");
  revalidatePath("/finance/debts");
  revalidatePath("/finance/log");
  return { ok: true };
}

export interface RecalcItemInput {
  itemId: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Пересчёт заявки бухгалтером — то самое «отозвать по рекламации».
 *
 * Клиент получил тысячу стеблей, двести пришли с браком: количество в заявке
 * становится восемьсот, сумма пересчитывается, долг и бонус менеджера едут
 * следом. Отгруженное количество НЕ трогаем — цветок со склада действительно
 * уехал, и подчищать историю склада ради счёта нельзя.
 *
 * Причина обязательна: пересчёт без объяснения через месяц выглядит как ошибка
 * в данных, и разбираться в нём будет некому.
 */
export async function recalculateOrderAction(
  orderId: string,
  items: RecalcItemInput[],
  reason: string,
  /** Рекламация, из-за которой пересчитываем. Она закроется как проведённая. */
  claimId?: string
) {
  const email = await requireAccountant();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");
  if (order.status === ORDER_STATUSES.CANCELLED) {
    throw new Error("Заявка отменена — пересчитывать нечего");
  }

  const why = (reason || "").trim();
  if (!why) throw new Error("Напишите, почему пересчитываете заявку");

  const byId = new Map(order.items.map((i) => [i.itemId, i]));
  const changes: string[] = [];

  for (const input of items) {
    const item = byId.get(input.itemId);
    if (!item) throw new Error("Позиция не из этой заявки");

    const quantity = Math.round(Number(input.quantity));
    const unitPrice = Math.round(Number(input.unitPrice) * 100) / 100;
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Количество не может быть отрицательным");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Цена не может быть отрицательной");
    if (quantity > 10_000_000) throw new Error("Слишком большое количество");

    if (quantity === item.quantity && unitPrice === item.unitPrice) continue;

    const parts: string[] = [];
    if (quantity !== item.quantity) parts.push(`${item.quantity} → ${quantity} шт`);
    if (unitPrice !== item.unitPrice) parts.push(`${item.unitPrice} → ${unitPrice} ₸`);
    changes.push(`${item.variety} ${item.grade}: ${parts.join(", ")}`);

    await updateOrderItemAmounts(input.itemId, quantity, unitPrice);
  }

  if (changes.length === 0 && !claimId) throw new Error("Ничего не изменилось");

  // Сумма упала — заявка могла стать оплаченной целиком (или переплаченной).
  // Флаг «оплачено» пересчитываем всегда, иначе он остался бы от старой суммы.
  const after = await getOrderById(orderId);
  const newTotal = after?.totalAmount ?? order.totalAmount;
  await setOrderPayment(
    orderId,
    order.paidAmount,
    newTotal,
    email,
    order.paymentMethod,
    invoiceByFarm(after?.items ?? order.items)
  );

  // Статус тоже обязан пересчитаться. Без этого заявка застревала:
  // уменьшили заказ ниже уже отгруженного — она вечно висела у зав. складом
  // в «Можно отгружать», хотя отгружать нечего; увеличили после отгрузки —
  // заявка осталась «отгружена», выпала из склада, и дослать было нечем.
  await recomputeOrderStatusFromItems(orderId);

  await logMoney({
    actorEmail: email,
    orderId,
    action: MONEY_LOG_ACTIONS.RECALCULATED,
    details: `${why}${changes.length > 0 ? ` · ${changes.join("; ")}` : ""}`,
    amountBefore: order.totalAmount,
    amountAfter: newTotal,
  });

  if (claimId) {
    await decideClaim(claimId, CLAIM_STATUSES.ACCEPTED, email, why);
    await logMoney({
      actorEmail: email,
      orderId,
      action: MONEY_LOG_ACTIONS.CLAIM_ACCEPTED,
      details: why,
      amountBefore: order.totalAmount,
      amountAfter: newTotal,
    });
  }

  refreshMoneyPages(orderId);
  return {
    ok: true,
    totalBefore: order.totalAmount,
    totalAfter: newTotal,
    /** Сколько денег теперь лишние — их придётся вернуть или зачесть. */
    overpaid: Math.max(0, order.paidAmount - newTotal),
  };
}

/**
 * Рекламацию заводит МЕНЕДЖЕР по своей заявке: клиент жалуется ему, а не
 * бухгалтеру. Так решил владелец — тогда видно, кто попросил и кто разрешил.
 */
export async function createClaimAction(orderId: string, reason: string, comment: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");

  const role = session.user.role;
  if (role !== ROLES.MANAGER && role !== ROLES.ADMIN) {
    throw new Error("Рекламацию заводит менеджер по своей заявке");
  }

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const email = session.user.email.toLowerCase();
  if (role === ROLES.MANAGER && order.managerEmail !== email) {
    throw new Error("Это заявка другого менеджера");
  }
  if (order.status === ORDER_STATUSES.CANCELLED) {
    throw new Error("Заявка отменена — рекламация ей не нужна");
  }

  if (!CLAIM_REASONS.includes(reason as never)) throw new Error("Выберите причину из списка");
  const text = (comment || "").trim().slice(0, 1000);
  if (!text) throw new Error("Опишите, что именно не так — бухгалтеру нужно основание");

  // Второй открытой рекламации по заявке быть не должно: иначе бухгалтер
  // пересчитает заявку дважды по одному и тому же поводу.
  const open = (await listClaims()).find(
    (c) => c.orderId === orderId && c.status === CLAIM_STATUSES.NEW
  );
  if (open) throw new Error("По этой заявке уже есть рекламация, она ждёт решения бухгалтера");

  const claimId = await createClaim({ orderId, managerEmail: email, reason, comment: text });

  await logMoney({
    actorEmail: email,
    orderId,
    action: MONEY_LOG_ACTIONS.CLAIM_CREATED,
    details: `${reason}: ${text}`,
    amountBefore: order.totalAmount,
    amountAfter: order.totalAmount,
  });

  refreshMoneyPages(orderId);
  return { ok: true, claimId };
}

/** Отклонение рекламации бухгалтером: сумма заявки не меняется. */
export async function rejectClaimAction(claimId: string, decision: string) {
  const email = await requireAccountant();

  const claim = (await listClaims()).find((c) => c.claimId === claimId);
  if (!claim) throw new Error("Рекламация не найдена");
  if (claim.status !== CLAIM_STATUSES.NEW) throw new Error("По этой рекламации уже есть решение");

  const text = (decision || "").trim().slice(0, 1000);
  if (!text) throw new Error("Напишите, почему отклоняете — менеджер должен это увидеть");

  const order = await getOrderById(claim.orderId);
  await decideClaim(claimId, CLAIM_STATUSES.REJECTED, email, text);
  await logMoney({
    actorEmail: email,
    orderId: claim.orderId,
    action: MONEY_LOG_ACTIONS.CLAIM_REJECTED,
    details: text,
    amountBefore: order?.totalAmount ?? 0,
    amountAfter: order?.totalAmount ?? 0,
  });

  refreshMoneyPages(claim.orderId);
  return { ok: true };
}

/**
 * Первую галочку ставит менеджер по своей заявке (администратор — по любой).
 * Бухгалтер её не ставит: это подтверждение договорённости с клиентом, а не денег.
 */
export async function setManagerConfirmedAction(orderId: string, confirmed: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  // Все правила — одной чистой функцией (`orderRules.ts`), покрытой тестом.
  // Раньше они лежали здесь тремя `if`, и каждая новая роль означала правку
  // условия, которую никто не проверял.
  const refusal = confirmRefusal(
    order,
    session.user.role,
    session.user.email.toLowerCase(),
    confirmed
  );
  if (refusal) throw new Error(refusal);

  await setOrderManagerConfirmed(orderId, confirmed);

  // Подтверждение открывает отгрузку — значит это действие с последствиями, и
  // спор «я подтверждение не снимала» должен разбираться по записи, а не по
  // памяти. Раньше единственное из «денежных» действий, что не попадало в журнал.
  await logMoney({
    actorEmail: session.user.email,
    orderId,
    action: MONEY_LOG_ACTIONS.MANAGER_CONFIRMED,
    details: confirmed ? "Менеджер подтвердил заявку" : "Менеджер снял подтверждение",
    amountBefore: order.totalAmount,
    amountAfter: order.totalAmount,
  });

  revalidatePath("/finance");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/warehouse");
  revalidatePath("/warehouse/picklist");
  return { ok: true };
}
