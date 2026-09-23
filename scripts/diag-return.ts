/*
 * Диагностика к просьбе «вернул хризантемы на теплицу / переместил розу на Спутник»
 * (заявка ORD-260917-3U4E9). НИЧЕГО НЕ МЕНЯЕТ: печатает заявку, её позиции и
 * отгрузки, кто такой Ильяс, какие есть карточки наших магазинов и партии нужных сортов.
 *
 * Запуск: npx tsx scripts/diag-return.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";
import { listUsers } from "../src/lib/repo/users";
import { listClients } from "../src/lib/repo/clients";
import { listShipments } from "../src/lib/repo/shipments";

const ORDER = process.argv[2] || "ORD-260917-3U4E9";

async function main() {
  const [orders, batches, users, clients] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    listUsers(),
    listClients(),
  ]);
  console.log("=== Сотрудники с именем Ильяс / Мешелов ===");
  for (const u of users) {
    if (/ильяс|мешел|ilyas|meshel/i.test(`${u.name} ${u.email}`))
      console.log(`${u.name} | ${u.email} | роль ${u.role} | ферма ${u.farm || "-"} | активен ${u.active}`);
  }
  console.log("\n=== Роли всех сотрудников (для понимания, кто что делает) ===");
  for (const u of users) console.log(`${u.role.padEnd(15)} ${u.farm || "-"} ${u.name || u.email}`);

  const o = orders.find((x) => x.orderId === ORDER);
  console.log(`\n=== Заявка ${ORDER} ===`);
  if (!o) console.log("не найдена");
  else {
    const { items, ...head } = o;
    console.log(JSON.stringify(head, null, 1));
    for (const i of items) console.log("позиция:", JSON.stringify(i));
    const ships = await listShipments();
    const own = ships.filter((r) => r.orderId === ORDER);
    console.log(`строк отгрузки: ${own.length}`);
    for (const r of own) console.log("отгрузка:", JSON.stringify(r));
    for (const i of items) {
      const bs = batches.filter((b) => b.variety === i.variety && b.grade === i.grade && b.quantityRemaining > 0);
      console.log(`партии ${i.variety} ${i.grade}: ${bs.map((b) => `${b.batchId} ${b.harvestDate} ост ${b.quantityRemaining}`).join("; ") || "нет"}`);
    }
  }

  console.log("\n=== Наши магазины (карточки с Retail) ===");
  for (const c of clients) if (c.retail) console.log(`${c.retail.padEnd(8)} ${c.clientId} ${c.name} | ${c.city} | активен ${c.active ?? "?"}`);
  const sp = clients.filter((c) => /спутник/i.test(c.name));
  console.log(`\nКарточки со словом «Спутник»: ${sp.map((c) => `${c.name} (retail=${c.retail || "пусто"})`).join("; ") || "нет"}`);

  const shopOrders = orders.filter((x) => x.retail).slice(-5);
  console.log("\n=== Последние заявки магазинам (как они выглядят) ===");
  for (const s of shopOrders) console.log(`${s.orderId} ${s.clientName} ${s.status} ${s.managerEmail} дост ${s.deliveryDate} поз ${s.items.length} подтв ${s.managerConfirmed}`);
}
main().catch((e) => { console.error("ОШИБКА:", e.message); process.exit(1); });
