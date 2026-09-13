/*
 * Диагностика: что за заявки лежат в базе за нужные дни.
 *
 * Скрипт НИЧЕГО НЕ МЕНЯЕТ. Он печатает заявки списком — номер целиком, клиент,
 * менеджер, суммы, отгрузка, статус, — чтобы номер можно было сверить со
 * снимком экрана, а не набирать на глаз.
 *
 * Зачем он появился. Владелец прислал снимок восьми заявок и попросил их
 * удалить. Номера я СПИСАЛ СО СНИМКА, и скрипт удаления ответил «заявки с таким
 * номером в таблице нет» по семи из восьми. Я поспешил решить, что заявки уже
 * кто-то убрал, — а владелец их по-прежнему видит. Куда правдоподобнее, что я
 * ошибся в номерах: в них перемешаны цифры и заглавные буквы (0 и O, 1 и I,
 * 5 и S), и на картинке они неотличимы. Номер, набранный с картинки, — это
 * догадка, а удаление догадками не делают.
 *
 * Запуск:
 *   npx tsx scripts/diag-orders.ts                 — последние 30 заявок
 *   npx tsx scripts/diag-orders.ts 2026-09-11      — только за этот день
 *   npx tsx scripts/diag-orders.ts --all           — все
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

async function main() {
  const arg = (process.argv[2] || "").trim();
  const all = await listOrdersWithItems();

  let rows = all;
  if (arg && arg !== "--all") {
    rows = all.filter(
      (o) => o.createdAt.slice(0, 10) === arg || o.deliveryDate.slice(0, 10) === arg
    );
    console.log(`Заявки, где ${arg} — день оформления или день доставки.`);
  } else if (!arg) {
    rows = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    console.log("Последние 30 заявок по дню оформления.");
  } else {
    console.log("Все заявки.");
  }

  console.log(`Найдено: ${rows.length} (всего в таблице ${all.length})`);
  console.log("");

  for (const o of [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const stems = o.items.reduce((s, i) => s + i.quantity, 0);
    const shipped = o.items.reduce((s, i) => s + i.shippedQuantity, 0);
    console.log(o.orderId);
    console.log(
      `    ${o.clientName || "(без клиента)"} · оформлена ${o.createdAt.slice(0, 10)} · доставка ${
        o.deliveryDate || "—"
      } · ${o.managerEmail}`
    );
    console.log(
      `    ${money(o.totalAmount)} · получено ${money(o.paidAmount)} · ${stems.toLocaleString(
        "ru-RU"
      )} шт. (отгружено ${shipped.toLocaleString("ru-RU")}) · статус ${o.status}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
