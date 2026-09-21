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
  setOrderInvoiceNote,
  setOrderPaidTotals,
  setOrderRealization,
  updateOrderItemAmounts,
  recomputeOrderStatusFromItems,
} from "@/lib/repo/orders";
import { createClaim, decideClaim, listClaims } from "@/lib/repo/claims";
import { logMoney } from "@/lib/repo/moneyLog";
import { confirmRefusal, moneyRefusal } from "@/lib/orderRules";
import { farmPayments, invoiceByFarm } from "@/lib/orderMoney";
import { appendPayments, deletePayment, listPayments } from "@/lib/repo/payments";
import {
  addPaymentRefusal,
  joinRealizations,
  methodOfPayments,
  parseRealizations,
  realizationFlowers,
  splitPaymentLines,
  removePaymentRefusal,
  totalsAfter,
} from "@/lib/payments";
import { isRetailOrder, isRetailRole } from "@/lib/retail";
import { isRegionOrder } from "@/lib/orderKind";
import { invoiceSentRefusal } from "@/lib/paymentStage";
import { canEditFinance } from "@/lib/financeAccess";
import {
  CLAIM_REASONS,
  CLAIM_STATUSES,
  MONEY_LOG_ACTIONS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAID_FIELD_BY_FARM,
  FARM_LABELS,
  ROLES,
} from "@/lib/constants";
import { guard } from "@/lib/actionResult";

/**
 * Заявка в наш магазин деньгами не сопровождается вовсе: счёта нет, платить
 * некому. Отметить по ней оплату значило бы создать выручку из воздуха.
 */
const RETAIL_MONEY_REFUSAL =
  "Это заявка в наш магазин — внутреннее перемещение. Оплата по ней не проводится.";

/**
 * Деньгами распоряжается бухгалтер — и это проверяется ЗДЕСЬ, а не только
 * прятками в интерфейсе (грабли 1.11).
 *
 * РОП с недавних пор раздел «Оплаты» видит, но ничего в нём не меняет. Кнопок
 * ему не показывают, однако серверное действие вызывается и обычным запросом,
 * так что запрет обязан жить на сервере. Правило одно на всех —
 * `canEditFinance()` в `src/lib/financeAccess.ts`.
 */
