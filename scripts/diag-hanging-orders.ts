import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Заявки, которые «висят на складе» (09.11.2026, владелец: «если клиент не закрыл долг, ты учитываешь остатки как не
 * отнятые со стоков — это некорректно, если теплица отгрузила»). Со склада стебли снимает ТОЛЬКО отгрузка в CRM
 * (`createOrderShipments`), оплата на сток не влияет; с 14.10 склад может отгрузить и без полной оплаты («Отгрузили без
 * полной оплаты»). Значит, завышен сток ровно на те заявки, где день доставки прошёл, а «Отгрузить» не нажали — их и
 * печатаем: по компаниям, сколько стеблей, оплачено ли, кто менеджер. Ничего не меняет.
 *
 *   npx tsx scripts/diag-hanging-orders.ts [дней давности доставки, 1]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { ORDER_STATUSES, FARM_LABELS, FLOWER_TYPE_LABELS, getFarmFor } from "../src/lib/constants";
import { isNotASale } from "../src/lib/orderKind";
import { localDayKey } from "../src/lib/timezone";
import { orderCode } from "../src/lib/paymentStage";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

async function main() {
  const minDays = Number(process.argv[2]) || 1;
  const today = localDayKey();
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - minDays * 86400000).toISOString().slice(0, 10);
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS]);
  const [orders, users] = await Promise.all([listOrdersWithItems(), listUsers()]);
  const nameOf = (e: string) => (users.find((u) => u.email === e)?.name || e).split(/\s+/)[0];
  const hanging = orders
    .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o))
    .map((o) => ({ o, left: o.items.reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0) }))
    .filter(({ o, left }) => left > 0 && (o.deliveryDate || o.createdAt).slice(0, 10) <= cutoff)
    .sort((a, b) => ((a.o.deliveryDate || a.o.createdAt) < (b.o.deliveryDate || b.o.createdAt) ? -1 : 1));
  const byFarm = new Map<string, { orders: number; stems: number; paidStems: number }>();
  for (const { o } of hanging) {
    for (const i of o.items) {
      const left = Math.max(0, i.quantity - i.shippedQuantity);
      if (!left) continue;
      const farm = getFarmFor(i.flowerType) || "?";
      const e = byFarm.get(farm) ?? { orders: 0, stems: 0, paidStems: 0 };
      e.stems += left;
      if (o.paid) e.paidStems += left;
      byFarm.set(farm, e);
    }
    for (const farm of new Set(o.items.map((i) => getFarmFor(i.flowerType) || "?"))) byFarm.get(farm)!.orders += 1;
  }
  console.log(`На ${today}: заявок с прошедшей доставкой (до ${cutoff}) и неотгруженным остатком — ${hanging.length}`);
  for (const [farm, e] of byFarm) console.log(`  ${FARM_LABELS[farm] ?? farm}: заявок ${e.orders}, стеблей не снято со склада ${e.stems.toLocaleString("ru-RU")} (из них по оплаченным заявкам ${e.paidStems.toLocaleString("ru-RU")})`);
  console.log("");
  for (const { o, left } of hanging) {
    const pay = o.paid ? "оплачена" : o.paidAmount > 0 ? `оплачено ${money(o.paidAmount)} из ${money(o.totalAmount)}` : `не оплачена (${money(o.totalAmount)})`;
    const items = o.items
      .filter((i) => i.quantity - i.shippedQuantity > 0)
      .map((i) => `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType} ${i.variety} ${i.grade} ${i.quantity - i.shippedQuantity}`)
      .join("; ");
    console.log(`${orderCode(o.orderId)} · ${o.clientName} · ${nameOf(o.managerEmail)} · доставка ${(o.deliveryDate || "").slice(0, 10)} · ${pay} · не отгружено ${left} шт.${o.store ? ` · ${o.store}` : ""}${o.direction ? ` · ${o.direction}` : ""}`);
    console.log(`    ${items}${o.notes ? ` · «${o.notes.slice(0, 80)}»` : ""}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
