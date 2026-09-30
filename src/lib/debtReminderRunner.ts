import { SHEET_TABS } from "./constants";
import { prefetchTables } from "./sheets";
import { localDayKey } from "./timezone";
import { listOrdersWithItems } from "./repo/orders";
import { listClients } from "./repo/clients";
import { listKaspiInvoices } from "./repo/kaspiInvoices";
import { appendDebtReminder, listDebtReminders } from "./repo/debtReminders";
import { configuredFarms } from "./apipay";
import { issueKaspiInvoice } from "./kaspiIssue";
import { GreenError, sendText } from "./greenApi";
import { checkGreenChannel } from "./greenChannel";
import { planReminders, reminderText, type ReminderPlan } from "./debtReminder";

/** Всё, что нужно списку «кому напомнить», — одним чтением (грабли 1.17). */
export async function loadReminderPlan(fresh = false): Promise<ReminderPlan> {
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.KASPI_INVOICES,
    SHEET_TABS.DEBT_REMINDERS,
  ]);
  const [orders, clients, invoices, reminders] = await Promise.all([
    listOrdersWithItems(),
    listClients(),
    listKaspiInvoices(fresh ? { fresh: true } : {}),
    listDebtReminders(fresh ? { fresh: true } : {}),
  ]);
  return planReminders({ orders, clients, reminders, invoices, kaspiFarms: configuredFarms(), today: localDayKey() });
}

/**
 * Отправить одно напоминание (клиенту `key`). План считается ЗАНОВО на сервере
 * (грабли 1.11): оплатил за это время или ему уже напомнили — не пишем.
 * Сначала счета Kaspi, потом сообщение — чтобы текст говорил правду о том, что
 * счёт выставлен. Счёт не выставился — сообщение всё равно уходит, без строки о Kaspi.
 */
export async function sendDebtReminder(
  key: string,
  actor: { email: string; role: string | undefined }
): Promise<{ status: "sent" | "retry" | "skipped"; note: string }> {
  const plan = await loadReminderPlan(true);
  const g = plan.due.find((x) => x.key === key);
  if (!g) return { status: "skipped", note: "уже не нужно: оплатили, обещали или напомнили недавно" };
  if (!g.waPhone) return { status: "skipped", note: g.problem };

  const channel = await checkGreenChannel();
  if (channel.action === "retry") return { status: "retry", note: channel.text };
  if (channel.action === "pause" || !channel.cfg) throw new Error(channel.text);

  const kaspiDone: { orderId: string; farm: string; amount: number; invoiceId: string }[] = [];
  const kaspiErrors: string[] = [];
  for (const part of g.kaspiNew) {
    try {
      const r = await issueKaspiInvoice({ ...part, phone: g.kaspiPhone, email: actor.email, role: actor.role });
      kaspiDone.push({ ...part, invoiceId: r.invoiceId });
    } catch (err) {
      kaspiErrors.push(`Kaspi: ${err instanceof Error ? err.message : "не выставился"}`);
    }
  }
  const text = reminderText(g, [...g.kaspiOpen, ...kaspiDone]);

  let messageId = "";
  let error = kaspiErrors.join("; ");
  try {
    messageId = await sendText(channel.cfg, g.waPhone, text);
  } catch (err) {
    const status = err instanceof GreenError ? err.status : 0;
    error = [err instanceof Error ? err.message : "не отправилось", error].filter(Boolean).join("; ");
    if (status === 0 || status === 429 || status >= 500) {
      // Сбой связи: запишем, что счёт выставлен, но напоминание повторим.
      if (kaspiDone.length) await appendDebtReminder(record(g, "", kaspiDone, `не ушло: ${error}`, actor.email));
      return { status: "retry", note: "Green API не ответил — попробую ещё раз" };
    }
    await appendDebtReminder(record(g, "", kaspiDone, error, actor.email));
    throw new Error(`Не отправилось: ${error}`);
  }
  await appendDebtReminder(record(g, messageId, kaspiDone, error, actor.email));
  return { status: "sent", note: kaspiErrors.length ? kaspiErrors.join("; ") : kaspiDone.length ? "со счётом Kaspi" : "" };
}

function record(
  g: { waPhone: string; clientName: string; orders: { orderId: string }[]; total: number },
  messageId: string,
  kaspi: { farm: string; invoiceId: string; amount: number }[],
  error: string,
  email: string
) {
  return {
    phone: g.waPhone,
    clientName: g.clientName,
    orderIds: g.orders.map((o) => o.orderId),
    amount: g.total,
    messageId,
    kaspiInvoices: kaspi.map((k) => `${k.farm}:${k.invoiceId}:${Math.round(k.amount)}`).join(", "),
    sentByEmail: email,
    error,
  };
}
