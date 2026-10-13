import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Все разговоры бота за последние дни — для разбора «почему плохо продаёт»: переписка рабочего
 * номера по каждому чату бота (кто писал, что ответил бот), чем кончилось (заявка бота, отказ,
 * тревога, тишина). Ничего не меняет. Пишет в файл (там телефоны клиентов — держать в _private),
 * в консоль — только сводку.
 *
 *   npx tsx scripts/bot-review.ts [дней=5] [файл=../_private/bot-review.txt]
 */
import { writeFileSync } from "node:fs";
import { listWaMessages } from "../src/lib/repo/talks";
import { listBotChats } from "../src/lib/repo/broadcasts";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { phoneKey } from "../src/lib/leads";
import { isBotEmail } from "../src/lib/botIdentity";
import { orderCode } from "../src/lib/paymentStage";

async function main() {
  const days = Number(process.argv[2]) || 5;
  const out = process.argv[3] || "../_private/bot-review.txt";
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [msgs, chats, orders] = await Promise.all([listWaMessages(), listBotChats(true), listOrdersWithItems()]);
  const botKeys = new Set(chats.map((c) => phoneKey(c.phone)));
  const byPhone = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const k = phoneKey(m.phone);
    if (!botKeys.has(k) || m.at < since) continue;
    byPhone.set(k, [...(byPhone.get(k) ?? []), m]);
  }
  const lines: string[] = [];
  let withClient = 0;
  let withOrder = 0;
  for (const [k, list] of byPhone) {
    if (!list.some((m) => m.direction === "in")) continue; // только где клиент что-то написал
    withClient++;
    const chat = chats.find((c) => phoneKey(c.phone) === k);
    const botOrders = orders.filter((o) => isBotEmail(o.managerEmail) && phoneKey(o.clientPhone) === k && o.createdAt >= since);
    if (botOrders.length) withOrder++;
    lines.push(`\n######## …${k.slice(-4)} · режим ${chat?.mode} · ответов бота ${chat?.botReplies} · ${chat?.handoffReason ? `записка «${chat.handoffReason}»` : "без записок"}`);
    lines.push(`заказы бота: ${botOrders.map((o) => `№${orderCode(o.orderId)} ${Math.round(o.totalAmount)} ₸ ${o.status} оплачено ${Math.round(o.paidAmount)}`).join("; ") || "нет"}`);
    for (const m of list.sort((a, b) => (a.at < b.at ? -1 : 1))) {
      lines.push(`${m.at.slice(5, 16).replace("T", " ")} ${m.direction === "in" ? "КЛИЕНТ" : "МЫ    "} [${m.type}] ${m.text.replace(/\s+/g, " ").slice(0, 700)}`);
    }
  }
  writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`за ${days} дн.: чатов бота, где писал клиент, ${withClient}; из них с заказом бота ${withOrder}. Подробно — ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
