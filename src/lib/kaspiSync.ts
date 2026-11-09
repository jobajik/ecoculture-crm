import type { ApiPayInvoice } from "./apipay";
import type { KaspiInvoice } from "./types";
import { appendKaspiInvoice, findKaspiInvoice, updateKaspiInvoiceRow } from "./repo/kaspiInvoices";
import { getOrderById } from "./repo/orders";
import { recordPayment } from "./paymentWrite";
import { isPaidKaspiStatus, kaspiPhone, kaspiStatusPlan, recordedPaymentId, noteHasInvoice } from "./kaspiInvoice";
import { listPayments } from "./repo/payments";
import { ORDER_STATUSES } from "./constants";
import { localDayKey } from "./timezone";
import { isKaspiSessionError } from "./kaspiHealth";
import { noteKaspiSessionLost } from "./kaspiHealthCheck";
import { onBotInvoiceUpdate } from "./botFollowUp";

/** Кем подписан платёж, проведённый по оплате счёта Kaspi. */
export const KASPI_ACTOR = "kaspi-pay@apipay";

const OUR_EXTERNAL_ID = /^([A-Z0-9]{4,8}):(rose_farm|esentai)$/;

async function adoptUnknownInvoice(inv: ApiPayInvoice): Promise<{ invoice: KaspiInvoice; rowNumber: number } | null> {
  const m = OUR_EXTERNAL_ID.exec(String(inv.external_order_id || ""));
  if (!m) return null;
  const order = await getOrderById(m[1]);
  if (!order) return null;
  const now = new Date().toISOString();
  await appendKaspiInvoice({
    invoiceId: String(inv.id),
    createdAt: now,
    orderId: order.orderId,
    farm: m[2],
    amount: Math.round(Number(inv.amount) || 0),
    phone: kaspiPhone(String(inv.client_phone || order.clientPhone || "")),
    status: "processing",
    kaspiInvoiceId: String(inv.kaspi_invoice_id || ""),
    errorCode: "",
    errorMessage: "Счёт был в ApiPay без записи в CRM — записан по уведомлению",
    paidAt: "",
    paymentId: "",
    createdByEmail: "apipay",
    sandbox: !!inv.is_sandbox,
    updatedAt: now,
  });
  return findKaspiInvoice(String(inv.id));
}

/**
 * Новый статус счёта от ApiPay (вебхук или «Обновить статус») — в нашу
 * таблицу. Оплаченный счёт проводится платежом ОДИН раз: перед записью платежа
 * строка счёта «занимается» отметкой, и повторный вебхук того же `paid` (ApiPay
 * их повторяет) видит её и ничего не делает.
 *
 * Возвращает, что сделано, — для ответа вебхуку и для журнала.
 */
