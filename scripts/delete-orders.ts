/*
 * Удаление названных заявок из боевой таблицы.
 *
 * Нужен для случая, который кнопкой не решается: владелец заносил остатки
 * склада и уже учёл в них несколько заявок, а сами заявки остались висеть у
 * зав. складом в списке «Можно отгружать». Удалять их по одной через сайт —
 * восемь заходов, и каждый раз надо вспоминать, какая следующая.
 *
 * Правила — ТЕ ЖЕ, что у кнопки на странице заявки (`src/lib/orderDelete.ts`).
 * Второй набор правил для того же действия разъехался бы с первым, и «через
 * сайт нельзя, а скриптом можно» стало бы дырой, про которую никто не помнит.
 *
 * ЧЕТЫРЕ ПРЕДОХРАНИТЕЛЯ, и все намеренные:
 *
 * 1. без ключа `--yes` скрипт ничего не трогает, а только показывает, что
 *    собирается сделать и что пропустит;
 * 2. перед первым удалением делается копия ВСЕЙ таблицы отдельным файлом, и
 *    без неё удаление не начинается: в Google-таблице нет корзины, и копия —
 *    единственный способ вернуть удалённое;
 * 3. заявка с отгрузкой или рекламацией не удаляется НИКОГДА, даже с `--force`:
 *    отгрузка уменьшила остаток партии, и без заявки эти стебли пропали бы со
 *    склада без объяснения;
 * 4. заявка, по которой пришли деньги, требует отдельного ключа `--paid`:
 *    сумма исчезнет из выручки, и это должно быть осознанным решением, а не
 *    побочным следствием общей команды.
 *
 * Каждое удаление пишется в журнал действий по деньгам — строкой, которую
 * можно прочитать без самой заявки: номер, клиент, менеджер, сумма, позиции.
 *
 * Запуск:
 *   npx tsx scripts/delete-orders.ts ORD-1 ORD-2          — показ, ничего не трогает
 *   npx tsx scripts/delete-orders.ts --yes ORD-1 ORD-2    — копия и удаление «чистых»
 *   npx tsx scripts/delete-orders.ts --yes --paid ORD-1   — плюс оплаченные
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

import { deleteOrder, listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listClaims } from "../src/lib/repo/claims";
import { logMoney } from "../src/lib/repo/moneyLog";
import { createBackup } from "../src/lib/backup";
import { deleteOrderRefusal, describeDeletedOrder } from "../src/lib/orderDelete";
import { MONEY_EPSILON, MONEY_LOG_ACTIONS, ORDER_STATUSES, ROLES } from "../src/lib/constants";

const LOG_PATH = "_temp/delete-orders.log";

function startLog() {
  try {
    mkdirSync("_temp", { recursive: true });
    writeFileSync(LOG_PATH, `Запуск ${new Date().toISOString()}\n`, "utf-8");
  } catch {
    // Не смогли завести файл — не повод не работать: экран остаётся.
  }
}

function log(line = "") {
  console.log(line);
  try {
    appendFileSync(LOG_PATH, `${line}\n`, "utf-8");
  } catch {
    // см. выше
  }
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

/** Кто записан автором удаления в журнале. Скрипт запускает владелец. */
const ACTOR = "y.sadakbayev@gmail.com";

