import { commitAtomic, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { toIsoDateTime } from "../sheetDate";
import type { KaspiInvoice } from "../types";

/** Счета Kaspi Pay (вкладка KaspiInvoices). Пока вкладки нет — пустой список. */

function toInvoice(r: Record<string, string>): KaspiInvoice {
  return {
    invoiceId: (r.InvoiceID || "").trim(),
    createdAt: toIsoDateTime(r.CreatedAt),
    orderId: r.OrderID || "",
    farm: (r.Farm || "").trim(),
    amount: Number(r.Amount) || 0,
    phone: r.Phone || "",
    status: (r.Status || "").trim(),
    kaspiInvoiceId: r.KaspiInvoiceID || "",
    errorCode: r.ErrorCode || "",
    errorMessage: r.ErrorMessage || "",
    paidAt: toIsoDateTime(r.PaidAt),
    paymentId: (r.PaymentID || "").trim(),
    createdByEmail: (r.CreatedByEmail || "").trim().toLowerCase(),
    sandbox: ["TRUE", "1", "ДА", "YES"].includes((r.Sandbox || "").trim().toUpperCase()),
    updatedAt: toIsoDateTime(r.UpdatedAt),
  };
}

export async function listKaspiInvoices(options: { fresh?: boolean } = {}): Promise<KaspiInvoice[]> {
  try {
    const t = await readTable(SHEET_TABS.KASPI_INVOICES, options);
    return t.rows.map((row) => toInvoice(rowToRecord(SHEET_TABS.KASPI_INVOICES, row))).filter((i) => i.invoiceId);
  } catch {
    return [];
  }
}

export async function findKaspiInvoice(invoiceId: string): Promise<{ invoice: KaspiInvoice; rowNumber: number } | null> {
  const t = await readTable(SHEET_TABS.KASPI_INVOICES, { fresh: true });
  for (let i = 0; i < t.rows.length; i++) {
    const inv = toInvoice(rowToRecord(SHEET_TABS.KASPI_INVOICES, t.rows[i]));
    if (inv.invoiceId === String(invoiceId)) return { invoice: inv, rowNumber: t.rowNumbers[i] };
  }
  return null;
}

export async function appendKaspiInvoice(inv: KaspiInvoice): Promise<void> {
  await commitAtomic([
    {
      kind: "append",
      tab: SHEET_TABS.KASPI_INVOICES,
      records: [
        {
          InvoiceID: inv.invoiceId,
          CreatedAt: inv.createdAt,
          OrderID: inv.orderId,
          Farm: inv.farm,
          Amount: inv.amount,
          Phone: inv.phone,
          Status: inv.status,
          KaspiInvoiceID: inv.kaspiInvoiceId,
          ErrorCode: inv.errorCode,
          ErrorMessage: inv.errorMessage,
          PaidAt: inv.paidAt,
          PaymentID: inv.paymentId,
          CreatedByEmail: inv.createdByEmail,
          Sandbox: inv.sandbox ? "TRUE" : "",
          UpdatedAt: inv.updatedAt,
        },
      ],
    },
  ]);
}

export async function updateKaspiInvoiceRow(rowNumber: number, changes: Record<string, string | number>): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await commitAtomic([{ kind: "update", tab: SHEET_TABS.KASPI_INVOICES, rowNumber, changes }]);
}
