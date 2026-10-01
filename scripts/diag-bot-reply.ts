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
import { listBotChats, listBroadcasts, settingsMap } from "../src/lib/repo/broadcasts";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { botSettingsFrom } from "../src/lib/broadcast";
import { lastBroadcastForBot, stockForBot } from "../src/lib/botKnowledge";
import { botReply } from "../src/lib/botEngine";

const mask = (phone: string) => `…${String(phone).replace(/\D/g, "").slice(-4)}`;

async function main() {
  const limit = Math.max(1, Number(process.argv[2]) || 8);
  await prefetchTables([SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS, SHEET_TABS.BATCHES, SHEET_TABS.BROADCASTS]);
  const [chats, map, batches, settings, broadcasts] = await Promise.all([
    listBotChats(),
    settingsMap(),
    listBatches(),
    getSettings(),
    listBroadcasts(),
  ]);
  const bot = botSettingsFrom(map);

  const stock = stockForBot(batches, settings, new Date());
  console.log("=== Склад для бота (первые 15 строк) ===");
  console.log(stock.split("\n").slice(0, 15).join("\n") || "(пусто)");
  console.log(`всего строк: ${stock ? stock.split("\n").length : 0}`);
  console.log("\n=== Последняя рассылка для бота ===");
  console.log(lastBroadcastForBot(broadcasts) || "(нет)");

  const waiting = chats
    .filter((c) => c.mode !== "optout" && c.context.length > 0 && c.context[c.context.length - 1].role === "client")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit);
  console.log(`\n=== Чаты, где последним писал клиент: показываю ${waiting.length} ===`);
  for (const c of waiting) {
    console.log(`\n${mask(c.phone)} · режим ${c.mode} · обновлён ${c.updatedAt.slice(0, 16)}`);
    for (const line of c.context.slice(-4)) console.log(`   ${line.role === "client" ? "КЛ" : "МЫ"}  ${line.text.replace(/\s+/g, " ").slice(0, 140)}`);
    try {
      const d = await botReply(c, bot.instructions);
      if (d.silent) console.log("   БОТ → молчит (автоответ/нечего отвечать)");
      else console.log(`   БОТ → ${d.reply.replace(/\s+/g, " ")}${d.handoff ? `  [менеджеру: ${d.reason || "—"}]` : ""}`);
    } catch (err) {
      console.log(`   БОТ → ошибка: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
