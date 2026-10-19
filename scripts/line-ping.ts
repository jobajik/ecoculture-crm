/*
 * Проверка связи номера менеджера: с ОСНОВНОГО номера на номер менеджера уходит короткое служебное
 * сообщение. Если Green API номера менеджера его видит, вебхук `?line=<код>` запишет его в CRM как входящее
 * (дальше — `diag-line-incoming.ts`). Основной номер для помощника и авто-лидов «свой» — ему не ответят.
 * Запуск: npx tsx scripts/line-ping.ts <код линии>
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { greenConfig, sendText } from "../src/lib/greenApi";
import { listWaLines } from "../src/lib/repo/waLines";

async function main() {
  const code = process.argv[2] || "";
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  if (!line?.phone) throw new Error(`нет линии ${code} или у неё нет телефона`);
  const cfg = greenConfig();
  if (!cfg) throw new Error("нет ключей основного номера");
  const id = await sendText(cfg, line.phone, "Проверка связи CRM (отвечать не нужно).", { linkPreview: false });
  console.log(`ушло на …${line.phone.slice(-4)}: ${id ? "да" : "нет"} · ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
