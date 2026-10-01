import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Кого бот дожал бы сейчас и что написал бы — НИЧЕГО не отправляет и не пишет
 * (`botNudge.ts`). Час по Алматы можно подставить вторым словом, чтобы
 * посмотреть дневной расклад ночью: `npx tsx scripts/diag-bot-nudge.ts 5 12`.
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listBotChats, settingsMap } from "../src/lib/repo/broadcasts";
import { botSettingsFrom } from "../src/lib/broadcast";
import { nudgeDue, nudgeTask } from "../src/lib/botNudge";
import { botReply } from "../src/lib/botEngine";

const mask = (phone: string) => `…${String(phone).replace(/\D/g, "").slice(-4)}`;

async function main() {
  const limit = Math.max(1, Number(process.argv[2]) || 5);
  const forcedHour = process.argv[3] !== undefined ? Number(process.argv[3]) : NaN;
  await prefetchTables([SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS]);
  const [chats, map] = await Promise.all([listBotChats(true), settingsMap()]);
  const settings = botSettingsFrom(map);
  const now = new Date();
  const realHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(now)) % 24;
  const hour = Number.isFinite(forcedHour) ? forcedHour : realHour;
  const due = chats.map((c) => ({ c, attempt: nudgeDue({ settings, chat: c, now, hour }) })).filter((x) => x.attempt > 0);
  console.log(`Час по Алматы: ${hour}${Number.isFinite(forcedHour) ? " (подставлен)" : ""}. Пора дожать: ${due.length} из ${chats.length} чатов.`);
  for (const { c, attempt } of due.slice(0, limit)) {
    const last = c.context[c.context.length - 1];
    const silent = (now.getTime() - Date.parse(last?.at || "")) / 3600000;
    console.log(`\n${mask(c.phone)} · касание №${attempt} · молчит ${Math.round(silent)} ч`);
    for (const line of c.context.slice(-3)) console.log(`   ${line.role === "client" ? "КЛ" : "МЫ"}  ${line.text.replace(/\s+/g, " ").slice(0, 140)}`);
    try {
      const d = await botReply(c, settings.instructions, nudgeTask(attempt, silent));
      console.log(d.silent || !d.reply ? "   БОТ → не дожимать (закроет разговор)" : `   БОТ → ${d.reply.replace(/\s+/g, " ")}`);
    } catch (err) {
      console.log(`   ошибка: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
