/*
 * Режим ИИ-помощника на номере менеджера: sell (продаёт сам), on (подсказывает и отвечает при молчании),
 * off (только подсказывает). То же, что выбор в «Настройках → WhatsApp менеджеров».
 * Запуск: npx tsx scripts/line-mode.ts <код линии> <sell|on|off>
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, updateWaLine } from "../src/lib/repo/waLines";
import { parseAssistantMode } from "../src/lib/waLines";

async function main() {
  const [code, raw] = process.argv.slice(2);
  const mode = parseAssistantMode(raw);
  if (!code || raw !== mode) throw new Error("нужны код линии и режим sell / on / off");
  const ok = await updateWaLine(code, { Assistant: mode, UpdatedAt: new Date().toISOString() });
  console.log(ok ? `${code}: режим ${mode}` : `нет линии ${code}`);
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  console.log(`сейчас в таблице: ${line?.assistant}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
