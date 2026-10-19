/*
 * Утренний план менеджеру с продающим помощником — как выглядит сегодня, БЕЗ отправки (--send — отправить).
 * Запуск: npx tsx scripts/diag-line-plan.ts [--send]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { lineMorningPlans } from "../src/lib/lineMorningPlan";

async function main() {
  const plans = await lineMorningPlans({ send: process.argv.includes("--send") });
  if (plans.length === 0) console.log("Нет номеров в режиме «продаёт сам».");
  for (const p of plans) console.log(`=== ${p.line}${p.sent ? " — отправлен" : ""} ===\n${p.text || "(пусто — не отправляется)"}\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
