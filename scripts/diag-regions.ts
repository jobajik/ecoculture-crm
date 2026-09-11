/*
 * Диагностика: почему не видно «Розницу — регионы».
 *
 * Скрипт ничего не меняет. Он читает боевую таблицу и отвечает на три вопроса:
 *
 * 1. Есть ли карточки городов (Астана, Семей, Усть-Каменогорск) и активны ли они;
 * 2. Кто заведён зав. складом — с какой ролью, каким производством и активен ли;
 * 3. Что КАЖДЫЙ сотрудник увидит в разделе «Розница» (список вкладок считается
 *    той же функцией, что и на сайте, — не «на глаз»).
 *
 * Запуск: npx tsx scripts/diag-regions.ts
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { RETAIL_REGION_CITIES, ROLE_LABELS } from "../src/lib/constants";
import { canFillRegions, canSeeRegions, cleanRegionCity, isRegionShop } from "../src/lib/retail";
import { retailTabsFor } from "../src/app/retail/tabs";

async function main() {
  const [clients, users] = await Promise.all([listClients(), listUsers()]);

  console.log("=== 1. Карточки городов ===");
  const regionCards = clients.filter((c) => isRegionShop(c));
  if (regionCards.length === 0) {
    console.log("НЕТ НИ ОДНОЙ карточки с направлением «regions».");
    console.log("Лечение: npx tsx scripts/add-shops.ts");
  }
  for (const city of RETAIL_REGION_CITIES) {
    const card = regionCards.find((c) => c.city === city);
    if (!card) {
      console.log(`НЕТ  ${city}: карточки с таким городом нет`);
      continue;
    }
    console.log(
      `${card.active ? "OK  " : "СКРЫТА"} ${city}: «${card.name}», ` +
        `город в карточке «${card.city}», активна: ${card.active}, ` +
        `город распознан как: «${cleanRegionCity(card.city) || "НЕ РАСПОЗНАН"}»`
    );
  }
  // Карточки «regions» с городом не из списка: заявку по ним оформить нельзя,
  // а в базе они висят и путают.
  for (const card of regionCards) {
    if (!cleanRegionCity(card.city)) {
      console.log(
        `ВНИМАНИЕ  «${card.name}»: направление regions, но город «${card.city}» не из списка`
      );
    }
  }

  console.log("\n=== 2. Кто заведён зав. складом ===");
  const warehouse = users.filter((u) => u.role === "warehouse");
  if (warehouse.length === 0) {
    console.log("НЕТ НИ ОДНОГО пользователя с ролью warehouse.");
    console.log("Лечение: добавить строку во вкладку Users (Role=warehouse, Farm обязательна).");
  }
  for (const u of warehouse) {
    console.log(
      `${u.active ? "OK  " : "ОТКЛЮЧЁН"} ${u.email} — ${u.name || "без имени"}, ` +
        `производство: ${u.farm || "НЕ УКАЗАНО (склад работать не будет)"}`
    );
  }

  console.log("\n=== 3. Что каждый увидит в разделе «Розница» ===");
  for (const u of users) {
    if (!u.active) continue;
    const tabs = retailTabsFor(u.role);
    const labels = tabs.map((t) => t.label).join(" | ") || "раздел не показывается";
    console.log(
      `${u.email} (${ROLE_LABELS[u.role] ?? (u.role || "РОЛЬ ПУСТАЯ")}): ${labels}` +
        (canFillRegions(u.role) ? "   [может заводить заявки по регионам]" : "") +
        (!canFillRegions(u.role) && canSeeRegions(u.role) ? "   [видит регионы, но только смотрит]" : "")
    );
  }

  console.log("\nГотово. Ничего не изменено.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
