/*
 * Диагностика к трём просьбам зав. склада Rose Farm (снимки 26.09). НИЧЕГО НЕ МЕНЯЕТ.
 *   1) заявка «Цветочник, Мамыр-1, 8 киоск», доставка 12.09: Jumilia 50 → 60 шт,
 *      70 → 45 шт, Jumilia 40 убрать;
 *   2) партия BATCH-260910-QLAI8 «Peach Avalanche 40» — на самом деле Avalanche;
 *   3) расход «Офис(Данияр)» 26.09 — цена стебля 120, а не как вписали.
 *
 * Запуск: npx tsx scripts/diag-razia.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";
import { listShipments } from "../src/lib/repo/shipments";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listStaffTakeouts } from "../src/lib/repo/staffTakeouts";
import { listPrices } from "../src/lib/repo/prices";
import { PRICE_KINDS } from "../src/lib/priceList";
import { listVarietiesByType } from "../src/lib/repo/varieties";

const BATCH = "BATCH-260910-QLAI8";

async function main() {
  const [orders, batches, ships, writeoffs, takeouts] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    listShipments(),
    listWriteoffs(),
    listStaffTakeouts(),
  ]);

  console.log("=== 1. Заявки клиента «Мамыр-1, 8 киоск» ===");
  const own = orders.filter((o) => /мамыр/i.test(o.clientName) && /8/.test(o.clientName));
  for (const o of own) {
    console.log(`\n${o.orderId} · ${o.clientName} · ${o.clientId} · доставка ${o.deliveryDate} · статус ${o.status} · retail=${o.retail || "-"} · kind=${o.kind || "-"} · сумма ${o.totalAmount} · менеджер ${o.managerEmail} · подтв ${o.managerConfirmed}`);
    for (const i of o.items)
      console.log(`  ${i.itemId} · ${i.variety} ${i.grade} · заказ ${i.quantity} · отгр ${i.shippedQuantity} · цена ${i.unitPrice}`);
    for (const s of ships.filter((x) => x.orderId === o.orderId))
      console.log(`  отгрузка ${s.shipmentId} · ${s.createdAt} · поз ${s.itemId} · партия ${s.batchId} · ${s.quantity} · ${s.warehouseEmail} · ${s.notes}`);
  }
  const jum = batches.filter((b) => b.variety === "Jumilia" && ["40", "50", "70"].includes(b.grade));
  console.log("\nПартии Jumilia 40/50/70:");
  for (const b of jum) console.log(`  ${b.batchId} · ${b.grade} · срезка ${b.harvestDate} · ${b.quantityRemaining}/${b.quantityIn} · ${b.location}`);

  console.log(`\n=== 2. Партия ${BATCH} ===`);
  const b = batches.find((x) => x.batchId === BATCH);
  console.log(JSON.stringify(b));
  for (const s of ships.filter((x) => x.batchId === BATCH)) console.log(`  отгрузка ${JSON.stringify(s)}`);
  for (const w of writeoffs.filter((x) => x.batchId === BATCH)) console.log(`  списание ${JSON.stringify(w)}`);
  for (const t of takeouts.filter((x) => x.batchId === BATCH)) console.log(`  выдача ${JSON.stringify(t)}`);
  const same = batches.filter((x) => x.harvestDate === b?.harvestDate && x.flowerType === "rose" && /avalanche/i.test(x.variety));
  console.log("Партии *Avalanche* с той же срезкой:");
  for (const x of same) console.log(`  ${x.batchId} · ${x.variety} ${x.grade} · ${x.quantityRemaining}/${x.quantityIn} · принята ${x.receivedAt} · ${x.receivedByEmail}`);
  const vars = await listVarietiesByType();
  console.log("Сорта *Avalanche* в справочнике:", (vars.rose ?? []).filter((v) => /avalanche/i.test(v)).join(", "));

  console.log("\n=== 3. Расход на нужды компании за сентябрь (роза, эустома) ===");
  for (const t of takeouts.filter((x) => x.kind === "company" && x.date >= "2026-09-01"))
    console.log(`  ${t.takeoutId} · ${t.date} · ${t.staffName} · ${t.variety} ${t.grade} · ${t.quantity} × ${t.unitPrice} = ${t.quantity * t.unitPrice} · партия ${t.batchId} · ${t.warehouseEmail} · ${t.note} · создан ${t.createdAt}`);
  const retail = await listPrices(PRICE_KINDS.RETAIL);
  console.log("Внутренний прайс на мини-микс розы (вся история):");
  for (const p of retail.filter((x) => x.flowerType === "rose" && /мини/i.test(`${x.variety} ${x.grade}`)))
    console.log(`  ${JSON.stringify(p)}`);
}
main().catch((e) => { console.error("ОШИБКА:", e.message); process.exit(1); });
