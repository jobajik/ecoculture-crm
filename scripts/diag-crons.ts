/*
 * Работают ли расписания Vercel (сводка 9:00, разбор переписок 19:00, копия 01:00).
 * Печатает: есть ли CRON_SECRET у себя (только «есть/нет», без значения), когда
 * последний раз разбор делало расписание, сколько номеров для сводки. С ключом
 * --send вызывает /api/digest на сайте тем же секретом — то есть отправляет
 * сводку прямо сейчас и показывает ответ сайта.
 *
 * Запуск: npx tsx scripts/diag-crons.ts [--send]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listLeadAnalyses } from "../src/lib/repo/talks";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { DIGEST_SETTING, digestPhones } from "../src/lib/morningDigest";

async function main() {
  const secret = process.env.CRON_SECRET || "";
  console.log(`CRON_SECRET в .env.local: ${secret ? `есть (длина ${secret.length})` : "НЕТ"}`);

  const analyses = await listLeadAnalyses();
  const byCron = analyses.filter((a) => a.createdByEmail === "cron").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  console.log(`Разборов переписки расписанием: ${byCron.length}, последний: ${byCron[0]?.createdAt || "никогда"}`);

  const map = await settingsMap(true);
  const phones = digestPhones(map[DIGEST_SETTING]);
  console.log(`Номеров для сводки: ${phones.length}`);
  if (map.DigestLastRun) console.log(`Последний запуск сводки: ${map.DigestLastRun}`);

  if (process.argv.includes("--send")) {
    if (!secret) {
      console.log("Отправить нечем: нет CRON_SECRET");
      return;
    }
    const res = await fetch("https://www.crm-ecoculture.kz/api/digest", {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(70000),
    });
    console.log(`Сайт ответил: ${res.status} ${(await res.text()).slice(0, 300)}`);
    if (res.status === 403) console.log("403 = на Vercel CRON_SECRET другой или его нет — расписание тоже получает отказ");
  }
}

main().catch((err) => {
  console.error("ОШИБКА:", err instanceof Error ? err.message : err);
  process.exit(1);
});
