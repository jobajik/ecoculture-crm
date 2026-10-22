import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Напористый продавец на номере менеджера (`ManagerProfile.closer`, 22.10.2026, владелец про Ильгара: «сделай его
 * агрессивнее в продажах»): помощник «продаёт сам» в каждом ответе ведёт к сделке и дожимает молчащих дважды.
 * Пишет флаг в настройку `ManagerProfiles` по почте менеджера линии; город, фура и род не трогаются.
 *
 *   npx tsx scripts/manager-closer.ts <код линии> [--off] [--yes]
 *
 * Без --yes — только показ.
 */
import { settingsMap } from "../src/lib/repo/broadcasts";
import { saveSettings } from "../src/lib/repo/settings";
import { listWaLines } from "../src/lib/repo/waLines";
import { MANAGER_PROFILES_SETTING, parseManagerProfiles } from "../src/lib/managerProfile";

async function main() {
  const code = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!code) throw new Error("нужен код линии, например m-ilgargasanov828");
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  if (!line) throw new Error(`нет линии ${code}`);
  const email = line.managerEmail.trim().toLowerCase();
  const on = !process.argv.includes("--off");
  const map = await settingsMap(true);
  const raw = JSON.parse(map[MANAGER_PROFILES_SETTING] || "{}") as Record<string, Record<string, unknown>>;
  const prev = raw[email] && typeof raw[email] === "object" ? raw[email] : { city: "", shipWeekday: null, female: false };
  console.log(`${code} · менеджер ${email} · режим помощника ${line.assistant} · сейчас напористый: ${prev.closer === true ? "да" : "нет"} → станет: ${on ? "да" : "нет"}`);
  if (line.assistant !== "sell") console.log("  внимание: блок работает только в режиме «продаёт сам» (line-mode.ts <код> sell)");
  if (!process.argv.includes("--yes")) return console.log("Только показ. Записать: --yes");
  raw[email] = { ...prev, closer: on };
  await saveSettings({ [MANAGER_PROFILES_SETTING]: JSON.stringify(raw) });
  const check = parseManagerProfiles((await settingsMap(true))[MANAGER_PROFILES_SETTING])[email];
  console.log(`Записано. В таблице: напористый ${check?.closer ? "да" : "нет"}, город ${check?.city || "—"}, фура ${check?.shipWeekday ?? "—"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
