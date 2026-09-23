/*
 * Где «отгружено» в позиции не сходится с журналом отгрузок — и почему.
 *
 * Ничего не меняет. Аудит нашёл 18 позиций, у которых счётчик ShippedQuantity
 * не равен сумме строк во вкладке Shipments. Счётчик и журнал пишутся разными
 * запросами, поэтому расхождение — признак потерянной записи. Скрипт печатает
 * каждую такую позицию рядом с историей правок заявки из журнала денег, чтобы
 * было видно, какое действие её испортило.
 *
 * Запуск: npx tsx scripts/diag-shipped.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listMoneyLog } from "../src/lib/repo/moneyLog";
import { listBatches } from "../src/lib/repo/batches";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listStaffTakeouts } from "../src/lib/repo/staffTakeouts";

async function main() {
  const [orders, shipments, log] = await Promise.all([listOrdersWithItems(), listShipments(), listMoneyLog()]);
  const byItem = new Map<string, typeof shipments>();
  for (const s of shipments) byItem.set(s.itemId, [...(byItem.get(s.itemId) ?? []), s]);
  const itemIds = new Set(orders.flatMap((o) => o.items.map((i) => i.itemId)));
  let n = 0;
  for (const o of orders) {
    for (const i of o.items) {
      const rows = byItem.get(i.itemId) ?? [];
      const sum = rows.reduce((s, r) => s + r.quantity, 0);
      if (sum === i.shippedQuantity) continue;
      n++;
      console.log(`\n${o.orderId} [${o.status}] ${i.variety} ${i.grade}: заказано ${i.quantity}, счётчик ${i.shippedQuantity}, по журналу ${sum} (${rows.length} строк)`);
      for (const r of rows) console.log(`   отгрузка ${r.createdAt} ${r.quantity} шт.`);
      for (const l of log.filter((l) => l.orderId === o.orderId && l.action !== "payment" && l.action !== "invoice_sent"))
        console.log(`   журнал ${l.createdAt} ${l.action}: ${l.details.slice(0, 120)}`);
    }
  }
  const orphan = shipments.filter((s) => !itemIds.has(s.itemId));
  console.log(`\nВсего расхождений: ${n}. Строк отгрузки на несуществующие позиции: ${orphan.length} (${orphan.reduce((s, r) => s + r.quantity, 0)} шт.)`);
  for (const s of orphan.slice(0, 15)) console.log(`   ${s.orderId} ${s.itemId} ${s.createdAt} ${s.quantity}`);

  // Счётчик партии против журналов: принято − отгружено − списано − выдано.
  const [batches, writeoffs, takeouts] = await Promise.all([listBatches(), listWriteoffs(), listStaffTakeouts()]);
  const out = new Map<string, number>();
  const add = (id: string, q: number) => out.set(id, (out.get(id) ?? 0) + q);
  shipments.forEach((s) => add(s.batchId, s.quantity));
  writeoffs.forEach((w) => add(w.batchId, w.quantity));
  takeouts.forEach((t) => add(t.batchId, t.quantity));
  let bad = 0, diff = 0;
  for (const b of batches) {
    const expect = b.quantityIn - (out.get(b.batchId) ?? 0);
    if (expect !== b.quantityRemaining) { bad++; diff += b.quantityRemaining - expect; if (bad <= 10) console.log(`   партия ${b.batchId} ${b.variety} ${b.grade}: остаток ${b.quantityRemaining}, по журналам ${expect}`); }
  }
  console.log(`Партий, где остаток не сходится с журналами: ${bad}, суммарно лишних на складе ${diff} шт.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
