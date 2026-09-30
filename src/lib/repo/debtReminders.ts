import { appendRow, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import { toIsoDateTime } from "../sheetDate";
import type { ReminderRecord } from "../debtReminder";

/** Журнал напоминаний о долгах (вкладка `DebtReminders`). Только дописывается. */
export async function listDebtReminders(options: { fresh?: boolean } = {}): Promise<ReminderRecord[]> {
  try {
    const t = await readTable(SHEET_TABS.DEBT_REMINDERS, options);
    return t.rows
      .map((row) => rowToRecord(SHEET_TABS.DEBT_REMINDERS, row))
      .map((r) => ({
        reminderId: r.ReminderID || "",
        sentAt: toIsoDateTime(r.SentAt) || r.SentAt || "",
        phone: String(r.Phone || "").replace(/\D/g, ""),
        clientName: r.ClientName || "",
        orderIds: String(r.OrderIDs || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        amount: Number(String(r.Amount || "0").replace(/\s/g, "").replace(",", ".")) || 0,
        messageId: r.MessageID || "",
        kaspiInvoices: r.KaspiInvoices || "",
        sentByEmail: (r.SentByEmail || "").toLowerCase(),
        error: r.Error || "",
      }))
      .filter((r) => r.reminderId);
  } catch {
    return [];
  }
}

export async function appendDebtReminder(input: Omit<ReminderRecord, "reminderId" | "sentAt">): Promise<string> {
  const id = generateId("DR");
  await appendRow(SHEET_TABS.DEBT_REMINDERS, {
    ReminderID: id,
    SentAt: new Date().toISOString(),
    Phone: input.phone,
    ClientName: input.clientName,
    OrderIDs: input.orderIds.join(","),
    Amount: Math.round(input.amount),
    MessageID: input.messageId,
    KaspiInvoices: input.kaspiInvoices,
    SentByEmail: input.sentByEmail,
    Error: input.error.slice(0, 300),
  });
  return id;
}
