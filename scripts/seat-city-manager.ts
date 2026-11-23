/*
 * Посадить менеджера в город — то же, что «Настройки → Регионы → Менеджер города → Сохранить» (`setRegionDirector`),
 * но по имени и с ПК: владелец завёл сотрудников и попросил «сделать все настройки» (24.11.2026). Без --yes — показ.
 *
 * Сотрудник ищется по имени среди ДЕЙСТВУЮЩИХ с ролью «Менеджер»; не нашёлся или нашлось несколько — отказ со списком
 * (угадывать нельзя: посадка даёт склад города и его клиентов). Уже посаженный в другой город — отказ: сначала решить,
 * откуда его снимать. Прежний главный менеджер города снимается с города (как в «Настройках»), остальные остаются.
 * Почты и номера не печатает.
 *
 *   npx tsx scripts/seat-city-manager.ts <json> [--yes]
 *   json: [ { "store": "astana", "name": "Алексей", "female": false }, { "store": "karaganda", "name": "Нургуль", "female": true } ]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { listUsers } from "../src/lib/repo/users";
import { managerProfiles, updateManagerProfiles } from "../src/lib/repo/regionStore";
import { isRegionStore, normalizeStore, regionStoreForCity, regionStoreInfo, type StoreCode } from "../src/lib/officeStore";
import { regionSeat, setRegionDirector } from "../src/lib/regionTruck";
import { ROLES } from "../src/lib/constants";

const DAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { store: string; name: string; female?: boolean; weekday?: number }[];
  const [users, profiles] = await Promise.all([listUsers(), managerProfiles(true)]);
  const managers = users.filter((u) => u.active && u.role === ROLES.MANAGER);
  const cityOf = (email: string) => {
    const key = Object.keys(profiles).find((k) => k.toLowerCase() === email.toLowerCase());
    return key ? regionStoreForCity(profiles[key].city) : "";
  };
  console.log(`Действующих менеджеров: ${managers.length} — ${managers.map((u) => `${u.name || "без имени"}${cityOf(u.email) ? ` (${regionStoreInfo(cityOf(u.email))?.label})` : ""}${u.phone ? "" : " [нет WhatsApp в карточке]"}`).join("; ")}`);

  const plan: { store: StoreCode; email: string; name: string; female: boolean; weekday: number }[] = [];
  for (const s of spec) {
    const store = normalizeStore(s.store) as StoreCode;
    const info = regionStoreInfo(store);
    if (!isRegionStore(store) || !info) throw new Error(`Город «${s.store}» не из списка регионов`);
    const want = norm(s.name);
    const found = managers.filter((u) => norm(u.name).split(/\s+/).some((w) => w === want) || norm(u.name) === want);
    if (found.length !== 1) throw new Error(`«${s.name}»: ${found.length === 0 ? "такого действующего менеджера нет" : `подходят несколько — ${found.map((u) => u.name).join(", ")}`}. Ничего не записано`);
    const user = found[0];
    const now = cityOf(user.email);
    if (now && now !== store) throw new Error(`${user.name} уже посажен в ${regionStoreInfo(now)?.label} — сначала решите, снимать ли его оттуда. Ничего не записано`);
    const seat = regionSeat(profiles, store);
    const weekday = Number.isInteger(s.weekday) && s.weekday! >= 1 && s.weekday! <= 7 ? s.weekday! : seat.truckWeekday;
    const nameOf = (e: string) => users.find((u) => u.email.toLowerCase() === e.toLowerCase())?.name || "?";
    console.log(`\n${info.label}: сейчас главный — ${seat.directors.map(nameOf).join(", ") || "не назначен"}; ещё в городе — ${seat.managers.map(nameOf).join(", ") || "никого"}; фура — ${DAYS[seat.truckWeekday]}`);
    console.log(`  станет: главный — ${user.name} (${s.female ? "женский" : "мужской"} род для ИИ), фура — ${DAYS[weekday]}${seat.directors.length && !seat.directors.some((e) => e.toLowerCase() === user.email.toLowerCase()) ? `; ${seat.directors.map(nameOf).join(", ")} с города снимается` : ""}`);
    plan.push({ store, email: user.email.toLowerCase(), name: user.name, female: s.female === true, weekday });
  }
  if (!yes) return console.log("\nТолько показ. Записать: --yes");
  await updateManagerProfiles((raw) => {
    let next = raw;
    for (const p of plan) {
      next = setRegionDirector(next, { store: p.store, email: p.email, weekday: p.weekday });
      const key = Object.keys(next).find((k) => k.trim().toLowerCase() === p.email)!;
      next[key] = { ...next[key], female: p.female };
    }
    return next;
  });
  const after = await managerProfiles(true);
  for (const p of plan) {
    const seat = regionSeat(after, p.store);
    console.log(`${regionStoreInfo(p.store)?.label}: записано — главный ${seat.directors.some((e) => e.toLowerCase() === p.email) ? p.name : "НЕ ЗАПИСАЛСЯ"}, фура — ${DAYS[seat.truckWeekday]}`);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
