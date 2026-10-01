import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что бот ответил бы СЕЙЧАС в чатах, где последним писал клиент, — ничего не
 * отправляет и не записывает. Для проверки подсказки боту на живых чатах
 * (владелец, 01.10.2026: «нужен бот по последней рассылке, который будет сам
 * отвечать»). Плюс начало того, что бот знает: склад и последняя рассылка.
 *
 *   npx tsx scripts/diag-bot-reply.ts [сколько чатов, по умолчанию 8]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listBotChats, listBroadcasts, listRecipients, settingsMap } from "../src/lib/repo/broadcasts";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { botSettingsFrom } from "../src/lib/broadcast";
import { lastBroadcastForBot, pricesForBot, stockForBot, stockMap } from "../src/lib/botKnowledge";
import { planBotOrder } from "../src/lib/botOrder";
import { priceFor } from "../src/lib/priceList";
import { emptyBotChat } from "../src/lib/repo/broadcasts";
import { localDayKey } from "../src/lib/timezone";
import { botReply } from "../src/lib/botEngine";

const mask = (phone: string) => `…${String(phone).replace(/\D/g, "").slice(-4)}`;

async function main() {
  const limit = Math.max(1, Number(process.argv[2]) || 8);
  await prefetchTables([
    SHEET_TABS.BOT_CHATS,
    SHEET_TABS.SETTINGS,
    SHEET_TABS.BATCHES,
    SHEET_TABS.BROADCASTS,
    SHEET_TABS.BROADCAST_RECIPIENTS,
    SHEET_TABS.PRICE_HISTORY,
  ]);
  const [chats, map, batches, settings, broadcasts, recipients, prices] = await Promise.all([
    listBotChats(),
    settingsMap(),
    listBatches(),
    getSettings(),
    listBroadcasts(),
    listRecipients(),
    getCurrentPrices(),
  ]);
  const bot = botSettingsFrom(map);

  const stock = stockForBot(batches, settings, new Date());
  console.log("=== Склад для бота (первые 15 строк) ===");
  console.log(stock.split("\n").slice(0, 15).join("\n") || "(пусто)");
  console.log(`всего строк: ${stock ? stock.split("\n").length : 0}`);
  console.log("\n=== Прайс для бота ===");
  console.log(pricesForBot(Array.from(prices.values())) || "(пусто)");
  console.log("\n=== Рассылка для бота, если номер неизвестен ===");
  console.log(lastBroadcastForBot(broadcasts, recipients) || "(нет)");

  const waiting = chats
    .filter((c) => c.mode !== "optout" && c.context.length > 0 && c.context[c.context.length - 1].role === "client")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit);
  console.log(`\n=== Чаты, где последним писал клиент: показываю ${waiting.length} ===`);
  for (const c of waiting) {
    const own = lastBroadcastForBot(broadcasts, recipients, c.phone);
    console.log(`\n${mask(c.phone)} · режим ${c.mode} · обновлён ${c.updatedAt.slice(0, 16)} · рассылка: ${own.split("\n")[0] || "—"}`);
    for (const line of c.context.slice(-4)) console.log(`   ${line.role === "client" ? "КЛ" : "МЫ"}  ${line.text.replace(/\s+/g, " ").slice(0, 140)}`);
    try {
      const d = await botReply(c, bot.instructions);
      if (d.silent) console.log("   БОТ → молчит (автоответ/нечего отвечать)");
      else console.log(`   БОТ → ${d.reply.replace(/\s+/g, " ")}${d.order.confirmed ? `  [ЗАКАЗ: ${d.order.items.map((i) => `${i.variety} ${i.grade} ${i.quantity}`).join(", ")}, ${d.order.deliveryDate}]` : ""}${d.kaspiPhone ? `  [kaspi: ${d.kaspiPhone}]` : ""}${d.catalog ? `  [каталог: ${d.catalog}]` : ""}${d.alert ? `  [внимание: ${d.alert}]` : ""}`);
    } catch (err) {
      console.log(`   БОТ → ошибка: ${err instanceof Error ? err.message : err}`);
    }
  }
  await scenario(bot.instructions, batches, settings, prices);
}

/**
 * Проверка оформления на выдуманном разговоре: что модель вернёт на «Да» и
 * оформила бы система заявку. Ничего не пишет и не отправляет.
 */
async function scenario(instructions: string, batches: Parameters<typeof stockMap>[0], settings: Parameters<typeof stockMap>[1], prices: Parameters<typeof priceFor>[0]) {
  console.log("\n=== Проверка оформления на выдуманном разговоре (ничего не пишется) ===");
  const chat = emptyBotChat("77000000000");
  const at = new Date().toISOString();
  chat.context = [
    { role: "client", text: "Здравствуйте, Алтай третья категория есть? Нужно 100 штук на завтра", at },
    { role: "us", text: "Здравствуйте! Хризантема Altaj третьей категории есть, 270 ₸ за стебель. 100 шт. — 27 000 ₸. Подскажите название точки и город — и оформлю.", at },
    { role: "client", text: "Магазин «Цветы у дома», Алматы, Абая 10", at },
    { role: "us", text: "Повторяю заказ: хризантема Altaj, Третья — 100 шт. × 270 ₸ = 27 000 ₸, доставка завтра, Алматы, Абая 10. Оформляю?", at },
    { role: "client", text: "Да", at },
  ];
  const d = await botReply(chat, instructions);
  console.log(`модель: confirmed=${d.order.confirmed}, позиции=${JSON.stringify(d.order.items)}, дата=${d.order.deliveryDate}, город=${d.order.city}, точка=${d.order.shopName}`);
  const plan = planBotOrder({
    draft: d.order,
    stock: Array.from(stockMap(batches, settings, new Date()).values()),
    priceOf: (f, v, g) => priceFor(prices, f, v, g),
    today: localDayKey(),
  });
  console.log(plan.ok ? `система оформила бы: ${JSON.stringify(plan.items)} на ${plan.deliveryDate}` : `система спросила бы: ${plan.question}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