async function requireAccountant() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (!canEditFinance(session.user.role)) {
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
async function setPaymentActionInner(
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
async function setPaymentByFarmActionInner(
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
async function setPaidActionInner(orderId: string, paid: boolean, paymentMethod: string) {
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
async function setInvoiceSentActionInner(orderId: string, sent: boolean) {
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

/**
 * Заметка о том, почему счёт ещё не отправлен.
 *
 * Владелец: «сейчас со списка не отправлены два счёта, т. к. номера тел
 * неверные, теперь надо искать который из них не отправлен». Отметка отвечает
 * на вопрос «отправлен ли», а заметка — на вопрос «почему нет», и без неё
 * бухгалтер держит это в голове до завтра.
 *
 * Права те же, что у отметки: пишет бухгалтер. В журнал денег НЕ идёт — это
 * не событие с деньгами, а рабочая пометка, и засорять ею журнал значит
 * сделать его нечитаемым (там же, где решено не писать туда дописанную дату
 * доставки).
 */
async function setInvoiceNoteActionInner(orderId: string, note: string) {
  await requireAccountant();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  const session = await getServerSession(authOptions);
  const refusal = invoiceSentRefusal({
    role: session?.user?.role,
    order,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });
  if (refusal) throw new Error(refusal);

  await setOrderInvoiceNote(orderId, note);
  refreshMoneyPages(orderId);
}

async function setPromiseActionInner(orderId: string, promisedAt: string, note: string) {
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
async function recalculateOrderActionInner(
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
async function createClaimActionInner(orderId: string, reason: string, comment: string) {
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
async function rejectClaimActionInner(claimId: string, decision: string) {
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
async function setManagerConfirmedActionInner(orderId: string, confirmed: boolean) {
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

// ---------------------------------------------------------------------------
// Платежи по одному (журнал Payments) и номер реализации 1С
// ---------------------------------------------------------------------------

/** Сегодня по местному времени, ГГГГ-ММ-ДД. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

/**
 * Пересчитать итог заявки по журналу и записать его.
 *
 * Итог = прежний итог ± этот платёж, а не «сумма журнала»: у заявок, оплаченных
 * до журнала, деньги лежат в итоге одним числом, и пересчёт «по журналу»
 * стёр бы их. День первого поступления берётся из журнала — платёж вносят и
 * задним числом.
 */
async function writeTotalsAfter(
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>,
  farm: string,
  delta: number,
  email: string,
  method: string
) {
  const current = Object.fromEntries(farmPayments(order).map((f) => [f.farm, f.paidAmount]));
  const next = totalsAfter(order.paidAmount, current, farm, delta);
  const byField: Record<string, number> = {};
  for (const [f, value] of Object.entries(next.byFarm)) {
    const field = PAID_FIELD_BY_FARM[f];
    if (field) byField[field] = value;
  }
  const ledger = (await listPayments({ fresh: true })).filter((p) => p.orderId === order.orderId);
  const firstDay = ledger.map((p) => p.date).filter(Boolean).sort()[0] ?? "";
  // Вид оплаты заявки — из её платежей: один способ — он и есть, разные —
  // «Смешанная». Платежей нет — пусто, и тогда остаётся то, что указал менеджер.
  const ledgerMethod = methodOfPayments(ledger.map((p) => p.method));
  await setOrderPaidTotals(order.orderId, {
    amount: next.paidAmount,
    totalAmount: order.totalAmount,
    accountantEmail: email,
    paymentMethod: ledgerMethod || method,
    byField,
    // Были деньги ДО журнала (итог больше суммы платежей) — их день мы знаем
    // только из прежней отметки и её не трогаем. Иначе первый день — из журнала.
    paidAt:
      next.paidAmount - ledger.reduce((sum, p) => sum + p.amount, 0) > 1 && order.paidAt
        ? order.paidAt
        : firstDay || order.paidAt || new Date().toISOString(),
  });
  return next.paidAmount;
}

async function addPaymentActionInner(input: {
  orderId: string;
  date: string;
  farm: string;
  /**
   * Части поступления по способам. Обычно одна; смешанная оплата («часть
   * картой, часть наличными» — просьба бухгалтера) — несколько, и каждая
   * становится отдельным платежом со своим способом.
   */
  lines: { amount: number; method: string }[];
  note?: string;
}) {
  const email = await requireAccountant();
  const session = await getServerSession(authOptions);

  const order = await getOrderById(input.orderId);
  if (!order) throw new Error("Заявка не найдена");
  const invoice = invoiceByFarm(order.items);

  const split = splitPaymentLines(input.lines ?? []);
  if (split.refusal) throw new Error(split.refusal);
  const total = split.lines.reduce((s, l) => s + l.amount, 0);

  // Общие правила — на всё поступление целиком (права, день, компания), а
  // способ каждой части проверен выше.
  const refusal = addPaymentRefusal({
    role: session?.user?.role,
    amount: total,
    date: input.date,
    today: todayKey(),
    method: split.lines[0].method,
    farm: input.farm || "",
    invoiceFarms: invoice.map((f) => f.farm),
    status: order.status,
    noInvoice: isRetailOrder(order) || isRegionOrder(order),
  });
  if (refusal) throw new Error(refusal);

  const farm = invoice.length > 1 ? input.farm : invoice[0]?.farm ?? "";
  const amount = Math.round(total * 100) / 100;

  // Сначала журнал, потом итог: если второй запрос не дойдёт, платежи будут
  // видны строками, а разница с итогом — отдельной строкой «вне журнала», и её
  // легко заметить. При обратном порядке итог вырос бы молча, без следа.
  // Все части — одной записью.
  await appendPayments(
    split.lines.map((l) => ({
      orderId: order.orderId,
      date: input.date,
      amount: l.amount,
      farm: invoice.length > 1 ? farm : "",
      method: l.method,
      accountantEmail: email,
      note: (input.note || "").trim().slice(0, 200),
    }))
  );
  const after = await writeTotalsAfter(order, farm, amount, email, split.lines[0].method);

  await logMoney({
    actorEmail: email,
    orderId: order.orderId,
    action: MONEY_LOG_ACTIONS.PAYMENT_ADDED,
    details:
      `Платёж ${money(amount)} за ${input.date.split("-").reverse().join(".")} · ` +
      split.lines.map((l) => (split.lines.length > 1 ? `${l.method} ${money(l.amount)}` : l.method)).join(" + ") +
      (invoice.length > 1 ? ` · ${FARM_LABELS[farm] ?? farm}` : "") +
      ` · всего получено ${money(after)} из ${money(order.totalAmount)}`,
    amountBefore: order.paidAmount,
    amountAfter: after,
  });

  refreshMoneyPages(order.orderId);
  return { ok: true };
}

async function removePaymentActionInner(orderId: string, paymentId: string) {
  const email = await requireAccountant();
  const session = await getServerSession(authOptions);

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");
  const payment = (await listPayments({ fresh: true })).find(
    (p) => p.paymentId === paymentId && p.orderId === orderId
  );
  if (!payment) throw new Error("Платёж не найден — возможно, его уже удалили");

  const refusal = removePaymentRefusal({
    role: session?.user?.role,
    status: order.status,
    enteredOn: (payment.createdAt || "").slice(0, 10),
    today: todayKey(),
  });
  if (refusal) throw new Error(refusal);

  await deletePayment(paymentId);
  const after = await writeTotalsAfter(order, payment.farm, -payment.amount, email, "");

  await logMoney({
    actorEmail: email,
    orderId,
    action: MONEY_LOG_ACTIONS.PAYMENT_REMOVED,
    details: `Удалён платёж ${money(payment.amount)} за ${payment.date
      .split("-")
      .reverse()
      .join(".")} · ${payment.method}`,
    amountBefore: order.paidAmount,
    amountAfter: after,
  });

  refreshMoneyPages(orderId);
  return { ok: true };
}

/**
 * Номера реализаций 1С. У заявки их столько, сколько в ней цветков: в 1С на
 * розу и на эустому — два документа, хоть компания и одна (просьба бухгалтера).
 * Принимает номера по цветкам; строка — для старых вызовов с одним номером.
 */
async function setRealizationActionInner(orderId: string, value: string | Record<string, string>) {
  const email = await requireAccountant();
  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");
  const flowers = realizationFlowers(order.items);
  const numbers = typeof value === "string" ? parseRealizations(value, flowers) : value ?? {};
  const clean = joinRealizations(numbers, flowers);
  if (clean === order.realization1c) return { ok: true };

  await setOrderRealization(orderId, clean);
  await logMoney({
    actorEmail: email,
    orderId,
    action: MONEY_LOG_ACTIONS.REALIZATION_1C,
    details: clean
      ? `Реализация 1С: ${clean}${order.realization1c ? ` (было: ${order.realization1c})` : ""}`
      : `Номер реализации 1С стёрт (был: ${order.realization1c})`,
    amountBefore: order.totalAmount,
    amountAfter: order.totalAmount,
  });
  refreshMoneyPages(orderId);
  return { ok: true };
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

export async function setPaymentAction(...args: Parameters<typeof setPaymentActionInner>) {
  return guard(() => setPaymentActionInner(...args));
}

export async function setPaymentByFarmAction(...args: Parameters<typeof setPaymentByFarmActionInner>) {
  return guard(() => setPaymentByFarmActionInner(...args));
}

export async function setPaidAction(...args: Parameters<typeof setPaidActionInner>) {
  return guard(() => setPaidActionInner(...args));
}

export async function setInvoiceSentAction(...args: Parameters<typeof setInvoiceSentActionInner>) {
  return guard(() => setInvoiceSentActionInner(...args));
}

export async function setInvoiceNoteAction(...args: Parameters<typeof setInvoiceNoteActionInner>) {
  return guard(() => setInvoiceNoteActionInner(...args));
}

export async function setPromiseAction(...args: Parameters<typeof setPromiseActionInner>) {
  return guard(() => setPromiseActionInner(...args));
}

export async function recalculateOrderAction(...args: Parameters<typeof recalculateOrderActionInner>) {
  return guard(() => recalculateOrderActionInner(...args));
}

export async function createClaimAction(...args: Parameters<typeof createClaimActionInner>) {
  return guard(() => createClaimActionInner(...args));
}

export async function rejectClaimAction(...args: Parameters<typeof rejectClaimActionInner>) {
  return guard(() => rejectClaimActionInner(...args));
}

export async function setManagerConfirmedAction(...args: Parameters<typeof setManagerConfirmedActionInner>) {
  return guard(() => setManagerConfirmedActionInner(...args));
}

export async function addPaymentAction(...args: Parameters<typeof addPaymentActionInner>) {
  return guard(() => addPaymentActionInner(...args));
}

export async function removePaymentAction(...args: Parameters<typeof removePaymentActionInner>) {
  return guard(() => removePaymentActionInner(...args));
}

export async function setRealizationAction(...args: Parameters<typeof setRealizationActionInner>) {
  return guard(() => setRealizationActionInner(...args));
}
