import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что с заказами и счетами бота по номеру — ничего не меняет и не отправляет.
 * Владелец, 01.10.2026: «я отклонил оплату, которую бот мне выставил» — какой
 * статус пришёл от ApiPay и что бот сказал клиенту.
 *
 *   npx tsx scripts/diag-bot-invoice.ts 8529
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { listBotChats } from "../src/lib/repo/broadcasts";
import { isBotEmail } from "../src/lib/botIdentity";
import { orderCode } from "../src/lib/paymentStage";
import { apiPayConfig, getInvoice } from "../src/lib/apipay";

async function main() {
  const suffix = (process.argv[2] || "").replace(/\D/g, "");
  if (suffix.length < 4) throw new Error("Укажите последние цифры номера");
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES, SHEET_TABS.BOT_CHATS]);
  const [orders, invoices, chats] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true }), listBotChats(true)]);

  const chat = chats.find((c) => c.phone.replace(/\D/g, "").endsWith(suffix));
  console.log("=== Переписка (последние 10) ===");
  for (const m of chat?.context.slice(-10) ?? []) console.log(`${m.at.slice(5, 16)} ${m.role === "client" ? "КЛ" : "МЫ"}  ${m.text.replace(/\s+/g, " ").slice(0, 220)}`);
  if (chat) console.log(`nudge: ${JSON.stringify(chat.nudge)} · ответов бота: ${chat.botReplies}`);

  const mine = orders.filter((o) => isBotEmail(o.managerEmail) && o.clientPhone.replace(/\D/g, "").endsWith(suffix));
  console.log(`\n=== Заказы бота: ${mine.length} ===`);
  for (const o of mine) {
    console.log(`№${orderCode(o.orderId)} ${o.orderId} · ${o.createdAt.slice(0, 16)} · статус ${o.status} · сумма ${o.totalAmount} · оплачено ${o.paidAmount} · доставка ${o.deliveryDate}`);
    for (const i of invoices.filter((x) => x.orderId === o.orderId)) {
      console.log(`   счёт ${i.invoiceId} ${i.farm} ${i.amount} на ${i.phone}: ${i.status} · ошибка «${i.errorCode} ${i.errorMessage}» · создан ${i.createdAt.slice(0, 16)} · обновлён ${i.updatedAt.slice(0, 16)}`);
      const cfg = apiPayConfig(i.farm);
      if (!cfg) continue;
      try {
        const live = await getInvoice(cfg, i.invoiceId);
        console.log(`   ApiPay сейчас: ${JSON.stringify(live)}`);
      } catch (err) {
        console.log(`   ApiPay: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
