/*
 * Сотрудники в CRM — кто заведён и с какой ролью (24.11.2026: владелец завёл менеджеров городов, а среди менеджеров их
 * не оказалось). Ничего не меняет; почты и номера не печатает — только имя, роль, включён ли, есть ли номер WhatsApp в
 * карточке, в какой город посажен и подключён ли его номер к CRM.
 *
 *   npx tsx scripts/diag-staff.ts [слово в имени…]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listUsers } from "../src/lib/repo/users";
import { listWaLines } from "../src/lib/repo/waLines";
import { managerProfiles } from "../src/lib/repo/regionStore";
import { readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { regionStoreForCity, regionStoreInfo } from "../src/lib/officeStore";
import { ROLE_LABELS } from "../src/lib/constants";

async function main() {
  const words = process.argv.slice(2).map((w) => w.toLowerCase());
  const [users, lines, profiles, table] = await Promise.all([listUsers(), listWaLines({ fresh: true }), managerProfiles(true), readTable(SHEET_TABS.USERS, { fresh: true })]);
  console.log(`Строк во вкладке Users: ${table.rows.length}; прочитано сотрудников: ${users.length}`);
  const labels = ROLE_LABELS as Record<string, string>;
  const sorted = [...users].sort((a, b) => a.role.localeCompare(b.role) || (a.name || "").localeCompare(b.name || "", "ru"));
  for (const u of sorted) {
    if (words.length && !words.some((w) => (u.name || "").toLowerCase().includes(w))) continue;
    const key = Object.keys(profiles).find((k) => k.toLowerCase() === u.email.toLowerCase());
    const city = key ? regionStoreInfo(regionStoreForCity(profiles[key].city))?.label : "";
    const line = lines.find((l) => l.managerEmail.toLowerCase() === u.email.toLowerCase());
    console.log(`  ${(u.name || "(без имени)").padEnd(28)} ${(labels[u.role] ?? (u.role || "РОЛЬ ПУСТАЯ")).padEnd(32)} ${u.active ? "включён " : "ОТКЛЮЧЁН"} · WhatsApp в карточке: ${u.phone ? "есть" : "нет"}${city ? ` · город: ${city}${key && profiles[key].director ? " (главный)" : ""}` : ""}${line ? ` · номер в CRM: ${line.tokenEnc ? "с ключами" : "без ключей"}, ${line.active ? "включён" : "выключен"}` : ""}`);
  }
  // Строки, которые таблица хранит, а программа не прочитала (пустая почта, например) — их тоже показать.
  const read = new Set(users.map((u) => u.email.toLowerCase()));
  const lost = table.rows.map((row) => rowToRecord(SHEET_TABS.USERS, row)).filter((r) => !read.has(String(r.Email || "").trim().toLowerCase()));
  if (lost.length) console.log(`\nСтроки, которые не стали сотрудниками (${lost.length}): ${lost.map((r) => `имя «${r.Name || ""}», роль «${r.Role || ""}», почта ${r.Email ? "есть" : "ПУСТАЯ"}`).join("; ")}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
