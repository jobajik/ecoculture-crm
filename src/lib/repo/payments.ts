import { appendRow, deleteWhere, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import { toIsoDate, toIsoDateTime } from "../sheetDate";
import type { Payment } from "../types";

/**
 * Журнал платежей (вкладка Payments): строка на каждое поступление.
 * Итог заявки лежит в Orders.PaidAmount и меняется вместе с журналом —
 * см. `addPaymentActionInner` в src/app/finance/actions.ts.
 */

function toPayment(record: Record<string, string>): Payment {
  const amount = Number(String(record.Amount ?? "").replace(/\s/g, "").replace(",", "."));
  return {
    paymentId: record.PaymentID || "",
    createdAt: toIsoDateTime(record.CreatedAt) || record.CreatedAt || "",
    orderId: record.OrderID || "",
    date: toIsoDate(record.Date),
    amount: Number.isFinite(amount) ? amount : 0,
    farm: (record.Farm || "").trim(),
    method: record.Method || "",
    accountantEmail: (record.AccountantEmail || "").toLowerCase(),
    note: record.Note || "",
  };
}

/**
 * Все платежи. Вкладки может ещё не быть (её создаёт `setup-sheet`), и тогда
 * это не ошибка, а «платежей пока нет»: страница оплат не должна падать из-за
 * журнала.
 */
export async function listPayments(options: { fresh?: boolean } = {}): Promise<Payment[]> {
  try {
    const table = await readTable(SHEET_TABS.PAYMENTS, options);
    return table.rows
      .map((row) => toPayment(rowToRecord(SHEET_TABS.PAYMENTS, row)))
      .filter((p) => p.paymentId && p.orderId);
  } catch (err) {
    console.error("Не удалось прочитать журнал платежей:", err);
    return [];
  }
}

export async function appendPayment(input: Omit<Payment, "paymentId" | "createdAt">): Promise<string> {
  const paymentId = generateId("PAY");
  await appendRow(SHEET_TABS.PAYMENTS, {
    PaymentID: paymentId,
    CreatedAt: new Date().toISOString(),
    OrderID: input.orderId,
    Date: input.date,
    Amount: input.amount,
    Farm: input.farm,
    Method: input.method,
    AccountantEmail: input.accountantEmail,
    Note: input.note,
  });
  return paymentId;
}

export async function deletePayment(paymentId: string): Promise<number> {
  return deleteWhere(SHEET_TABS.PAYMENTS, (record) => record.PaymentID === paymentId);
}
