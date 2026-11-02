import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Срезано / продано за месяц по производству (02.11.2026, владелец: «аналитику по срезано/продано за октябрь по Есентай
 * Агро Хим, среднюю цену и всё остальное»). Срезано — приёмка партий основного склада (офисные партии — отрезки от
 * основных, не считаются); продано — позиции заявок месяца по дню оформления, без отменённых, отдельно «не продажи»
 * (наши магазины, объём на город, Пожарка); отгружено, списано, выдано сотрудникам — по журналам месяца. Ничего не меняет.
 *
 *   npx tsx scripts/diag-farm-month.ts [ГГГГ-ММ=прошлый месяц] [esentai|rose_farm=esentai]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listBatches } from "../src/lib/repo/batches";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listStaffTakeouts } from "../src/lib/repo/staffTakeouts";
import { listUsers } from "../src/lib/repo/users";
import { localDayKey } from "../src/lib/timezone";
import { isConsignment, isRegionOrder } from "../src/lib/orderKind";
import { FARM_LABELS, FLOWER_TYPE_LABELS, flowerTypesForFarm, formatGrade, ORDER_STATUSES } from "../src/lib/constants";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ");
const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : iso ? localDayKey(new Date(iso)) : "");
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function prevMonth(): string {
  const d = new Date(`${localDayKey()}T00:00:00`);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Acc = { qty: number; sum: number; pricedQty: number };
const acc = (): Acc => ({ qty: 0, sum: 0, pricedQty: 0 });
const add = (a: Acc, qty: number, price: number) => {
  a.qty += qty;
  if (price > 0) {
    a.sum += qty * price;
    a.pricedQty += qty;
  }
};
const avg = (a: Acc) => (a.pricedQty ? a.sum / a.pricedQty : 0);

async function main() {
  const args = process.argv.slice(2);
  const month = args.find((a) => /^\d{4}-\d{2}$/.test(a)) || prevMonth();
  const farm = args.find((a) => a === "esentai" || a === "rose_farm") || "esentai";
  const flowers = new Set(flowerTypesForFarm(farm));
  const inMonth = (iso: string, ym = month) => day(iso).startsWith(ym);

  await prefetchTables([SHEET_TABS.BATCHES, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.SHIPMENTS, SHEET_TABS.WRITEOFFS, SHEET_TABS.STAFF_TAKEOUTS]);
  const [batches, orders, shipments, writeoffs, takeouts, users] = await Promise.all([
    listBatches(),
    listOrdersWithItems(),
    listShipments(),
    listWriteoffs(),
    listStaffTakeouts().catch(() => []),
    listUsers().catch(() => []),
  ]);
  const nameOf = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
  const batchById = new Map(batches.map((b) => [b.batchId, b]));
  const ours = (b: { flowerType: string } | undefined) => !!b && flowers.has(b.flowerType);
  const label = (f: string, v: string, g: string) => `${FLOWER_TYPE_LABELS[f] ?? f} ${v} · ${formatGrade(g)}`.replace(/\s+/g, " ");

  console.log(`=== ${FARM_LABELS[farm] ?? farm} · ${month} ===\n`);

  // --- Срезано (приёмка основного склада) ---
  const cut = batches.filter((b) => ours(b) && !(b.store || "").trim() && inMonth(b.harvestDate || b.receivedAt));
  const cutTotal = cut.reduce((s, b) => s + b.quantityIn, 0);
  const cutByGrade = new Map<string, number>();
  const cutByVariety = new Map<string, number>();
  const cutByDay = new Map<string, number>();
  for (const b of cut) {
    cutByGrade.set(b.grade, (cutByGrade.get(b.grade) || 0) + b.quantityIn);
    cutByVariety.set(b.variety, (cutByVariety.get(b.variety) || 0) + b.quantityIn);
    const d = day(b.harvestDate || b.receivedAt);
    cutByDay.set(d, (cutByDay.get(d) || 0) + b.quantityIn);
  }
  console.log(`СРЕЗАНО (принято на склад): ${fmt(cutTotal)} шт., партий ${cut.length}, дней приёмки ${cutByDay.size}, в среднем ${fmt(cutByDay.size ? cutTotal / cutByDay.size : 0)} шт. в день приёмки`);
  console.log("  по категориям:");
  for (const [g, q] of Array.from(cutByGrade.entries()).sort((a, b) => b[1] - a[1])) console.log(`    ${formatGrade(g).padEnd(14)} ${fmt(q).padStart(9)}  ${pct(q, cutTotal)}`);
  console.log("  по сортам:");
  for (const [v, q] of Array.from(cutByVariety.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`    ${v.padEnd(20)} ${fmt(q).padStart(9)}  ${pct(q, cutTotal)}`);
  const weeks = new Map<string, number>();
  for (const [d, q] of Array.from(cutByDay.entries())) {
    const dd = Number(d.slice(8, 10));
    const w = dd <= 7 ? "01–07" : dd <= 14 ? "08–14" : dd <= 21 ? "15–21" : dd <= 28 ? "22–28" : "29–31";
    weeks.set(w, (weeks.get(w) || 0) + q);
  }
  console.log(`  по неделям: ${Array.from(weeks.entries()).sort().map(([w, q]) => `${w}: ${fmt(q)}`).join(" · ")}`);

  // --- Продано (позиции заявок месяца, по дню оформления) ---
  const bucketOf = (o: (typeof orders)[number]) =>
    (o.retail || "").trim() ? "наши магазины" : isRegionOrder(o) ? "объём на город (регион)" : isConsignment(o) ? "Пожарка (перемещение)" : "продажи клиентам";
  const summarize = (ym: string) => {
    const buckets = new Map<string, Acc>();
    const byGrade = new Map<string, Acc>();
    const byVariety = new Map<string, Acc>();
    const byManager = new Map<string, Acc>();
    const byClient = new Map<string, Acc>();
    const byDelivery = new Map<string, Acc>();
    const priceBands = new Map<string, { qty: number }>();
    const clients = new Set<string>();
    let ordersN = 0;
    let shippedQty = 0;
    for (const o of orders) {
      if (o.status === ORDER_STATUSES.CANCELLED || !inMonth(o.createdAt, ym)) continue;
      const items = o.items.filter((i) => flowers.has(i.flowerType));
      if (!items.length) continue;
      const bucket = bucketOf(o);
      if (!buckets.has(bucket)) buckets.set(bucket, acc());
      if (bucket === "продажи клиентам") {
        ordersN++;
        clients.add(o.clientId || o.clientName);
      }
      for (const i of items) {
        add(buckets.get(bucket)!, i.quantity, i.unitPrice);
        if (bucket !== "продажи клиентам") continue;
        shippedQty += i.shippedQuantity;
        for (const [map, key] of [
          [byGrade, i.grade],
          [byVariety, i.variety],
          [byManager, nameOf.get(o.managerEmail.toLowerCase()) || o.managerEmail || "—"],
          [byClient, o.clientName || "—"],
          [byDelivery, (o.direction || "").trim() || "Алматы"],
        ] as [Map<string, Acc>, string][]) {
          if (!map.has(key)) map.set(key, acc());
          add(map.get(key)!, i.quantity, i.unitPrice);
        }
        if (i.unitPrice > 0) {
          const band = `${formatGrade(i.grade)} @ ${i.unitPrice} ₸`;
          priceBands.set(band, { qty: (priceBands.get(band)?.qty || 0) + i.quantity });
        }
      }
    }
    return { buckets, byGrade, byVariety, byManager, byClient, byDelivery, priceBands, clients: clients.size, ordersN, shippedQty };
  };
  const cur = summarize(month);
  const prev = summarize(shiftMonth(month, -1));
  const sales = cur.buckets.get("продажи клиентам") ?? acc();
  const salesPrev = prev.buckets.get("продажи клиентам") ?? acc();
  const allMoved = Array.from(cur.buckets.values()).reduce((s, a) => s + a.qty, 0);

  console.log(`\nПРОДАНО КЛИЕНТАМ (заявки ${month}, по дню оформления, без отменённых):`);
  console.log(`  ${fmt(sales.qty)} шт. на ${fmt(sales.sum)} ₸ · средняя цена ${fmt(avg(sales))} ₸/шт · заявок ${cur.ordersN} · клиентов ${cur.clients} · средняя заявка ${fmt(cur.ordersN ? sales.qty / cur.ordersN : 0)} шт. / ${fmt(cur.ordersN ? sales.sum / cur.ordersN : 0)} ₸`);
  console.log(`  из них уже отгружено по заявкам: ${fmt(cur.shippedQty)} шт.${sales.qty - sales.pricedQty ? ` · без цены: ${fmt(sales.qty - sales.pricedQty)} шт.` : ""}`);
  console.log(`  прошлый месяц: ${fmt(salesPrev.qty)} шт. на ${fmt(salesPrev.sum)} ₸ · средняя ${fmt(avg(salesPrev))} ₸ → изменение: шт. ${salesPrev.qty ? `${sales.qty >= salesPrev.qty ? "+" : ""}${Math.round(((sales.qty - salesPrev.qty) / salesPrev.qty) * 100)}%` : "—"}, ₸ ${salesPrev.sum ? `${sales.sum >= salesPrev.sum ? "+" : ""}${Math.round(((sales.sum - salesPrev.sum) / salesPrev.sum) * 100)}%` : "—"}`);
  console.log("  НЕ продажи (ушло со склада, но не продажа):");
  for (const [b, a] of Array.from(cur.buckets.entries())) if (b !== "продажи клиентам") console.log(`    ${b.padEnd(26)} ${fmt(a.qty).padStart(9)} шт.${a.sum ? ` · по заявкам ${fmt(a.sum)} ₸, средняя ${fmt(avg(a))}` : ""}`);
  console.log(`  ВСЕГО по заявкам месяца (продажи + не продажи): ${fmt(allMoved)} шт. = ${pct(allMoved, cutTotal)} от срезанного; продажи клиентам — ${pct(sales.qty, cutTotal)}`);

  const table = (title: string, map: Map<string, Acc>, n = 20, keyFmt = (k: string) => k) => {
    console.log(`\n  ${title}:  шт. · ₸ · средняя ₸/шт · доля шт.`);
    for (const [k, a] of Array.from(map.entries()).sort((x, y) => y[1].qty - x[1].qty).slice(0, n))
      console.log(`    ${keyFmt(k).slice(0, 26).padEnd(26)} ${fmt(a.qty).padStart(8)} · ${fmt(a.sum).padStart(11)} · ${fmt(avg(a)).padStart(5)} · ${pct(a.qty, sales.qty)}`);
  };
  table("по категориям", cur.byGrade, 20, formatGrade);
  console.log("\n  категория: средняя цена сейчас против прошлого месяца:");
  for (const [g, a] of Array.from(cur.byGrade.entries()).sort((x, y) => y[1].qty - x[1].qty)) {
    const p = prev.byGrade.get(g);
    console.log(`    ${formatGrade(g).padEnd(14)} ${fmt(avg(a)).padStart(5)} ₸ (было ${p ? fmt(avg(p)) : "—"}) · ${fmt(a.qty)} шт. (было ${p ? fmt(p.qty) : "—"})`);
  }
  table("по сортам", cur.byVariety, 15);
  table("по менеджерам", cur.byManager, 15);
  table("по направлениям", cur.byDelivery, 10);
  table("крупнейшие клиенты", cur.byClient, 15);
  console.log("\n  по каким ценам продавали (категория @ цена — шт.), крупнейшие:");
  for (const [b, x] of Array.from(cur.priceBands.entries()).sort((a, c) => c[1].qty - a[1].qty).slice(0, 15)) console.log(`    ${b.padEnd(26)} ${fmt(x.qty).padStart(8)}`);

  // --- Отгружено, списано, выдано (по журналам месяца) ---
  const shipped = shipments.filter((s) => inMonth(s.createdAt) && ours(batchById.get(s.batchId)));
  const shippedTotal = shipped.reduce((s, x) => s + x.quantity, 0);
  const wo = writeoffs.filter((w) => inMonth(w.createdAt) && ours(batchById.get(w.batchId)));
  const woTotal = wo.reduce((s, x) => s + x.quantity, 0);
  const woByReason = new Map<string, number>();
  for (const w of wo) woByReason.set(w.reason || "—", (woByReason.get(w.reason || "—") || 0) + w.quantity);
  const woByGrade = new Map<string, number>();
  for (const w of wo) {
    const g = batchById.get(w.batchId)?.grade || "—";
    woByGrade.set(g, (woByGrade.get(g) || 0) + w.quantity);
  }
  const to = takeouts.filter((t) => inMonth(t.date || t.createdAt) && flowers.has(t.flowerType));
  const toTotal = to.reduce((s, x) => s + x.quantity, 0);
  const toSum = to.reduce((s, x) => s + x.quantity * (x.unitPrice || 0), 0);
  console.log(`\nОТГРУЖЕНО за месяц (журнал отгрузок, все заявки): ${fmt(shippedTotal)} шт. = ${pct(shippedTotal, cutTotal)} от срезанного`);
  console.log(`СПИСАНО за месяц: ${fmt(woTotal)} шт. = ${pct(woTotal, cutTotal)} от срезанного`);
  for (const [r, q] of Array.from(woByReason.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${r.slice(0, 40).padEnd(40)} ${fmt(q).padStart(8)}`);
  console.log(`  списано по категориям: ${Array.from(woByGrade.entries()).sort((a, b) => b[1] - a[1]).map(([g, q]) => `${formatGrade(g)} ${fmt(q)}`).join(" · ")}`);
  console.log(`ВЫДАНО сотрудникам: ${fmt(toTotal)} шт.${toSum ? ` на ${fmt(toSum)} ₸` : ""}`);

  // --- Остаток срезанного в месяце ---
  const left = cut.reduce((s, b) => s + b.quantityRemaining, 0);
  console.log(`\nИЗ СРЕЗАННОГО В ${month} СЕЙЧАС НА СКЛАДЕ: ${fmt(left)} шт. (${pct(left, cutTotal)})`);
  console.log(`Баланс месяца: срезано ${fmt(cutTotal)} − отгружено ${fmt(shippedTotal)} − списано ${fmt(woTotal)} − выдано ${fmt(toTotal)} = ${fmt(cutTotal - shippedTotal - woTotal - toTotal)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
