/*
 * Пересчёт статуса названных заявок по тому, что реально отгружено.
 *
 * Понадобился вот зачем. Заявка ORD-260911-10WL5 отгружена целиком — 105 из
 * 105 стеблей уехали, — но статус у неё так и остался «в работе». Из-за этого
 * она висела у зав. складом в списке «Можно отгружать», хотя отгружать по ней
 * уже нечего. Удалить её нельзя (цветок уехал, и без заявки эти стебли пропали
 * бы со склада без следа), а держать в списке — значит каждый день спотыкаться
 * о строку, с которой ничего нельзя сделать.
 *
 * Правильный ответ — не удалять, а поставить честный статус: заявка отгружена,
 * и из списка склада она уйдёт сама.
 *
 * Считает статус ТА ЖЕ функция, что и после каждой отгрузки
 * (`recomputeOrderStatusFromItems`): второй способ вычислять статус разъехался
 * бы с первым, и «на сайте одно, скриптом другое» стало бы новой загадкой.
 * Поэтому скрипт ничего не выбирает сам — он лишь просит пересчитать.
 *
 * Отменённые заявки функция не трогает намеренно: отмена — решение человека, а
 * не следствие отгрузок.
 *
 * Запуск:
 *   npx tsx scripts/fix-order-status.ts ORD-1 ORD-2        — показ
 *   npx tsx scripts/fix-order-status.ts --yes ORD-1        — пересчёт
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getOrderById, recomputeOrderStatusFromItems } from "../src/lib/repo/orders";
import { ORDER_STATUSES } from "../src/lib/constants";

async function main() {
  const argv = process.argv.slice(2);
  const confirmed = argv.includes("--yes");
  const ids = argv.filter((a) => !a.startsWith("--"));

  if (ids.length === 0) {
    console.log("Не названо ни одной заявки. Укажите номера через пробел.");
    process.exitCode = 1;
    return;
  }

  for (const id of ids) {
    const order = await getOrderById(id);
    if (!order) {
      console.log(`${id} — НЕТ В ТАБЛИЦЕ`);
      continue;
    }

    const ordered = order.items.reduce((sum, i) => sum + i.quantity, 0);
    const shipped = order.items.reduce((sum, i) => sum + i.shippedQuantity, 0);
    const allShipped =
      order.items.length > 0 && order.items.every((i) => i.shippedQuantity >= i.quantity);
    const should =
      order.status === ORDER_STATUSES.CANCELLED
        ? order.status
        : allShipped
          ? ORDER_STATUSES.SHIPPED
          : shipped > 0
            ? ORDER_STATUSES.IN_PROGRESS
            : order.status;

    console.log(
      `${id} — ${order.clientName || "клиент не указан"} · отгружено ${shipped} из ${ordered} · ` +
        `статус сейчас «${order.status}»${should === order.status ? " — верный" : ` → станет «${should}»`}`
    );

    if (!confirmed || should === order.status) continue;
    await recomputeOrderStatusFromItems(id);
    const after = await getOrderById(id);
    console.log(`    записано: «${after?.status ?? "?"}»`);
  }

  if (!confirmed) {
    console.log("\nНичего не тронуто: это показ. Для записи запустите с ключом --yes.");
  }
}

main().catch((err) => {
  console.error(`ОШИБКА: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
