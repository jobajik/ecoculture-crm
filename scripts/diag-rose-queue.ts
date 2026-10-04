import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/** Очередь склада Rose Farm: открытые заявки с розой/эустомой, позиции, деньги; склад эустомы и мини-микса. Ничего не меняет. */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";

async function main() {
  const orders = await listOrdersWithItems();
  const open = orders.filter(
    (o) => o.status !== "cancelled" && o.status !== "shipped" && !o.store && o.items.some((i) => i.flowerType === "rose" || i.flowerType === "eustoma")
  );
  for (const o of open.filter((o) => /ORD-2609(2|3)|ORD-2610/.test(o.orderId))) {
    console.log(`\n${o.orderId} · ${o.clientName} · ${o.deliveryDate} · ${o.managerEmail} · retail=${o.retail || "-"} · подтв=${o.managerConfirmed} · получено ${o.paidAmount}/${o.totalAmount} · ${o.status}`);
    for (const i of o.items) console.log(`  ${i.itemId} · ${i.flowerType} | ${i.variety} | ${i.grade} | ${i.quantity} × ${i.unitPrice} | отгр ${i.shippedQuantity}`);
  }
  const b = (await listBatches()).filter((x) => !x.store && x.quantityRemaining > 0 && (x.flowerType === "eustoma" || /мини|mini/i.test(x.variety + x.grade)));
  const sum = new Map<string, number>();
  for (const x of b) sum.set(`${x.flowerType} | ${x.variety} | ${x.grade}`, (sum.get(`${x.flowerType} | ${x.variety} | ${x.grade}`) ?? 0) + x.quantityRemaining);
  console.log("\nСклад (эустома и мини-микс):");
  for (const [k, v] of [...sum.entries()].sort()) console.log(`  ${k} — ${v}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