export async function applyApiPayInvoice(inv: ApiPayInvoice): Promise<"unknown" | "same" | "updated" | "paid"> {
  let found = await findKaspiInvoice(String(inv.id));
  if (!found) {
    // Счёт наш (external_order_id = «<заявка>:<компания>»), а строки нет — запись при выставлении не удалась
    // (09.11.2026, №WQ67P). Заводим строку и проводим как обычно: иначе оплата клиента повисла бы «неизвестной».
    const adopted = await adoptUnknownInvoice(inv);
    if (!adopted) return "unknown";
    found = adopted;
  }
  const { invoice: row, rowNumber } = found;
  const status = String(inv.status || "").trim();
  const plan = kaspiStatusPlan(row, { status });

  const changes: Record<string, string | number> = {};
  if (plan.changed) changes.Status = status;
  if (inv.kaspi_invoice_id && inv.kaspi_invoice_id !== row.kaspiInvoiceId) changes.KaspiInvoiceID = String(inv.kaspi_invoice_id);
  if ((inv.error_code || "") !== row.errorCode) changes.ErrorCode = String(inv.error_code || "");
  if ((inv.error_message || "") !== row.errorMessage) changes.ErrorMessage = String(inv.error_message || "").slice(0, 300);
  if (inv.paid_at && !row.paidAt) changes.PaidAt = String(inv.paid_at);
  // Счёт не ушёл, потому что Kaspi сбросил вход кассира, — полоса «касса
  // отключилась» появится сразу, не дожидаясь проверки ApiPay.
  if (isKaspiSessionError(inv.error_code)) noteKaspiSessionLost(row.farm);

  if (!plan.recordPayment) {
    if (Object.keys(changes).length === 0) return "same";
    changes.UpdatedAt = new Date().toISOString();
    await updateKaspiInvoiceRow(rowNumber, changes);
    // Заявка бота: счёт не дошёл — бот сам попросит у клиента номер Kaspi.
    if (plan.changed) await onBotInvoiceUpdate(row, status, String(inv.error_code || ""), String(inv.error_message || ""));
    return "updated";
  }

  // Оплачен. Отменённую заявку сами не проводим: деньги пришли, но куда их
  // отнести, решает бухгалтер (возврат клиенту или восстановить заявку).
  const order = await getOrderById(row.orderId);
  if (!order || order.status === ORDER_STATUSES.CANCELLED) {
    changes.ErrorMessage = order ? "Заявка отменена — оплату проведите вручную" : "Заявка не найдена — проведите вручную";
    changes.UpdatedAt = new Date().toISOString();
    await updateKaspiInvoiceRow(rowNumber, changes);
    return "updated";
  }

  // Занять строку: ещё раз прочитать свежей и проверить, что никто не успел.
  const again = await findKaspiInvoice(row.invoiceId);
  if (!again || recordedPaymentId(again.invoice.paymentId)) return "same";
  // Платёж по этому счёту уже в журнале (прошлая попытка записала платёж и упала дальше) — только связать.
  const already = (await listPayments({ fresh: true })).find((p) => p.orderId === row.orderId && noteHasInvoice(p.note, row.invoiceId));
  if (already) {
    await updateKaspiInvoiceRow(again.rowNumber, { ...changes, PaymentID: already.paymentId, UpdatedAt: new Date().toISOString() });
    return isPaidKaspiStatus(status) ? "paid" : "updated";
  }
  const claim = `claim-${Date.now()}`;
  await updateKaspiInvoiceRow(again.rowNumber, { ...changes, PaymentID: claim, UpdatedAt: new Date().toISOString() });

  const paidAt = inv.paid_at ? new Date(inv.paid_at) : new Date();
  const amount = Math.round((Number(inv.amount) || row.amount) * 100) / 100;
  // Запись не удалась (лимит Google, предел ячеек) — снять отметку, чтобы следующий вебхук или сверка провели снова.
  const release = () => updateKaspiInvoiceRow(again.rowNumber, { PaymentID: "", UpdatedAt: new Date().toISOString() }).catch(() => undefined);
  const result = await recordPayment({
    orderId: row.orderId,
    farm: row.farm,
    date: localDayKey(Number.isNaN(paidAt.getTime()) ? new Date() : paidAt),
    amount,
    method: "Каспи",
    note: `Kaspi-счёт №${row.invoiceId}${inv.is_sandbox ? " (тест)" : ""}`,
    actorEmail: KASPI_ACTOR,
    // Счета Rose Farm и Есентай одной заявки оплачивают одним заходом — вебхуки приходят в ту же секунду.
    verify: true,
  }).catch(async (e) => {
    await release();
    throw e;
  });
  await updateKaspiInvoiceRow(again.rowNumber, {
    PaymentID: result?.paymentId ?? "",
    UpdatedAt: new Date().toISOString(),
  });
  // Заявка бота: бот сам скажет клиенту, что оплата пришла и заказ ушёл на сборку.
  await onBotInvoiceUpdate({ ...row, amount }, status, "", "");
  return isPaidKaspiStatus(status) ? "paid" : "updated";
}
