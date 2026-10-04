import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Включить осторожный режим рассылок после блокировки номера: разогрев с сегодняшнего дня
 * (1–2 день — 20 сообщений, 3–4 — 35, 5–7 — 50) и потолок после разогрева. Без --yes — показ.
 *
 *   npx tsx scripts/broadcast-careful.ts [ГГГГ-ММ-ДД начала] [--yes]
 *
 * 04.10.2026: номер заблокировали после рассылок по 50 за раз; владелец: «давай теперь аккуратнее».
 * Правила самой отправки — `broadcast.ts` (pacingWait, pickNextRecipient, effectiveDailyLimit).
 */
import { settingsMap } from "../src/lib/repo/broadcasts";
import { saveSettings } from "../src/lib/repo/settings";
import { DEFAULT_DAILY_LIMIT, effectiveDailyLimit } from "../src/lib/broadcast";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const arg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const from = arg || localDayKey();
  const map = await settingsMap(true);
  console.log(`Сейчас: предел ${map.BroadcastDailyLimit || "(по умолчанию)"}, разогрев с ${map.BroadcastWarmupFrom || "—"}`);
  const next = { BroadcastDailyLimit: String(DEFAULT_DAILY_LIMIT), BroadcastWarmupFrom: from };
  console.log(`Станет: предел ${next.BroadcastDailyLimit}, разогрев с ${from}`);
  for (let i = 0; i < 9; i++) {
    const d = new Date(`${from}T12:00:00`);
    d.setDate(d.getDate() + i);
    const day = localDayKey(d);
    console.log(`  ${day}: не больше ${effectiveDailyLimit(next.BroadcastDailyLimit, from, day)}`);
  }
  if (!process.argv.includes("--yes")) return console.log("Только показ.");
  await saveSettings(next);
  console.log("Сохранено.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
