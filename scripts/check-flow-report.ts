/**
 * «Срез · продажи · списания» (`src/lib/flowReport.ts`): период и прошлый период, срезано только с основного склада,
 * продано без склада Астаны, отгружено с основного и офиса, списано любым складом, остаток на начало и конец,
 * возраст при списании, план против факта, границы периода из адреса.
 */
import { buildFlowReport, cleanRange, presetRange, shiftDay, daysBetween } from "../src/lib/flowReport";
import { avgPrice } from "../src/lib/monthReport";
import type { Batch, OrderWithItems, Shipment, Writeoff } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : `: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`}`);
}

const B = (id: string, day: string, grade: string, qin: number, left: number, store = "", source = "", flowerType = "chrysanthemum", variety = "Altaj"): Batch => ({
  batchId: id, receivedAt: day, harvestDate: day, flowerType: flowerType as never, variety, grade, quantityIn: qin,
  quantityRemaining: left, location: "", receivedByEmail: "", store, sourceBatchId: source,
});
const O = (id: string, created: string, p: Partial<OrderWithItems>, items: [string, number, number][], flowerType = "chrysanthemum"): OrderWithItems =>
  ({
    orderId: id, createdAt: `${created}T05:00:00Z`, managerEmail: "m@x", clientName: p.clientName ?? "Клиент", clientId: p.clientId ?? "", clientPhone: "",
    deliveryDate: created, status: "new", notes: "", store: "", retail: "", kind: "", direction: "", paidAmount: 0, totalAmount: 0,
    items: items.map(([grade, q, price], i) => ({ orderId: id, itemId: `${id}-${i}`, flowerType, variety: "Altaj", grade, quantity: q, unitPrice: price, shippedQuantity: 0 })),
    ...p,
  }) as unknown as OrderWithItems;
const S = (id: string, day: string, orderId: string, batchId: string, quantity: number): Shipment => ({ shipmentId: id, createdAt: `${day}T06:00:00Z`, orderId, itemId: `${orderId}-0`, batchId, quantity, warehouseEmail: "w@x", notes: "" });
const W = (id: string, day: string, batchId: string, quantity: number, reason = "Порча"): Writeoff => ({ writeoffId: id, createdAt: `${day}T06:00:00Z`, batchId, quantity, reason, warehouseEmail: "w@x" });

const r = buildFlowReport({
  from: "2026-10-01",
  to: "2026-10-31",
  farm: "",
  flower: "",
  today: "2026-11-10",
  batches: [
    B("M1", "2026-10-02", "Третья", 1000, 100),
    B("M2", "2026-10-20", "Первая", 500, 300),
    B("M0", "2026-09-28", "Третья", 400, 0), // прошлый период
    B("M3", "2026-11-03", "Третья", 600, 600), // после периода
    B("OF", "2026-10-02", "Третья", 0, 50, "office", "M1"), // отрезок в офис — приход ноль
    B("AS", "2026-10-02", "Третья", 0, 70, "astana", "M1"), // склад Астаны
    B("R1", "2026-10-05", "60", 800, 200, "", "", "rose", "Freedom"),
  ],
  orders: [
    O("o1", "2026-10-03", { clientId: "c1" }, [["Третья", 200, 250]]),
    O("o2", "2026-10-21", { clientId: "c2" }, [["Первая", 100, 450]]),
    O("o3", "2026-10-22", { kind: "region", direction: "Астана" } as never, [["Третья", 300, 0]]), // объём на город — по прайсу
    O("o4", "2026-10-23", { store: "astana", clientId: "c9" } as never, [["Третья", 60, 300]]), // со склада Астаны — не считается
    O("o5", "2026-10-24", { status: "cancelled", clientId: "c1" } as never, [["Третья", 999, 250]]),
    O("p1", "2026-09-10", { clientId: "c1" }, [["Третья", 100, 300]]), // прошлый период
    O("r1", "2026-10-06", { clientId: "c3" }, [["60", 400, 230]], "rose"),
  ],
  shipments: [
    S("s1", "2026-10-04", "o1", "M1", 200),
    S("s2", "2026-10-22", "o3", "M1", 300), // в регион
    S("s3", "2026-10-24", "o4", "AS", 60), // со склада Астаны — не отгрузка хозяйства
    S("s4", "2026-10-05", "o1", "OF", 50), // с офиса — считается
    S("s5", "2026-11-05", "o2", "M2", 100), // после периода
  ],
  writeoffs: [
    W("w1", "2026-10-25", "M1", 150),
    W("w2", "2026-10-05", "M0", 40, "Брак"),
    W("w3", "2026-10-03", "M1", 100, "Брак"), // на второй день — брак
    W("w4", "2026-09-29", "M0", 30),
    W("w5", "2026-11-06", "M2", 20),
  ],
  takeouts: [
    { takeoutId: "t1", createdAt: "2026-10-10T06:00:00Z", date: "2026-10-10", staffName: "Иван", batchId: "M1", flowerType: "chrysanthemum" as never, variety: "Altaj", grade: "Третья", quantity: 30, unitPrice: 100, warehouseEmail: "w@x", note: "", kind: "" },
  ],
  moves: [{ moveId: "mv1", createdAt: "2026-10-02T07:00:00Z", direction: "to_office", flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 50, fromBatchId: "M1", toBatchId: "OF", byEmail: "", note: "" }],
  forecast: [
    { period: "2026-10-W1", flowerType: "chrysanthemum", variety: "Altaj", targetStems: 1200, updatedAt: "", updatedByEmail: "" },
    { period: "2026-09-W5", flowerType: "chrysanthemum", variety: "Altaj", targetStems: 9999, updatedAt: "", updatedByEmail: "" },
  ],
  priceRows: [{ date: "2026-10-01", flowerType: "chrysanthemum", variety: "", grade: "Третья", price: 270, kind: "" } as never],
  names: new Map([["w@x", "Разия"]]),
});

check("период и прошлый период", [r.days, r.prevFrom, r.prevTo], [31, "2026-08-31", "2026-09-30"]);
check("срезано: основной склад, без после и до", [r.total.cut, r.total.prev.cut], [2300, 400]);
check("продано: без Астаны и отменённых, регион по прайсу", [r.total.sold.qty, r.total.sold.sum, r.total.prev.sold.qty], [1000, 50000 + 45000 + 81000 + 92000, 100]);
check("каналы", r.channels.map((c) => [c.channel, c.money.qty, c.byList, c.orders]), [["clients", 700, 0, 3], ["region", 300, 300, 1]]);
check("со склада Астаны продано отдельно", r.regionSold, 60);
check("отгружено: основной + офис, без Астаны и после; в регион", [r.total.shipped, r.toRegion], [550, 300]);
check("списано: период, прошлый, причины", [r.total.writeoff, r.total.prev.writeoff, r.writeoffReasons.map((x) => [x.reason, x.qty])], [290, 30, [["Порча", 150], ["Брак", 140]]]);
check("возраст при списании: 0–3 и 15+ (M0 с 28.09 → 05.10 = 7 дн.)", r.writeoffAge.map((x) => x.qty), [100, 40, 0, 150]);
check("кто списывал — по имени", r.writeoffPeople, [{ name: "Разия", qty: 290 }]);
check("выдано и в офис", [r.total.takeouts, r.toOffice], [30, 50]);
check("остаток сейчас: основной + офис, Астана отдельно", [r.balance.now, r.balance.region], [1250, 70]);
// конец периода: сейчас 1250 + отгружено после 100 + списано после 20 − срезано после 600 = 770
check("остаток на конец и начало", [r.balance.end, r.balance.start], [770, 770 - 2300 + 550 + 290 + 30]);
check("по компаниям", r.byFarm.map((x) => [x.key, x.cut, x.sold.qty]), [["esentai", 1500, 600], ["rose_farm", 800, 400]]);
check("по цветку: порядок по объёму", r.byFlower.map((x) => x.flowerType), ["chrysanthemum", "rose"]);
check("по категориям: Третья", (() => { const g = r.byGrade.find((x) => x.key === "chrysanthemum|Третья")!; return [g.cut, g.sold.qty, g.shipped, g.writeoff, g.remaining, Math.round(avgPrice(g.sold))]; })(), [1000, 500, 550, 290, 750, 262]);
check("динамика по дням: 31 точка, 02.10 срезано 1000", [r.timeline.unit, r.timeline.points.length, r.timeline.points[1].cut, r.timeline.points[2].sold], ["day", 31, 1000, 200]);
check("возраст при отгрузке розы нет, хризантемы медиана 2 (200×2 дн. + 50×3 + 300×20)", r.shipAge.map((x) => [x.flowerType, x.median, x.over7]), [["chrysanthemum", 3, 300]]);
check("план против факта: только неделя внутри периода", r.forecast, [{ flowerType: "chrysanthemum", label: "Хризантема", plan: 1200, fact: 1500 }]);
check("свежесть склада на 10.11: всё старше 15 дн., кроме M3", r.stockAge.map((x) => [x.flowerType, x.buckets]), [["chrysanthemum", [0, 600, 0, 450]], ["rose", [0, 0, 0, 200]]]);

const r2 = buildFlowReport({ from: "2026-09-01", to: "2026-10-31", farm: "esentai", flower: "", today: "2026-11-10", batches: [], orders: [], shipments: [], writeoffs: [], takeouts: [], moves: [], forecast: [], priceRows: [], names: new Map() });
check("61 день — по неделям, первая неделя 01–06.09 (пн 31.08)", [r2.timeline.unit, r2.timeline.points[0].from, r2.timeline.points[0].to, r2.timeline.points[r2.timeline.points.length - 1].to], ["week", "2026-09-01", "2026-09-06", "2026-10-31"]);
check("пустые данные не роняют", [r2.total.cut, r2.balance.end, r2.insights.length], [0, 0, 0]);

check("границы из адреса", [cleanRange("2026-10-05", "2026-10-01", "2026-11-10"), cleanRange("мусор", "", "2026-11-10"), cleanRange("2026-10-01", "2027-01-01", "2026-11-10")], [{ from: "2026-10-01", to: "2026-10-05" }, { from: "2026-10-12", to: "2026-11-10" }, { from: "2026-10-01", to: "2026-11-10" }]);
check("готовые периоды", [presetRange("week", "2026-11-10"), presetRange("prev-month", "2026-11-10"), presetRange("month", "2026-11-10"), presetRange("7", "2026-11-10")], [{ from: "2026-11-09", to: "2026-11-10" }, { from: "2026-10-01", to: "2026-10-31" }, { from: "2026-11-01", to: "2026-11-10" }, { from: "2026-11-04", to: "2026-11-10" }]);
check("дни", [shiftDay("2026-03-01", -1), daysBetween("2026-10-01", "2026-10-31")], ["2026-02-28", 30]);

if (failed) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
