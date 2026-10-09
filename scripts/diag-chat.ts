import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Переписка одного номера, как её видел бот: сообщения из WaMessages (с секундами и номерами
 * уведомлений — видно, пришли ли два сообщения одновременно), память бота (BotChats) и склад, который
 * бот видел (основной и офис). Ничего не меняет.
 *
 *   npx tsx scripts/diag-chat.ts <последние цифры номера> [дней=2] [слово для склада]
 *
 * 09.10.2026, владелец со снимком: бот дважды подряд написал «Роза Jumilia, 40 см — около 100 шт.»,
 * хотя клиентка ответила «мне 1000 надо».
 */
import { listWaMessages } from "../src/lib/repo/talks";
import { listBotChats } from "../src/lib/repo/broadcasts";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { stockForBot } from "../src/lib/botKnowledge";
import { inStore } from "../src/lib/officeStore";
import { listHarvestForecast } from "../src/lib/repo/harvestForecast";
import { weekOfDate } from "../src/lib/constants";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const tail = String(process.argv[2] || "").replace(/\D/g, "");
  const days = Number(process.argv[3] || 2);
  const word = String(process.argv[4] || "").toLowerCase();
  if (tail.length < 4) throw new Error("Укажите последние цифры номера");
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const msgs = (await listWaMessages())
    .filter((m) => m.phone.replace(/\D/g, "").endsWith(tail) && m.at >= since)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  console.log(`Сообщений за ${days} дн.: ${msgs.length}`);
  for (const m of msgs) {
    console.log(`${m.at.slice(5, 19)} ${m.direction === "in" ? "КЛ " : "МЫ "} [${m.type}|${m.source}] ${m.messageId.slice(-8)}: ${m.text.replace(/\s+/g, " ").slice(0, 200)}`);
  }

  const chat = (await listBotChats(true)).find((c) => c.phone.replace(/\D/g, "").endsWith(tail));
  if (!chat) console.log("\nПамяти бота нет");
  else {
    console.log(`\nПамять бота: режим ${chat.mode} · обновлено ${chat.updatedAt} · ответов ${chat.botReplies} · последний входящий ${chat.lastInMessageId.slice(-8)} · человек писал ${chat.humanAt || "—"}`);
    console.log(`дожим: ${JSON.stringify(chat.nudge)} · записка: ${chat.handoffReason.slice(0, 200) || "—"}`);
    for (const c of chat.context) console.log(`  ${c.at.slice(5, 19)} ${c.role === "client" ? "КЛ" : "МЫ"}: ${c.text.replace(/\s+/g, " ").slice(0, 200)}`);
  }

  if (word) {
    const [batches, settings] = await Promise.all([listBatches(), getSettings()]);
    const now = new Date();
    for (const [label, store] of [["основной", ""], ["офис", "office"]] as const) {
      const lines = stockForBot(inStore(batches, store), settings, now)
        .split("\n")
        .filter((l) => l.toLowerCase().includes(word));
      console.log(`\nСклад ${label} — строки с «${word}»:\n${lines.join("\n") || "  нет"}`);
    }
    const week = weekOfDate(new Date(`${localDayKey()}T12:00:00`));
    const fc = (await listHarvestForecast()).filter((r) => r.period >= week.slice(0, 7) && r.targetStems > 0);
    console.log(`\nПрогноз срезки (с ${week}): строк всего ${fc.length}, по «${word}»:`);
    for (const r of fc.filter((r) => `${r.flowerType} ${r.variety}`.toLowerCase().includes(word))) {
      console.log(`  ${r.period} ${r.flowerType} ${r.variety}: ${r.targetStems}`);
    }
    const byPeriod = new Map<string, number>();
    for (const r of fc) byPeriod.set(`${r.period} ${r.flowerType}`, (byPeriod.get(`${r.period} ${r.flowerType}`) ?? 0) + r.targetStems);
    for (const [k, v] of byPeriod) console.log(`  итого ${k}: ${v}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
