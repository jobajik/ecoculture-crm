import type { ApiPayInvoice } from "./apipay";
import { findKaspiInvoice, updateKaspiInvoiceRow } from "./repo/kaspiInvoices";
import { getOrderById } from "./repo/orders";
import { recordPayment } from "./paymentWrite";
import { isPaidKaspiStatus, kaspiStatusPlan } from "./kaspiInvoice";
import { ORDER_STATUSES } from "./constants";
import { localDayKey } from "./timezone";

/** Кем подписан платёж, проведённый по оплате счёта Kaspi. */
export const KASPI_ACTOR = "kaspi-pay@apipay";

/**
 * Новый статус счёта от ApiPay (вебхук или «Обновить статус») — в нашу
 * таблицу. Оплаченный счёт проводится платежом ОДИН раз: перед записью платежа
 * строка счёта «занимается» отметкой, и повторный вебхук того же `paid` (ApiPay
 * их повторяет) видит её и ничего не делает.
 *
 * Возвращает, что сделано, — для ответа вебхуку и для журнала.
 */
export async function applyApiPayInvoice(inv: ApiPayInvoice): Promise<"unknown" | "same" | "updated" | "paid"> {
  const found = await findKaspiInvoice(String(inv.id));
  if (!found) return "unknown";
  const { invoice: row, rowNumber } = found;
  const status = String(inv.status || "").trim();
  const plan = kaspiStatusPlan(row, { status });

  const changes: Record<string, string | number> = {};
  if (plan.changed) changes.Status = status;
  if (inv.kaspi_invoice_id && inv.kaspi_invoice_id !== row.kaspiInvoiceId) changes.KaspiInvoiceID = String(inv.kaspi_invoice_id);
  if ((inv.error_code || "") !== row.errorCode) changes.ErrorCode = String(inv.error_code || "");
  if ((inv.error_message || "") !== row.errorMessage) changes.ErrorMessage = String(inv.error_message || "").slice(0, 300);
  if (inv.paid_at && !row.paidAt) changes.PaidAt = String(inv.paid_at);

  if (!plan.recordPayment) {
    if (Object.keys(changes).length === 0) return "same";
    changes.UpdatedAt = new Date().toISOString();
    await updateKaspiInvoiceRow(rowNumber, changes);
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
  if (!again || again.invoice.paymentId) return "same";
  const claim = `claim-${Date.now()}`;
  await updateKaspiInvoiceRow(again.rowNumber, { ...changes, PaymentID: claim, UpdatedAt: new Date().toISOString() });

  const paidAt = inv.paid_at ? new Date(inv.paid_at) : new Date();
  const amount = Math.round((Number(inv.amount) || row.amount) * 100) / 100;
  const result = await recordPayment({
    orderId: row.orderId,
    farm: row.farm,
    date: localDayKey(Number.isNaN(paidAt.getTime()) ? new Date() : paidAt),
    amount,
    method: "Каспи",
    note: `Kaspi-счёт №${row.invoiceId}${inv.is_sandbox ? " (тест)" : ""}`,
    actorEmail: KASPI_ACTOR,
  });
  await updateKaspiInvoiceRow(again.rowNumber, {
    PaymentID: result?.paymentId ?? "",
    UpdatedAt: new Date().toISOString(),
  });
  return isPaidKaspiStatus(status) ? "paid" : "updated";
}
