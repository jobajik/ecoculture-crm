import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Кого бот дожал бы сейчас и что написал бы — НИЧЕГО не отправляет и не пишет
 * (`botNudge.ts`). Час по Алматы можно подставить вторым словом, чтобы
 * посмотреть дневной расклад ночью: `npx tsx scripts/diag-bot-nudge.ts 5 12`.
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listBotChats, listBroadcasts, listRecipients, settingsMap } from "../src/lib/repo/broadcasts";
import { botSettingsFrom } from "../src/lib/broadcast";
import { NUDGE_DECISION_SCHEMA, nudgeDecisionPrompt, nudgeDue, nudgeStatus, nudgeText, parseNudgeDecision, pickNudgeOffers } from "../src/lib/botNudge";
import { FOLLOWUP_LAST_RUN } from "../src/lib/botFollowUpRun";
import { chatJson } from "../src/lib/openai";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceFor } from "../src/lib/priceList";
import { lastBroadcastForBot, stockMap } from "../src/lib/botKnowledge";
import { FLOWER_TYPE_LABELS, formatGrade, isLiquidGrade } from "../src/lib/constants";

const mask = (phone: string) => `…${String(phone).replace(/\D/g, "").slice(-4)}`;

async function main() {
  const limit = Math.max(1, Number(process.argv[2]) || 5);
  const forcedHour = process.argv[3] !== undefined ? Number(process.argv[3]) : NaN;
  await prefetchTables([SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS, SHEET_TABS.BATCHES, SHEET_TABS.PRICE_HISTORY, SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS]);
  const [chats, map, batches, shelf, prices, broadcasts, recipients] = await Promise.all([
    listBotChats(true),
    settingsMap(),
    listBatches(),
    getSettings(),
    getCurrentPrices(),
    listBroadcasts(),
    listRecipients(),
  ]);
  const stock = Array.from(stockMap(batches, shelf, new Date()).values());
  const label = (o: { flowerType: string; variety: string; grade: string }) => `${FLOWER_TYPE_LABELS[o.flowerType] ?? o.flowerType} ${o.variety}, ${formatGrade(o.grade)}`;
  const settings = botSettingsFrom(map);
  const now = new Date();
  const realHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(now)) % 24;
  const hour = Number.isFinite(forcedHour) ? forcedHour : realHour;
  const due = chats.map((c) => ({ c, attempt: nudgeDue({ settings, chat: c, now, hour }) })).filter((x) => x.attempt > 0);
  console.log(`Последний запуск дожима: ${map[FOLLOWUP_LAST_RUN] || "ни разу"}`);
  const reasons = new Map<string, number>();
  for (const c of chats) {
    const r = nudgeStatus({ settings, chat: c, now, hour }).reason.replace(/[\d.]+ ч из [\d.]+/, "…");
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  console.log("Почему (по чатам):");
  for (const [r, n] of Array.from(reasons.entries()).sort((a, b) => b[1] - a[1])) console.log(`   ${n} — ${r}`);
  const touched = chats.filter((c) => (c.nudge?.count ?? 0) > 0);
  console.log(`Уже дожимали: ${touched.length}`);
  for (const c of touched) console.log(`   ${mask(c.phone)} · касаний ${c.nudge.count} · последнее ${c.nudge.at.slice(0, 16)}${c.nudge.done ? " · закрыт" : ""}`);
  console.log(`Час по Алматы: ${hour}${Number.isFinite(forcedHour) ? " (подставлен)" : ""}. Пора дожать: ${due.length} из ${chats.length} чатов.`);
  for (const { c, attempt } of due.slice(0, limit)) {
    const last = c.context[c.context.length - 1];
    const silent = (now.getTime() - Date.parse(last?.at || "")) / 3600000;
    console.log(`\n${mask(c.phone)} · касание №${attempt} · молчит ${Math.round(silent)} ч`);
    for (const line of c.context.slice(-3)) console.log(`   ${line.role === "client" ? "КЛ" : "МЫ"}  ${line.text.replace(/\s+/g, " ").slice(0, 140)}`);
    try {
      const transcript = c.context.map((x) => `${x.role === "client" ? "Клиент" : "Мы"}: ${x.text}`).join("\n");
      const { data } = await chatJson(nudgeDecisionPrompt(), `Переписка:\n${transcript}`, "nudge_decision", NUDGE_DECISION_SCHEMA as unknown as Record<string, unknown>, { fast: true });
      const d = parseNudgeDecision(data);
      if (!d.nudge) {
        console.log(`   БОТ → не дожимать (${d.reason || "—"})`);
      } else {
        const offers = pickNudgeOffers({ stock, priceOf: (f, v, g) => priceFor(prices, f, v, g), mentioned: `${transcript}\n${lastBroadcastForBot(broadcasts, recipients, c.phone)}`, isLiquid: isLiquidGrade });
        console.log(`   БОТ → ${nudgeText(attempt, offers, label)}  [${d.reason}]`);
      }
    } catch (err) {
      console.log(`   ошибка: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
