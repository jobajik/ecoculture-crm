import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Снять со склада заявки, которые уже уехали без полной оплаты (14.10.2026, владелец: «если клиенту всё равно
 * отгрузили — отними это»). То же, что на сайте «Отгрузили без полной оплаты» + «Отгрузить всю заявку»: раскладка
 * по партиям склада заявки от старых срезок к свежим (`planWholeOrderShipment`), запись одним запросом, строка в
 * журнале денег. Без кодов — список кандидатов: подтверждены, оплата не полная, доставка прошла.
 *
 *   npx tsx scripts/ship-unpaid.ts                       — кандидаты
 *   npx tsx scripts/ship-unpaid.ts CZUH6 1J61O           — раскладка, ничего не пишет
 *   npx tsx scripts/ship-unpaid.ts CZUH6 1J61O --yes     — копия таблицы и отгрузка
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";
import { createOrderShipments } from "../src/lib/repo/shipments";
import { logMoney } from "../src/lib/repo/moneyLog";
import { createBackup } from "../src/lib/backup";
import { canShipUnpaid, unpaidRest } from "../src/lib/orderReady";
import { planWholeOrderShipment } from "../src/lib/shipRules";
import { inStore, normalizeStore } from "../src/lib/officeStore";
import { orderCode } from "../src/lib/paymentStage";
import { localDayKey } from "../src/lib/timezone";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";
import { forgetReads } from "../src/lib/sheets";

const OWNER = "y.sadakbayev@gmail.com";
const n = (v: number) => Math.round(v).toLocaleString("ru-RU");

async function main() {
  const yes = process.argv.includes("--yes");
  const codes = process.argv.slice(2).filter((a) => /^[A-Z0-9]{4,}$/i.test(a)).map((c) => c.toUpperCase());
  const today = localDayKey();
  const orders = await listOrdersWithItems();

  if (codes.length === 0) {
    const list = orders
      .filter((o) => canShipUnpaid(o) && o.deliveryDate && o.deliveryDate < today)
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    console.log(`Подтверждены, оплата не полная, доставка прошла — ${list.length}:`);
    for (const o of list) {
      const items = o.items.map((i) => `${i.variety} ${i.grade} ${i.shippedQuantity}/${i.quantity}`).join(", ");
      console.log(`  ${orderCode(o.orderId)} · ${o.deliveryDate} · ${o.clientName} · ${n(o.totalAmount)} ₸, оплачено ${n(o.paidAmount)} · ${items}`);
    }
    return;
  }

  if (yes) {
    const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
    console.log(`Копия таблицы: ${backup.url}`);
  }
  for (const code of codes) {
    forgetReads();
    const order = (await listOrdersWithItems()).find((o) => orderCode(o.orderId) === code);
    if (!order) {
      console.log(`${code}: не найдена`);
      continue;
    }
    if (!canShipUnpaid(order)) {
      console.log(`${code}: не подходит (статус ${order.status}, подтверждена ${order.managerConfirmed}, оплачена ${order.paid})`);
      continue;
    }
    const plan = planWholeOrderShipment(order.items, inStore(await listBatches(), normalizeStore(order.store)));
    console.log(`${code} · ${order.clientName} · доставка ${order.deliveryDate} · долг ${n(unpaidRest(order))} ₸`);
    for (const l of plan.lines) {
      const item = order.items.find((i) => i.itemId === l.itemId)!;
      console.log(`  ${item.variety} ${item.grade}: ${l.parts.reduce((s, p) => s + p.quantity, 0)} шт. из ${l.parts.length} партий`);
    }
    for (const s of plan.shortages) {
      const item = order.items.find((i) => i.itemId === s.itemId)!;
      console.log(`  НЕ ХВАТАЕТ ${item.variety} ${item.grade}: ${s.missing} шт.`);
    }
    if (!yes || plan.total === 0) continue;
    await createOrderShipments({ orderId: order.orderId, warehouseEmail: OWNER, lines: plan.lines });
    await logMoney({
      actorEmail: OWNER,
      orderId: order.orderId,
      action: MONEY_LOG_ACTIONS.SHIPPED_UNPAID,
      details: `Отгрузили без полной оплаты (по факту, задним числом): ${order.clientName}, ${plan.total} шт.; долг ${n(unpaidRest(order))} ₸`,
      amountBefore: order.paidAmount,
      amountAfter: order.paidAmount,
    });
    console.log(`  → снято со склада ${plan.total} шт.`);
  }
  if (!yes) console.log("\nТолько показ. Отгрузить: --yes");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
