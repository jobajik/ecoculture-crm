import { commitAtomic, prefetchTables, SHEET_TABS } from "./sheets";
import { getOrderById, listOrdersWithItems } from "./repo/orders";
import { listKaspiInvoices } from "./repo/kaspiInvoices";
import { botChatWrite, emptyBotChat, listBotChats } from "./repo/broadcasts";
import { appendDebtReminder, listDebtReminders } from "./repo/debtReminders";
import { greenConfig, sendText } from "./greenApi";
import { phoneKey } from "./leads";
import { pushContext } from "./broadcast";
import { orderCode } from "./paymentStage";
import { ORDER_STATUSES } from "./constants";
import { isOpenKaspiStatus, isPaidKaspiStatus, kaspiErrorText } from "./kaspiInvoice";
import { BOT_MANAGER_EMAIL, isBotEmail } from "./botIdentity";
import { botInvoiceErrorText, botPaidText, botReminderText } from "./botOrder";
import { dueParts, invoicePart, lastInvoice } from "./botOrderRunner";
import type { KaspiInvoice } from "./types";

// ---------------------------------------------------------------------------
// Бот доводит заказ до денег: пишет клиенту, когда оплата пришла или счёт не
// дошёл (из вебхука ApiPay), и напоминает о неоплаченном (расписание утром и
// вечером). Только по заявкам бота. Ничего не бросает: сбой здесь не должен
// ронять ни вебхук оплаты, ни сводку.
// ---------------------------------------------------------------------------

/** Написать клиенту от имени бота и запомнить это в памяти чата. */
export async function sendBotMessage(phone: string, text: string): Promise<string> {
  const cfg = greenConfig();
  if (!cfg) return "";
  const id = await sendText(cfg, phone, text);
  try {
    const chats = await listBotChats(true);
    const key = phoneKey(phone);
    const found = chats.find((c) => phoneKey(c.phone) === key);
    const chat = found ? { ...found, context: [...found.context], ourIds: [...found.ourIds] } : emptyBotChat(phone.replace(/\D/g, ""));
    chat.ourIds = [...chat.ourIds, id].slice(-20);
    chat.context = pushContext(chat.context, { role: "us", text, at: new Date().toISOString() });
    await commitAtomic([botChatWrite(chat, found?.rowNumber ?? null)]);
  } catch (err) {
    console.error("bot memory:", err instanceof Error ? err.message : err);
  }
  return id;
}

/**
 * Счёт Kaspi по заявке бота сменил статус (вебхук ApiPay). Оплачен — спасибо и
 * «передан на сборку»; не дошёл — попросить номер Kaspi. Остальное — молча.
 */
export async function onBotInvoiceUpdate(invoice: KaspiInvoice, status: string, errorCode: string, errorMessage: string): Promise<void> {
  try {
    const paid = isPaidKaspiStatus(status);
    if (!paid && status !== "error") return;
    const order = await getOrderById(invoice.orderId);
    if (!order || !isBotEmail(order.managerEmail) || !order.clientPhone) return;
    const code = orderCode(order.orderId);
    const text = paid
      ? botPaidText({ code, amount: invoice.amount, fullyPaid: order.paid, deliveryDate: order.deliveryDate })
      : botInvoiceErrorText({ code, phone: invoice.phone, reason: kaspiErrorText(errorCode, errorMessage) });
    await sendBotMessage(order.clientPhone, text);
  } catch (err) {
    console.error("bot invoice follow-up:", err instanceof Error ? err.message : err);
  }
}

const REMIND_AFTER_HOURS = 3;
const REMIND_GAP_HOURS = 20;

/**
 * Напомнить об оплате по заявкам бота: счёт ждёт дольше 3 часов — напомнить;
 * истёк или отменён — выставить заново и сказать об этом. Не чаще раза в
 * 20 часов на заявку (журнал — вкладка DebtReminders, подпись — почта бота).
 * Зовут утренняя сводка и вечерний разбор.
 */
export async function remindBotInvoices(now: Date = new Date()): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;
  try {
    await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES, SHEET_TABS.DEBT_REMINDERS]);
    const [orders, invoices, reminders] = await Promise.all([listOrdersWithItems(), listKaspiInvoices(), listDebtReminders()]);
    const since = now.getTime() - 7 * 24 * 3600000;
    for (const order of orders) {
      if (!isBotEmail(order.managerEmail) || order.status === ORDER_STATUSES.CANCELLED || order.paid || !order.clientPhone) continue;
      const created = Date.parse(order.createdAt || "");
      if (!(created >= since) || now.getTime() - created < REMIND_AFTER_HOURS * 3600000) continue;
      const lastReminder = reminders
        .filter((r) => r.orderIds.includes(order.orderId) && r.sentByEmail === BOT_MANAGER_EMAIL)
        .reduce((max, r) => Math.max(max, Date.parse(r.sentAt) || 0), 0);
      if (now.getTime() - lastReminder < REMIND_GAP_HOURS * 3600000) continue;

      const texts: string[] = [];
      let amount = 0;
      for (const part of dueParts(order)) {
        const last = lastInvoice(invoices, order.orderId, part.farm);
        if (!last) continue; // счёт не выставлялся (касса не подключена) — это забота бухгалтера
        if (isOpenKaspiStatus(last.status) && Date.now() - Date.parse(last.createdAt) >= REMIND_AFTER_HOURS * 3600000) {
          texts.push(botReminderText({ code: orderCode(order.orderId), amount: part.due, reissued: false }));
          amount += part.due;
        } else if (last.status === "expired" || last.status === "cancelled") {
          const r = await invoicePart(order, part.farm, part.due, last.phone);
          if (r.result === "sent") {
            texts.push(botReminderText({ code: orderCode(order.orderId), amount: part.due, reissued: true }));
            amount += part.due;
          }
        }
      }
      if (texts.length === 0) continue;
      let messageId = "";
      let error = "";
      try {
        messageId = await sendBotMessage(order.clientPhone, texts.join("\n"));
        sent += 1;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        errors += 1;
      }
      await appendDebtReminder({
        phone: order.clientPhone.replace(/\D/g, ""),
        clientName: order.clientName,
        orderIds: [order.orderId],
        amount,
        messageId,
        kaspiInvoices: "",
        sentByEmail: BOT_MANAGER_EMAIL,
        error,
      });
    }
  } catch (err) {
    console.error("bot reminders:", err instanceof Error ? err.message : err);
    errors += 1;
  }
  return { sent, errors };
}
