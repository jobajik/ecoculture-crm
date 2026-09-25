import { getOrderById, setOrderPaidTotals } from "./repo/orders";
import { appendPayments, listPayments } from "./repo/payments";
import { logMoney } from "./repo/moneyLog";
import { farmPayments, invoiceByFarm } from "./orderMoney";
import { methodOfPayments, totalsAfter } from "./payments";
import { FARM_LABELS, MONEY_LOG_ACTIONS, PAID_FIELD_BY_FARM } from "./constants";
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
}): Promise<{ paymentId: string; paidAfter: number } | null> {
  forgetReads();
  const order = await getOrderById(input.orderId);
  if (!order) return null;
  const invoice = invoiceByFarm(order.items);
  const farm = invoice.length > 1 ? input.farm : invoice[0]?.farm ?? input.farm;
  const [paymentId] = await appendPayments([
    {
      orderId: order.orderId,
      date: input.date,
      amount: input.amount,
      farm: invoice.length > 1 ? farm : "",
      method: input.method,
      accountantEmail: input.actorEmail,
      note: input.note.slice(0, 200),
    },
  ]);
  const after = await writeTotalsAfter(order, farm, input.amount, input.actorEmail, input.method);
  await logMoney({
    actorEmail: input.actorEmail,
    orderId: order.orderId,
    action: MONEY_LOG_ACTIONS.PAYMENT_ADDED,
    details:
      `Платёж ${money(input.amount)} за ${input.date.split("-").reverse().join(".")} · ${input.method}` +
      (invoice.length > 1 ? ` · ${FARM_LABELS[farm] ?? farm}` : "") +
      ` · ${input.note} · всего получено ${money(after)} из ${money(order.totalAmount)}`,
    amountBefore: order.paidAmount,
    amountAfter: after,
  });
  return { paymentId, paidAfter: after };
}
