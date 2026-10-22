import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Региональный менеджер (`managerProfile.ts`): город клиентов, день отправки фуры, женский род для подсказки ИИ.
 * Пишет настройку `ManagerProfiles` (остальные менеджеры в ней не трогаются).
 *
 *   npx tsx scripts/manager-profile.ts <файл JSON {"email","city","shipWeekday","female"}> [--yes]
 *   npx tsx scripts/manager-profile.ts --show
 *
 * Русские слова — только из файла: из .bat они портятся кодировкой. Без --yes — только показ.
 */
import { readFileSync } from "node:fs";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { saveSettings } from "../src/lib/repo/settings";
import { MANAGER_PROFILES_SETTING, nextShipDay, parseManagerProfiles, shipDayLabel } from "../src/lib/managerProfile";
import { localDayKey } from "../src/lib/timezone";
import { almatyHourOf } from "../src/lib/officeStore";

async function main() {
  const map = await settingsMap(true);
  const profiles = parseManagerProfiles(map[MANAGER_PROFILES_SETTING]);
  const show = () => {
    for (const [email, p] of Object.entries(profiles)) {
      const day = p.shipWeekday ? nextShipDay(localDayKey(), p.shipWeekday, almatyHourOf(new Date())) : "";
      console.log(`  ${email} · город ${p.city || "—"} · фура ${day ? `ближайшая ${shipDayLabel(day)}` : "—"} · ${p.female ? "женский род" : "мужской род"}${p.closer ? " · напористый продавец" : ""}`);
    }
    if (!Object.keys(profiles).length) console.log("  (пусто)");
  };
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file || process.argv.includes("--show")) {
    console.log("Сейчас:");
    return show();
  }
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { email: string; city: string; shipWeekday?: number; female?: boolean };
  const email = (spec.email || "").trim().toLowerCase();
  if (!email.includes("@")) throw new Error("нужна почта менеджера");
  const raw = JSON.parse(map[MANAGER_PROFILES_SETTING] || "{}") as Record<string, unknown>;
  // Флаг «напористый продавец» ставит `manager-closer.ts` — здесь его не теряем.
  const prev = (raw[email] && typeof raw[email] === "object" ? raw[email] : {}) as Record<string, unknown>;
  raw[email] = { city: spec.city || "", shipWeekday: spec.shipWeekday ?? null, female: spec.female === true, closer: prev.closer === true };
  const next = parseManagerProfiles(JSON.stringify(raw));
  Object.assign(profiles, next);
  console.log("Станет:");
  show();
  if (!process.argv.includes("--yes")) return console.log("Только показ. Записать: --yes");
  await saveSettings({ [MANAGER_PROFILES_SETTING]: JSON.stringify(raw) });
  console.log("Записано.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
