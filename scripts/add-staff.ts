/*
 * Заводит сотрудников на вкладке Users.
 *
 * Обычно строку добавляют руками прямо в таблице, но три роли сразу — это три
 * шанса опечататься в коде роли или забыть производство у агронома, а такая
 * опечатка не падает: человек просто заходит и видит пустой экран.
 *
 * Скрипт идемпотентный: если почта уже есть, строка ОБНОВЛЯЕТСЯ, новая не
 * добавляется. Значит его можно запустить дважды и ничего не сломать.
 *
 * Роль и производство проверяются по константам проекта до записи — неизвестный
 * код роли или производство у роли, которой оно не положено, останавливают
 * скрипт целиком, а не пишут половину.
 *
 * Запуск: npx tsx scripts/add-staff.ts
 */
import * as dotenv from "dotenv";
import { readTable, appendRows, rowToRecord, updateWhere, SHEET_TABS } from "../src/lib/sheets";
import { ROLES, FARMS, isFarmBoundRole } from "../src/lib/constants";

dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Кого заводим. Имена — рабочие подписи, они видны в рейтинге и отчётах;
 * поменять их можно прямо в таблице, на вход в систему они не влияют.
 */
const STAFF: { email: string; name: string; role: string; farm: string }[] = [
  {
    email: "Latypovdenis503@gmail.com",
    name: "Агроном (розы)",
    role: ROLES.AGRONOMIST,
    farm: FARMS.ROSE_FARM,
  },
  {
    email: "denisdenisko73@gmail.com",
    name: "Агроном (хризантема)",
    role: ROLES.AGRONOMIST,
    farm: FARMS.ESENTAI,
  },
  {
    email: "Dzyudik52@gmail.com",
    name: "РОП",
    role: ROLES.SALES_HEAD,
    farm: "",
  },
];

async function main() {
  const known = Object.values(ROLES) as string[];
  const farms = Object.values(FARMS) as string[];

  // Сначала проверяем всё, потом пишем: половина записанных строк хуже, чем ни одной.
  for (const person of STAFF) {
    if (!person.email.includes("@")) throw new Error(`Не похоже на почту: ${person.email}`);
    if (!known.includes(person.role)) {
      throw new Error(`Неизвестная роль «${person.role}» у ${person.email}`);
    }
    if (isFarmBoundRole(person.role)) {
      if (!farms.includes(person.farm)) {
        throw new Error(
          `Роль «${person.role}» требует производство, а у ${person.email} стоит «${person.farm}»`
        );
      }
    } else if (person.farm) {
      throw new Error(`Роли «${person.role}» производство не нужно, уберите его у ${person.email}`);
    }
  }

  const table = await readTable(SHEET_TABS.USERS);
  const existing = new Set(
    table.rows
      .map((row) => rowToRecord(SHEET_TABS.USERS, row).Email || "")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );

  const toAdd = STAFF.filter((p) => !existing.has(p.email.trim().toLowerCase()));
  const toUpdate = STAFF.filter((p) => existing.has(p.email.trim().toLowerCase()));

  for (const person of toUpdate) {
    await updateWhere(
      SHEET_TABS.USERS,
      (record) => (record.Email || "").trim().toLowerCase() === person.email.trim().toLowerCase(),
      () => ({ Name: person.name, Role: person.role, Active: "TRUE", Farm: person.farm })
    );
    console.log(`обновлён: ${person.email} — ${person.role}${person.farm ? ` (${person.farm})` : ""}`);
  }

  if (toAdd.length > 0) {
    await appendRows(
      SHEET_TABS.USERS,
      toAdd.map((person) => ({
        Email: person.email,
        Name: person.name,
        Role: person.role,
        Active: "TRUE",
        Farm: person.farm,
      }))
    );
    for (const person of toAdd) {
      console.log(`добавлен: ${person.email} — ${person.role}${person.farm ? ` (${person.farm})` : ""}`);
    }
  }

  console.log(`\nГотово. Добавлено: ${toAdd.length}, обновлено: ${toUpdate.length}.`);
  console.log("Люди могут заходить сразу — приложение Google опубликовано, список");
  console.log("тестовых пользователей больше не нужен (см. CLAUDE.md, грабли 1.3).");
}

main().catch((error) => {
  console.error("Не получилось:", error instanceof Error ? error.message : error);
  process.exit(1);
});
