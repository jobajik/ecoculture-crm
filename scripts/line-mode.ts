/*
 * Режим ИИ-помощника на номере менеджера: sell (продаёт сам), on (подсказывает и отвечает при молчании),
 * off (только подсказывает). То же, что выбор в «Настройках → WhatsApp менеджеров».
 * Запуск: npx tsx scripts/line-mode.ts <код линии> <sell|on|off>
 * Номер Земфиры (20.10.2026): npx tsx scripts/line-mode.ts leads <on|off> — пишет настройку LeadsAssistant
 * (строки в WaLines у её номера нет; «продаёт сам» там не бывает).
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, updateWaLine } from "../src/lib/repo/waLines";
import { saveSettings } from "../src/lib/repo/settings";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { LEADS_ASSISTANT_SETTING, LEADS_LINE, parseAssistantMode, parseLeadsAssistantMode } from "../src/lib/waLines";

async function main() {
  const [code, raw] = process.argv.slice(2);
  if (code === LEADS_LINE) {
    const mode = parseLeadsAssistantMode(raw);
    if (raw !== mode) throw new Error("для номера Земфиры режим — on / off");
    await saveSettings({ [LEADS_ASSISTANT_SETTING]: mode });
    console.log(`leads: режим ${mode}; сейчас в таблице: ${(await settingsMap(true))[LEADS_ASSISTANT_SETTING]}`);
    return;
  }
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
