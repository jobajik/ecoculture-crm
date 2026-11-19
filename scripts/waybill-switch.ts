import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Накладная клиенту после отгрузки (`src/lib/waybill.ts`): включить, выключить, посмотреть.
 *
 *   npx tsx scripts/waybill-switch.ts show
 *   npx tsx scripts/waybill-switch.ts on      — включить; точка отсчёта — сейчас: отгруженное раньше клиентам не уйдёт
 *   npx tsx scripts/waybill-switch.ts off
 *
 * То же делает переключатель в «Настройки → Сводка и уведомления».
 */
import { settingsMap } from "../src/lib/repo/broadcasts";
import { saveSettings } from "../src/lib/repo/settings";
import { WAYBILL_AUTO_SETTING, WAYBILL_SINCE_SETTING, waybillAuto } from "../src/lib/waybill";

async function main() {
  const mode = (process.argv[2] || "show").toLowerCase();
  if (mode === "on") await saveSettings({ [WAYBILL_AUTO_SETTING]: "on", [WAYBILL_SINCE_SETTING]: new Date().toISOString() });
  else if (mode === "off") await saveSettings({ [WAYBILL_AUTO_SETTING]: "off" });
  else if (mode !== "show") throw new Error("Ожидается on, off или show");
  const map = await settingsMap(true);
  const auto = waybillAuto(map);
  console.log(`Накладная клиенту после отгрузки: ${auto.on ? "ВКЛЮЧЕНА" : "выключена"}${auto.since ? `, по отгрузкам с ${auto.since}` : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
