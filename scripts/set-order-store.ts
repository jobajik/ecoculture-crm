import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Поменять склад заявки (основной ⇄ офис) за владельца — по тем же правилам, что переключатель на
 * странице заявки (`storeChangeRefusal`, роль админа): пока по заявке ничего не отгружено. Показывает
 * позиции, отгрузки и остаток нужного склада по этим позициям. Без --yes — показ.
 *
 *   npx tsx scripts/set-order-store.ts <номер или короткий код> <office|main> [--yes]
 *
 * 08.10.2026: заказ бота №LWCXD ушёл из офиса, а в CRM стоял основной склад.
 */
import { getOrderById, listOrdersWithItems, setOrderStore } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";
import { listShipments } from "../src/lib/repo/shipments";
import { logMoney } from "../src/lib/repo/moneyLog";
import { normalizeStore, storeChangeRefusal, storeLabel } from "../src/lib/officeStore";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const norm = (s: string) => s.toUpperCase().replace(/I/g, "1").replace(/O/g, "0");

async function main() {
  const [code, toArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const apply = process.argv.includes("--yes");
  if (!code || !toArg) throw new Error("Укажите заявку и склад: office или main");
  const to = toArg === "office" ? "office" : "";
  let order = await getOrderById(code);
  if (!order) {
    const hits = (await listOrdersWithItems()).filter((o) => norm(o.orderId).endsWith(norm(code)));
    if (hits.length !== 1) throw new Error(`Заявка «${code}» найдена ${hits.length} раз`);
    order = hits[0];
  }
  console.log(`${order.orderId} · ${order.clientName} · доставка ${order.deliveryDate} · ${order.status} · склад: ${storeLabel(order.store)}`);
  console.log(`  получено ${order.paidAmount} из ${order.totalAmount} · подтв=${order.managerConfirmed}`);
  const ships = await listShipments();
  for (const i of order.items) {
    console.log(`  ${i.itemId} · ${i.flowerType} | ${i.variety} | ${i.grade} | ${i.quantity} × ${i.unitPrice} | отгр ${i.shippedQuantity}`);
    for (const s of ships.filter((s) => s.itemId === i.itemId)) console.log(`      отгрузка ${s.shipmentId}: ${s.quantity} из ${s.batchId} · ${s.createdAt.slice(0, 16)}`);
  }
  const batches = await listBatches();
  console.log(`Остаток склада «${storeLabel(to)}» по этим позициям:`);
  for (const i of order.items) {
    const left = batches
      .filter((b) => normalizeStore(b.store) === to && b.flowerType === i.flowerType && b.variety === i.variety && b.grade === i.grade)
      .reduce((s, b) => s + b.quantityRemaining, 0);
    console.log(`  ${i.variety} ${i.grade}: ${left} шт.`);
  }
  const refusal = storeChangeRefusal({ role: "admin", isOwner: false, order, to });
  if (refusal) return console.log(`\nНельзя: ${refusal}`);
  console.log(`\nСклад: ${storeLabel(order.store)} → ${storeLabel(to)}`);
  if (!apply) return console.log("Только показ. Записать: --yes");
  await setOrderStore(order.orderId, to);
  await logMoney({
    actorEmail: OWNER,
    orderId: order.orderId,
    action: MONEY_LOG_ACTIONS.ORDER_EDITED,
    details: `склад заявки: ${storeLabel(order.store)} → ${storeLabel(to)} · отгрузка была из офиса (владелец, 08.10.2026)`,
    amountBefore: order.totalAmount,
    amountAfter: order.totalAmount,
  });
  console.log("Записано.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
