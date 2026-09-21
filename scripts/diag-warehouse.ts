/*
 * Диагностика склада: что видит зав. складом и почему.
 *
 * Скрипт НИЧЕГО НЕ МЕНЯЕТ. Появился после сообщения зав. складом Rose Farm:
 * «пока „отгрузить“ не нажимаешь, со склада не отнимается», «ждёт подтверждения
 * тоже висит», «регионы пока никто не занёс». Прежде чем что-то менять, надо
 * увидеть живые цифры: сколько заявок ждёт и кого, какие из них уже в прошлом,
 * сколько стеблей «висит» в неотгруженных заявках против остатка склада.
 *
 * Запуск: npx tsx scripts/diag-warehouse.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";
import { listUsers } from "../src/lib/repo/users";
import { getFarmFor, FARMS } from "../src/lib/constants";
import { isReadyToShip, notReadyReason } from "../src/lib/orderReady";
import { isRegionOrder } from "../src/lib/orderKind";
import { isRetailOrder } from "../src/lib/retail";

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10); // Алматы

async function main() {
  const [orders, batches, users] = await Promise.all([listOrdersWithItems(), listBatches(), listUsers()]);
  const nameOf = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const who = (email: string) => nameOf.get(email.toLowerCase()) || email;
  console.log(`Сегодня (Алматы): ${today}. Заявок в базе: ${orders.length}.`);

  for (const farm of Object.values(FARMS) as string[]) {
    console.log(`\n================ ${farm} ================`);
    const scoped = orders
      .map((o) => ({ ...o, items: o.items.filter((i) => getFarmFor(i.flowerType) === farm) }))
      .filter((o) => o.items.length > 0);
    const pending = scoped.filter((o) => ["new", "in_progress", "ready"].includes(o.status));
    const ready = pending.filter((o) => isReadyToShip(o));
    const waiting = pending.filter((o) => !isReadyToShip(o));
    const left = (o: (typeof scoped)[number]) =>
      o.items.reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0);

    const stock = batches
      .filter((b) => getFarmFor(b.flowerType) === farm)
      .reduce((s, b) => s + Math.max(0, b.quantityRemaining), 0);
    const readyStems = ready.reduce((s, o) => s + left(o), 0);
    const waitStems = waiting.reduce((s, o) => s + left(o), 0);
    console.log(`Остаток склада: ${n(stock)} шт.`);
    console.log(`Можно отгружать: ${ready.length} заявок, не отгружено ${n(readyStems)} шт.`);
    console.log(`Ждут: ${waiting.length} заявок, ${n(waitStems)} шт.`);

    const past = (o: { deliveryDate: string }) => !!o.deliveryDate && o.deliveryDate.slice(0, 10) < today;
    const readyPast = ready.filter(past);
    console.log(
      `  из «можно отгружать» доставка УЖЕ ПРОШЛА: ${readyPast.length} заявок, ${n(
        readyPast.reduce((s, o) => s + left(o), 0)
      )} шт. (цветок, скорее всего, уехал, а «Отгрузить» не нажали)`
    );
    for (const o of readyPast.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)))
      console.log(`    ${o.orderId} · ${o.clientName} · доставка ${o.deliveryDate} · осталось ${n(left(o))} шт.`);

    // Ждущие — по причине и менеджеру.
    const byReason = new Map<string, { count: number; stems: number; past: number }>();
    for (const o of waiting) {
      const key = `${notReadyReason(o)} — ${who(o.managerEmail)}`;
      const r = byReason.get(key) ?? { count: 0, stems: 0, past: 0 };
      r.count++;
      r.stems += left(o);
      if (past(o)) r.past++;
      byReason.set(key, r);
    }
    console.log(`  Ждущие по причине и менеджеру:`);
    for (const [k, r] of Array.from(byReason.entries()).sort((a, b) => b[1].count - a[1].count))
      console.log(`    ${r.count} заявок (${n(r.stems)} шт., доставка прошла у ${r.past}) · ${k}`);
    const waitPast = waiting.filter(past).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    console.log(`  Ждущие с прошедшей доставкой: ${waitPast.length}`);
    for (const o of waitPast)
      console.log(
        `    ${o.orderId} · ${o.clientName} · доставка ${o.deliveryDate} · ${who(o.managerEmail)} · ${notReadyReason(o)} · ${n(left(o))} шт.`
      );
    const noDate = waiting.filter((o) => !o.deliveryDate).length;
    console.log(`  Ждущие без даты доставки: ${noDate}`);
  }

  // Регионы: объём на город и заявки в наши магазины регионов.
  console.log(`\n================ Регионы ================`);
  const recent = (o: { deliveryDate: string; createdAt: string }) =>
    (o.deliveryDate || o.createdAt).slice(0, 10) >= new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const city = orders.filter((o) => isRegionOrder(o) && o.status !== "cancelled");
  const shops = orders.filter((o) => isRetailOrder(o) && o.retail === "regions" && o.status !== "cancelled");
  console.log(`Объём на город (РОП): всего ${city.length}, за 14 дней и вперёд ${city.filter(recent).length}`);
  for (const o of city.filter(recent)) console.log(`    ${o.orderId} · ${o.clientName || o.direction} · доставка ${o.deliveryDate} · ${o.status}`);
  console.log(`Наши магазины в регионах (зав. складом): всего ${shops.length}, за 14 дней и вперёд ${shops.filter(recent).length}`);
  for (const o of shops.filter(recent)) console.log(`    ${o.orderId} · ${o.clientName} · доставка ${o.deliveryDate} · ${o.status}`);
  const regionClients = orders.filter((o) => !isRegionOrder(o) && !isRetailOrder(o) && o.direction && o.status !== "cancelled");
  console.log(`Клиентские заявки с направлением (менеджеры): ${regionClients.length}, за 14 дней ${regionClients.filter(recent).length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
