import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Написать клиенту про отклонённый счёт по заказу бота — тот же текст, что бот
 * теперь шлёт сам по вебхуку ApiPay (`onBotInvoiceUpdate`). Для счетов,
 * отклонённых ДО этой доработки. Без `--send` только показ.
 *
 *   npx tsx scripts/bot-declined-followup.ts 8529 [--send]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { botOrdersOf, dueParts, lastInvoice } from "../src/lib/botOrderRunner";
import { botDeclinedText } from "../src/lib/botOrder";
import { sendBotMessage } from "../src/lib/botFollowUp";
import { orderCode } from "../src/lib/paymentStage";

async function main() {
  const send = process.argv.includes("--send");
  const suffix = process.argv.slice(2).find((a) => /^\d{4,}$/.test(a)) ?? "";
  if (!suffix) throw new Error("Укажите последние цифры номера");
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES]);
  const [orders, invoices] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true })]);
  const phones = Array.from(new Set(orders.filter((o) => o.clientPhone.replace(/\D/g, "").endsWith(suffix)).map((o) => o.clientPhone)));
  for (const phone of phones) {
    for (const order of botOrdersOf(orders, phone, "")) {
      for (const part of dueParts(order)) {
        const last = lastInvoice(invoices, order.orderId, part.farm);
        if (!last || last.status !== "cancelled") continue;
        const code = orderCode(order.orderId);
        const text = botDeclinedText({ code, amount: last.amount });
        console.log(`…${suffix} · заказ №${code}: ${text}`);
        if (send) {
          await sendBotMessage(phone, text, `внимание: клиент отклонил счёт Kaspi по заказу №${code}`);
          console.log("   отправлено");
        }
      }
    }
  }
  if (!send) console.log("Только показ — ничего не отправлено (добавьте --send).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
