/*
 * Посадить менеджера в город — то же, что «Настройки → Регионы → Менеджер города → Сохранить» (`setRegionDirector`),
 * но по имени и с ПК: владелец завёл сотрудников и попросил «сделать все настройки» (24.11.2026). Без --yes — показ.
 *
 * Сотрудник ищется по имени среди ДЕЙСТВУЮЩИХ с ролью «Менеджер»; не нашёлся или нашлось несколько — отказ со списком
 * (угадывать нельзя: посадка даёт склад города и его клиентов). Уже посаженный в другой город — отказ: сначала решить,
 * откуда его снимать. Прежний главный менеджер города снимается с города (как в «Настройках»), остальные остаются.
 * Почты и номера не печатает.
 *
 * Если сотрудник заведён с другой ролью (24.11.2026: владелец завёл менеджеров городов как «Менеджер розницы
 * (регионы)» — а раздел города, склад города и заказ на фуру есть только у роли «Менеджер»), роль меняется на
 * «Менеджер» только с явным `"makeManager": true`; имя правится через `"rename"`. Номер WhatsApp, доступ к зарплате и
 * включённость при этом не трогаются.
 *
 *   npx tsx scripts/seat-city-manager.ts <json> [--yes]
 *   json: [ { "store": "astana", "name": "Алексей", "female": false }, { "store": "karaganda", "name": "Нургуль", "female": true, "makeManager": true } ]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { listUsers, saveUser } from "../src/lib/repo/users";
import { managerProfiles, updateManagerProfiles } from "../src/lib/repo/regionStore";
import { isRegionStore, normalizeStore, regionStoreForCity, regionStoreInfo, type StoreCode } from "../src/lib/officeStore";
import { regionSeat, setRegionDirector } from "../src/lib/regionTruck";
import { ROLES, ROLE_LABELS } from "../src/lib/constants";

const DAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { store: string; name: string; female?: boolean; weekday?: number; makeManager?: boolean; rename?: string }[];
  const [users, profiles] = await Promise.all([listUsers(), managerProfiles(true)]);
  const managers = users.filter((u) => u.active && u.role === ROLES.MANAGER);
  const cityOf = (email: string) => {
    const key = Object.keys(profiles).find((k) => k.toLowerCase() === email.toLowerCase());
    return key ? regionStoreForCity(profiles[key].city) : "";
  };
  console.log(`Действующих менеджеров: ${managers.length} — ${managers.map((u) => `${u.name || "без имени"}${cityOf(u.email) ? ` (${regionStoreInfo(cityOf(u.email))?.label})` : ""}${u.phone ? "" : " [нет WhatsApp в карточке]"}`).join("; ")}`);

  const active = users.filter((u) => u.active);
  const labels = ROLE_LABELS as Record<string, string>;
  const plan: { store: StoreCode; email: string; name: string; female: boolean; weekday: number; role: string; newName: string; user: (typeof users)[number] }[] = [];
  for (const s of spec) {
    const store = normalizeStore(s.store) as StoreCode;
    const info = regionStoreInfo(store);
    if (!isRegionStore(store) || !info) throw new Error(`Город «${s.store}» не из списка регионов`);
    const want = norm(s.name);
    const found = active.filter((u) => norm(u.name).split(/\s+/).some((w) => w === want) || norm(u.name) === want);
    if (found.length !== 1) throw new Error(`«${s.name}»: ${found.length === 0 ? "такого действующего сотрудника нет" : `подходят несколько — ${found.map((u) => `${u.name} (${labels[u.role] ?? u.role})`).join(", ")}`}. Ничего не записано`);
    const user = found[0];
    if (user.role !== ROLES.MANAGER && !(s.makeManager === true && user.role === ROLES.RETAIL_REGIONS)) {
      throw new Error(`${user.name}: роль «${labels[user.role] ?? user.role}», а раздел города есть только у роли «Менеджер». Ничего не записано`);
    }
    const newName = (s.rename || "").trim();
    const now = cityOf(user.email);
    if (now && now !== store) throw new Error(`${user.name} уже посажен в ${regionStoreInfo(now)?.label} — сначала решите, снимать ли его оттуда. Ничего не записано`);
    const seat = regionSeat(profiles, store);
    const weekday = Number.isInteger(s.weekday) && s.weekday! >= 1 && s.weekday! <= 7 ? s.weekday! : seat.truckWeekday;
    const nameOf = (e: string) => users.find((u) => u.email.toLowerCase() === e.toLowerCase())?.name || "?";
    console.log(`\n${info.label}: сейчас главный — ${seat.directors.map(nameOf).join(", ") || "не назначен"}; ещё в городе — ${seat.managers.map(nameOf).join(", ") || "никого"}; фура — ${DAYS[seat.truckWeekday]}`);
    if (user.role !== ROLES.MANAGER) console.log(`  роль: «${labels[user.role] ?? user.role}» → «${labels[ROLES.MANAGER]}» (номер WhatsApp в карточке: ${user.phone ? "есть, остаётся" : "нет"})`);
    if (newName && newName !== user.name) console.log(`  имя: «${user.name}» → «${newName}»`);
    console.log(`  станет: главный — ${newName || user.name} (${s.female ? "женский" : "мужской"} род для ИИ), фура — ${DAYS[weekday]}${seat.directors.length && !seat.directors.some((e) => e.toLowerCase() === user.email.toLowerCase()) ? `; ${seat.directors.map(nameOf).join(", ")} с города снимается` : ""}`);
    plan.push({ store, email: user.email.toLowerCase(), name: newName || user.name, female: s.female === true, weekday, role: user.role, newName, user });
  }
  if (!yes) return console.log("\nТолько показ. Записать: --yes");
  // Сначала роль и имя (строка сотрудника пишется целиком — номер WhatsApp и производство переносим как есть), потом посадка.
  for (const p of plan) {
    if (p.role === ROLES.MANAGER && (!p.newName || p.newName === p.user.name)) continue;
    await saveUser({ email: p.user.email, name: p.name, role: ROLES.MANAGER, farm: "", active: p.user.active, phone: p.user.phone ?? "" });
    console.log(`${p.name}: роль и имя записаны`);
  }
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
  const usersAfter = await listUsers();
  for (const p of plan) {
    const seat = regionSeat(after, p.store);
    const u = usersAfter.find((x) => x.email.toLowerCase() === p.email);
    console.log(`${regionStoreInfo(p.store)?.label}: записано — главный ${seat.directors.some((e) => e.toLowerCase() === p.email) ? p.name : "НЕ ЗАПИСАЛСЯ"}, фура — ${DAYS[seat.truckWeekday]}; в сотрудниках: ${u?.name} · ${labels[u?.role ?? ""] ?? u?.role} · WhatsApp в карточке: ${u?.phone ? "есть" : "НЕТ"}`);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
