/*
 * Диагностика движения склада: приход, отгрузки, списания, выдачи — как они
 * лежат в живой базе и сходятся ли с остатками партий. НИЧЕГО НЕ МЕНЯЕТ.
 * Нужна, чтобы «Склад → Аналитика» строилась по настоящим данным.
 *
 * Запуск: npx tsx scripts/diag-stock-flow.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listBatches } from "../src/lib/repo/batches";
import { listShipments } from "../src/lib/repo/shipments";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listStaffTakeouts } from "../src/lib/repo/staffTakeouts";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { getFarmFor } from "../src/lib/constants";
import { isRetailOrder } from "../src/lib/retail";
import { isRegionOrder } from "../src/lib/orderKind";

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
const h = (t: string) => console.log(`\n===== ${t} =====`);
const day = (s: string) => (s || "").slice(0, 10);

function tally(xs: [string, number][]): string {
  const m = new Map<string, number>();
  for (const [k, v] of xs) m.set(k || "(пусто)", (m.get(k || "(пусто)") ?? 0) + v);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}: ${n(v)}`).join(" · ");
}

async function main() {
  const [batches, shipments, writeoffs, takeouts, orders] = await Promise.all([
    listBatches(),
    listShipments(),
    listWriteoffs(),
    listStaffTakeouts(),
    listOrdersWithItems(),
  ]);
  const batchById = new Map(batches.map((b) => [b.batchId, b]));
  const orderById = new Map(orders.map((o) => [o.orderId, o]));

  h("Партии (приход)");
  console.log(`партий ${batches.length}, принято ${n(batches.reduce((s, b) => s + b.quantityIn, 0))}, осталось ${n(batches.reduce((s, b) => s + b.quantityRemaining, 0))}`);
  console.log(`без даты приёмки: ${batches.filter((b) => !day(b.receivedAt)).length}, без даты срезки: ${batches.filter((b) => !day(b.harvestDate)).length}`);
  console.log(`приход по дням приёмки: ${tally(batches.map((b) => [day(b.receivedAt), b.quantityIn]))}`);
  console.log(`по производству: ${tally(batches.map((b) => [getFarmFor(b.flowerType) ?? "", b.quantityIn]))}`);
  console.log(`по цветку: ${tally(batches.map((b) => [b.flowerType, b.quantityIn]))}`);
  const lag = batches.filter((b) => day(b.receivedAt) && day(b.harvestDate)).map((b) => (new Date(day(b.receivedAt)).getTime() - new Date(day(b.harvestDate)).getTime()) / 86400000);
  lag.sort((a, b) => a - b);
  console.log(`приёмка позже срезки, дней: медиана ${lag[Math.floor(lag.length / 2)] ?? "—"}, макс ${lag[lag.length - 1] ?? "—"}, мин ${lag[0] ?? "—"}`);

  h("Отгрузки");
  const kindOf = (orderId: string) => {
    const o = orderById.get(orderId);
    if (!o) return "заявки нет";
    if (isRetailOrder(o)) return "наши магазины";
    if (isRegionOrder(o)) return "опт на город";
    return "клиентам";
  };
  console.log(`строк ${shipments.length}, из них с минусом (возврат) ${shipments.filter((s) => s.quantity < 0).length}`);
  console.log(`по видам: ${tally(shipments.map((s) => [kindOf(s.orderId), s.quantity]))}`);
  console.log(`по дням: ${tally(shipments.map((s) => [day(s.createdAt), s.quantity]))}`);
  console.log(`без партии: ${shipments.filter((s) => !batchById.has(s.batchId)).length}`);

  h("Списания");
  console.log(`строк ${writeoffs.length}, стеблей ${n(writeoffs.reduce((s, w) => s + w.quantity, 0))}`);
  console.log(`по причинам: ${tally(writeoffs.map((w) => [w.reason.split(/[.:(—]/)[0].trim().slice(0, 30), w.quantity]))}`);
  console.log(`по дням: ${tally(writeoffs.map((w) => [day(w.createdAt), w.quantity]))}`);

  h("Выдачи");
  console.log(`сотрудникам: ${n(takeouts.filter((t) => t.kind !== "company").reduce((s, t) => s + t.quantity, 0))}, на нужды: ${n(takeouts.filter((t) => t.kind === "company").reduce((s, t) => s + t.quantity, 0))}`);

  h("Сходится ли партия");
  const out = new Map<string, number>();
  const add = (id: string, q: number) => out.set(id, (out.get(id) ?? 0) + q);
  shipments.forEach((s) => add(s.batchId, s.quantity));
  writeoffs.forEach((w) => add(w.batchId, w.quantity));
  takeouts.forEach((t) => add(t.batchId, t.quantity));
  let bad = 0;
  let diff = 0;
  for (const b of batches) {
    const d = b.quantityIn - (out.get(b.batchId) ?? 0) - b.quantityRemaining;
    if (d !== 0) {
      bad++;
      diff += d;
    }
  }
  console.log(`партий, где «принято − ушло ≠ остаток»: ${bad} из ${batches.length}, разница всего ${n(diff)} (плюс — ушло без записи)`);
  const orphanOut = [...out.entries()].filter(([id]) => !batchById.has(id)).reduce((s, [, q]) => s + q, 0);
  console.log(`движения по несуществующим партиям: ${n(orphanOut)}`);

  h("Заказано vs отгружено");
  const live = orders.filter((o) => o.status !== "cancelled");
  const ordered = live.reduce((s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0), 0);
  const shipped = live.reduce((s, o) => s + o.items.reduce((a, i) => a + i.shippedQuantity, 0), 0);
  console.log(`заказано ${n(ordered)}, отгружено по позициям ${n(shipped)}, журнал отгрузок ${n(shipments.reduce((s, x) => s + x.quantity, 0))}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
