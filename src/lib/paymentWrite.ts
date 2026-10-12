import { getOrderById, setOrderPaidTotals } from "./repo/orders";
import { appendPayments, listPayments } from "./repo/payments";
import { logMoney } from "./repo/moneyLog";
import { farmPayments, invoiceByFarm } from "./orderMoney";
import { flowerOwed, lostPaymentFix, methodOfPayments, splitByFlowerOwed, totalsAfter } from "./payments";
import { FARM_LABELS, FLOWER_TYPE_LABELS, MONEY_LOG_ACTIONS, PAID_FIELD_BY_FARM } from "./constants";
import { forgetReads } from "./sheets";

// Запись платежа по заявке: строка в журнале Payments + новый итог заявки.
// Здесь, а не в `finance/actions.ts`, потому что платёж пишет не только
// бухгалтер из панели, но и вебхук Kaspi (оплаченный счёт проводится сам), а у
// вебхука нет ни сессии, ни права звать серверные действия.

/**
 * Пересчитать итог заявки по журналу и записать его.
 *
 * Итог = прежний итог ± этот платёж, а не «сумма журнала»: у заявок, оплаченных
 * до журнала, деньги лежат в итоге одним числом, и пересчёт «по журналу»
 * стёр бы их. День первого поступления берётся из журнала — платёж вносят и
 * задним числом.
 */
export async function writeTotalsAfter(
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


const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/**
 * Провести поступление по заявке от имени `actorEmail` (для Kaspi — служебная
 * подпись). Правила «кто может» проверяет вызывающий; здесь — только запись в
 * том же порядке, что у бухгалтера: сначала журнал, потом итог, потом журнал денег.
 */
export async function recordPayment(input: {
  orderId: string;
  farm: string;
  date: string;
  amount: number;
  method: string;
  note: string;
  actorEmail: string;
  /** Сверить итог с журналом после записи (вебхук Kaspi: два счёта заявки оплачивают в одну секунду). */
  verify?: boolean;
}): Promise<{ paymentId: string; paidAfter: number } | null> {
  forgetReads();
  const order = await getOrderById(input.orderId);
  if (!order) return null;
  const invoice = invoiceByFarm(order.items);
  const farm = invoice.length > 1 ? input.farm : invoice[0]?.farm ?? input.farm;
  // Kaspi-счёт оплачивают одним переводом за всю часть компании, а у Rose Farm
  // в ней роза и эустома — перевод раскладывается по остаткам цветков.
  const farmRow = farmPayments(order).find((f) => f.farm === farm);
  const ledger = (await listPayments({ fresh: true })).filter((p) => p.orderId === order.orderId);
  const parts = farmRow
    ? splitByFlowerOwed(input.amount, flowerOwed(farmRow, ledger, invoice.length <= 1))
    : [{ flowerType: "", amount: input.amount }];
  const [paymentId] = await appendPayments(
    (parts.length ? parts : [{ flowerType: "", amount: input.amount }]).map((p) => ({
      orderId: order.orderId,
      date: input.date,
      amount: p.amount,
      farm: invoice.length > 1 ? farm : "",
      method: input.method,
      accountantEmail: input.actorEmail,
      note: input.note.slice(0, 200),
      flowerType: p.flowerType,
    }))
  );
  const after = await writeTotalsAfter(order, farm, input.amount, input.actorEmail, input.method);
  await logMoney({
    actorEmail: input.actorEmail,
    orderId: order.orderId,
    action: MONEY_LOG_ACTIONS.PAYMENT_ADDED,
    details:
      `Платёж ${money(input.amount)} за ${input.date.split("-").reverse().join(".")} · ${input.method}` +
      (invoice.length > 1 ? ` · ${FARM_LABELS[farm] ?? farm}` : "") +
      (parts.length > 1 ? ` (${parts.map((p) => `${FLOWER_TYPE_LABELS[p.flowerType] ?? p.flowerType} ${money(p.amount)}`).join(", ")})` : "") +
      ` · ${input.note} · всего получено ${money(after)} из ${money(order.totalAmount)}`,
    amountBefore: order.paidAmount,
    amountAfter: after,
  });
  // Два Kaspi-счёта одной заявки, оплаченные в одну секунду, писали итог наперегонки, и платёж терялся
  // (№YKLQQ, `lostPaymentFix`). Выждать, пока сосед допишет, и сверить итог со свежим журналом.
  if (!input.verify) return { paymentId, paidAfter: after };
  await new Promise((r) => setTimeout(r, 2000 + Math.floor(Math.random() * 1500)));
  const repaired = await repairLostPayments(order.orderId, input.actorEmail, true);
  return { paymentId, paidAfter: repaired ?? after };
}

/**
 * Вернуть в итог заявки платежи журнала, чья запись итога потерялась (`lostPaymentFix`). Возвращает новый
 * итог или null, если всё сходится. `recentOnly` — только платежи последних минут (после записи);
 * без него — любые, для разбора старых заявок по списку человека.
 */
export async function repairLostPayments(orderId: string, actorEmail: string, recentOnly: boolean): Promise<number | null> {
  try {
    forgetReads();
    const order = await getOrderById(orderId);
    if (!order) return null;
    const ledger = (await listPayments({ fresh: true })).filter((p) => p.orderId === orderId);
    const farms = invoiceByFarm(order.items).map((f) => f.farm);
    const paidByFarm: Record<string, number> = {};
    for (const f of farms) {
      const field = PAID_FIELD_BY_FARM[f];
      if (field) paidByFarm[f] = Number((order as unknown as Record<string, number>)[field]) || 0;
    }
    const fix = lostPaymentFix({ farms, paidAmount: order.paidAmount, paidByFarm, ledger, now: new Date(), recentOnly });
    if (!fix) return null;
    const byField: Record<string, number> = {};
    for (const [f, value] of Object.entries(fix.byFarm)) {
      const field = PAID_FIELD_BY_FARM[f];
      if (field) byField[field] = value;
    }
    const firstDay = ledger.map((p) => p.date).filter(Boolean).sort()[0] ?? "";
    await setOrderPaidTotals(orderId, {
      amount: fix.paidAmount,
      totalAmount: order.totalAmount,
      accountantEmail: actorEmail,
      paymentMethod: methodOfPayments(ledger.map((p) => p.method)) || order.paymentMethod,
      byField,
      paidAt: order.paidAt || firstDay || new Date().toISOString(),
    });
    await logMoney({
      actorEmail,
      orderId,
      action: MONEY_LOG_ACTIONS.PAYMENT_ADDED,
      details: `Итог исправлен: ${money(fix.added)} из журнала платежей не попали в итог (оплата одновременно по двум счетам) · всего получено ${money(fix.paidAmount)} из ${money(order.totalAmount)}`,
      amountBefore: order.paidAmount,
      amountAfter: fix.paidAmount,
    });
    return fix.paidAmount;
  } catch (err) {
    console.error("repair lost payments:", err instanceof Error ? err.message : err);
    return null;
  }
}
