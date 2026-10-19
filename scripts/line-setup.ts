/*
 * Номер менеджера: заново прописать адрес уведомлений (перепривязка по QR его стирает), дописать
 * переписку за 2 дня и историю чатов из Green API. То же, что «Готово, отсканировал» и «Подтянуть
 * переписку» в «Настройках», но с ПК и без ограничения в минуту. Ключи не печатает.
 * Запуск: npx tsx scripts/line-setup.ts <код линии> [секунд на историю]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";
import { pullLineHistory, setupLine } from "../src/lib/leadsLineSetup";

const SITE = "https://www.crm-ecoculture.kz";

async function main() {
  const code = process.argv[2] || "";
  const seconds = Number(process.argv[3] || 150);
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  if (!line) throw new Error(`Нет линии ${code}`);
  const cfg = managerLineConfig(line);
  if (!cfg) throw new Error("Нет ключа линии");
  for (const s of await setupLine(cfg, line.code, SITE, 2)) console.log(s);
  let offset = 0;
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    const log = await pullLineHistory(cfg, line.code, Math.max(10000, seconds * 1000 - (Date.now() - started)), offset);
    for (const s of log) console.log(s);
    const next = log.map((x) => /offset=(\d+)/.exec(x)?.[1]).find(Boolean);
    if (!next) break;
    offset = Number(next);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
