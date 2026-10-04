import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Найти позиции «клиент · день · сорт · градация» и собрать файл правки для
 * `scripts/edit-order-json.ts` (поменять градацию). Сам ничего не меняет.
 * Аргументы — JSON в UTF-8 (русские слова из .bat портятся):
 *   { "client": "Клименко", "day": "2026-09-29", "variety": "Avalanche", "fromGrade": "60",
 *     "toGrade": "60 (2 сорт)", "reason": "…", "out": "..\\_private\\edit-….json" }
 * День — оформления или доставки. Цена позиции не меняется.
 *
 *   npx tsx scripts/regrade-items.ts <json>
 *
 * 04.10.2026: склад Rose Farm (Разия) — у ИП Клименко от 29.09 Avalanche 60 см на самом деле второй сорт.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { listOrdersWithItems } from "../src/lib/repo/orders";

async function main() {
  const s = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^﻿/, "")) as {
    client: string; day: string; variety: string; fromGrade: string; toGrade: string; reason: string; out: string;
  };
  const day = (iso: string) => (iso || "").slice(0, 10);
  const orders = (await listOrdersWithItems()).filter(
    (o) => o.status !== "cancelled" && o.clientName.toLowerCase().includes(s.client.toLowerCase()) && (day(o.createdAt) === s.day || o.deliveryDate === s.day),
  );
  const spec = { reason: s.reason, orders: [] as { orderId: string; items: { itemId: string; grade: string }[] }[] };
  for (const o of orders) {
    console.log(`${o.orderId} · ${o.clientName} · оформлена ${day(o.createdAt)} · доставка ${o.deliveryDate || "—"} · ${o.status}`);
    for (const i of o.items) console.log(`  ${i.itemId} · ${i.variety} | ${i.grade} | ${i.quantity} × ${i.unitPrice} | отгр ${i.shippedQuantity}`);
    const hit = o.items.filter((i) => i.variety.toLowerCase().includes(s.variety.toLowerCase()) && i.grade === s.fromGrade);
    if (hit.length) spec.orders.push({ orderId: o.orderId, items: hit.map((i) => ({ itemId: i.itemId, grade: s.toGrade })) });
  }
  console.log(`\nЗаявок найдено: ${orders.length}, менять позиций: ${spec.orders.reduce((n, o) => n + o.items.length, 0)}`);
  writeFileSync(s.out, JSON.stringify(spec, null, 1), "utf8");
  console.log(`Файл правки: ${s.out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