async function main() {
  const argv = process.argv.slice(2);
  const confirmed = argv.includes("--yes");
  const withPaid = argv.includes("--paid");
  const ids = argv.filter((a) => !a.startsWith("--"));

  startLog();

  if (ids.length === 0) {
    log("Не названо ни одной заявки. Укажите номера через пробел.");
    log("Пример: npx tsx scripts/delete-orders.ts --yes ORD-260911-PYJK4");
    process.exitCode = 1;
    return;
  }

  log(`Названо заявок: ${ids.length}`);
  log("");

  const [orders, shipments, claims] = await Promise.all([
    listOrdersWithItems(),
    listShipments(),
    listClaims(),
  ]);
  const byId = new Map(orders.map((o) => [o.orderId, o]));

  type Plan = {
    id: string;
    reason: string;
    order: (typeof orders)[number] | null;
    shipments: number;
    claims: number;
  };

  /**
   * Номера переписывают с экрана, и «FI70G» от «F170G» глазом не отличить.
   * Поэтому ненайденному номеру ищем близнеца — отличающегося ровно одним
   * знаком. Ничего не удаляем по нему: только подсказываем, что имелось в виду.
   */
  function lookalike(id: string): string {
    const target = id.trim().toUpperCase();
    for (const o of orders) {
      const other = o.orderId.toUpperCase();
      if (other.length !== target.length) continue;
      let diff = 0;
      for (let i = 0; i < other.length; i++) if (other[i] !== target[i]) diff++;
      if (diff === 1) return o.orderId;
    }
    return "";
  }

  const plans: Plan[] = ids.map((id) => {
    const order = byId.get(id) ?? null;
    if (!order) {
      const near = lookalike(id);
      return {
        id,
        reason: near
          ? `заявки с таким номером нет; похоже на ${near}`
          : "заявки с таким номером в таблице нет",
        order,
        shipments: 0,
        claims: 0,
      };
    }
    const s = shipments.filter((x) => x.orderId === id).length;
    const c = claims.filter((x) => x.orderId === id).length;
    // Роль подставляем админскую: скрипт запускает владелец со своего
    // компьютера, а проверка роли нужна сайту, а не здесь.
    const refusal = deleteOrderRefusal({
      order,
      role: ROLES.ADMIN,
      shipments: s,
      claims: c,
      shippedStatus: ORDER_STATUSES.SHIPPED,
    });
    return { id, reason: refusal, order, shipments: s, claims: c };
  });

  // Разбираем на три кучки: удалим, удалим только с ключом --paid, не тронем.
  const clean = plans.filter((p) => p.order && !p.reason);
  const paidOnly = plans.filter(
    (p) =>
      p.order &&
      p.reason &&
      p.shipments === 0 &&
      p.claims === 0 &&
      p.order.items.every((i) => i.shippedQuantity === 0) &&
      p.order.status !== ORDER_STATUSES.SHIPPED &&
      p.order.paidAmount > MONEY_EPSILON
  );
  const blocked = plans.filter((p) => !clean.includes(p) && !paidOnly.includes(p));

  log("Что нашлось:");
  for (const p of plans) {
    if (!p.order) {
      log(`  ${p.id} — НЕТ В ТАБЛИЦЕ (${p.reason})`);
      continue;
    }
    const shipped = p.order.items.reduce((sum, i) => sum + i.shippedQuantity, 0);
    const stems = p.order.items.reduce((sum, i) => sum + i.quantity, 0);
    log(
      `  ${p.id} — ${p.order.clientName || "клиент не указан"} · ${money(p.order.totalAmount)} · ` +
        `${stems} шт. (отгружено ${shipped}) · получено ${money(p.order.paidAmount)} · ` +
        `рекламаций ${p.claims} · статус ${p.order.status}`
    );
    if (p.reason) log(`      мешает: ${p.reason}`);
  }

  const willDelete = [...clean, ...(withPaid ? paidOnly : [])];

  log("");
  log(`Удалю: ${willDelete.length}${willDelete.length ? ` — ${willDelete.map((p) => p.id).join(", ")}` : ""}`);
  if (!withPaid && paidOnly.length > 0) {
    log(
      `Пропущу как оплаченные: ${paidOnly.length} — ${paidOnly.map((p) => p.id).join(", ")}. ` +
        "Чтобы удалить и их, добавьте ключ --paid."
    );
    log(
      `  Из выручки при этом уйдёт ${money(
        paidOnly.reduce((sum, p) => sum + (p.order?.paidAmount ?? 0), 0)
      )}.`
    );
  }
  if (blocked.length > 0) {
    log(`Не трону: ${blocked.length} — ${blocked.map((p) => p.id).join(", ")}`);
    log("  Эти не удаляются ничем: по ним была отгрузка или есть рекламация.");
  }

  if (!confirmed) {
    log("");
    log("Ничего не тронуто: это показ. Для удаления запустите с ключом --yes.");
    return;
  }

  if (willDelete.length === 0) {
    log("");
    log("Удалять нечего.");
    return;
  }

  log("");
  log("Делаю резервную копию всей таблицы. Это самая долгая часть — до минуты.");
  log("НЕ ЗАКРЫВАЙТЕ окно: пока копии нет, удаление не начнётся.");
  log("");
  const backup = await createBackup(new Date(), log);
  log(`Копия готова: «${backup.title}» — ${backup.rows} строк, ${backup.tabs} вкладок`);
  log(backup.url);
  log("");

  for (const p of willDelete) {
    const order = p.order!;
    const details = describeDeletedOrder({
      orderId: order.orderId,
      clientName: order.clientName,
      managerEmail: order.managerEmail,
      totalAmount: order.totalAmount,
      items: order.items,
      reason: "учтено при занесении остатков склада",
    });

    const result = await deleteOrder(order.orderId);
    log(`  ${order.orderId} — удалена (строк заявки ${result.orders}, позиций ${result.items})`);

    // Журнал пишется ПОСЛЕ удаления и только дописывается: он и останется
    // единственным следом от заявки.
    await logMoney({
      actorEmail: ACTOR,
      orderId: order.orderId,
      action: MONEY_LOG_ACTIONS.ORDER_DELETED,
      details,
      amountBefore: order.totalAmount,
      amountAfter: 0,
    });
  }

  log("");
  log(`Готово. Удалено заявок: ${willDelete.length}.`);
  log("Если что-то удалили зря — всё лежит в копии по ссылке выше.");
}

main().catch((err) => {
  log(`ОШИБКА: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
