/**
 * «Итоги месяца» (`src/lib/monthReport.ts`): каналы, средняя, прайс для заявок без цены, недели, списание из срезки
 * месяца, новые клиенты, сравнение с прошлым месяцем.
 */
import { buildMonthReport, cleanMonth, defaultMonth, shiftMonth, avgPrice } from "../src/lib/monthReport";
import type { Batch, OrderWithItems } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : `: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`}`);
}

const B = (id: string, day: string, grade: string, qin: number, left: number, store = "", source = ""): Batch => ({
  batchId: id, receivedAt: day, harvestDate: day, flowerType: "chrysanthemum" as never, variety: "Altaj", grade, quantityIn: qin,
  quantityRemaining: left, location: "", receivedByEmail: "", store, sourceBatchId: source,
});
const O = (id: string, created: string, p: Partial<OrderWithItems>, items: [string, number, number][]): OrderWithItems =>
  ({
    orderId: id, createdAt: `${created}T05:00:00Z`, managerEmail: "m@x", clientName: p.clientName ?? "Клиент", clientId: p.clientId ?? "", clientPhone: "",
    deliveryDate: created, status: "new", notes: "", store: "", retail: "", kind: "", direction: "", paidAmount: 0, totalAmount: 0,
    items: items.map(([grade, q, price], i) => ({ orderId: id, itemId: `${id}-${i}`, flowerType: "chrysanthemum", variety: "Altaj", grade, quantity: q, unitPrice: price, shippedQuantity: 0 })),
    ...p,
  }) as unknown as OrderWithItems;

const r = buildMonthReport({
  month: "2026-10",
  farm: "esentai",
  batches: [B("M1", "2026-10-02", "Третья", 1000, 100), B("M2", "2026-10-20", "Первая", 500, 300), B("M0", "2026-09-28", "Третья", 400, 0), B("A1", "2026-10-02", "Третья", 0, 50, "astana", "M1")],
  orders: [
    O("o1", "2026-10-03", { clientId: "c1" }, [["Третья", 200, 250]]),
    O("o2", "2026-10-21", { clientId: "c2" }, [["Первая", 100, 450]]),
    O("o3", "2026-10-22", { kind: "region", direction: "Астана" } as never, [["Третья", 300, 0]]),
    O("o4", "2026-10-23", { clientName: "Пожарка" }, [["Третья", 100, 300]]),
    O("o5", "2026-10-24", { status: "cancelled", clientId: "c1" } as never, [["Третья", 999, 250]]),
    O("p1", "2026-09-10", { clientId: "c1" }, [["Третья", 100, 300]]),
  ],
  shipments: [],
  writeoffs: [
    { writeoffId: "w1", createdAt: "2026-10-25T05:00:00Z", batchId: "M1", quantity: 150, reason: "Порча", warehouseEmail: "" },
    { writeoffId: "w2", createdAt: "2026-10-05T05:00:00Z", batchId: "M0", quantity: 40, reason: "Порча", warehouseEmail: "" },
  ],
  takeouts: [],
  pointDays: [],
  payments: [],
  priceRows: [{ date: "2026-10-01", flowerType: "chrysanthemum", variety: "", grade: "Третья", price: 270, kind: "" } as never],
  names: new Map([["m@x", "Ильяс"]]),
});
check("срезано — только основной склад и только месяц", [r.cut.total, r.cut.batches, r.cut.prevTotal], [1500, 2, 400]);
check("каналы: клиенты, регион, Пожарка", r.channels.map((c) => [c.channel, c.money.qty]), [["clients", 300], ["region", 300], ["point", 100]]);
check("регион без цены — по прайсу на день заявки", [r.channels[1].money.sum, r.channels[1].byList], [81000, 300]);
check("клиенты: шт., ₸, средняя, заявок, новых", [r.clients.qty, r.clients.sum, Math.round(avgPrice(r.clients)), r.clients.orders, r.clients.newClients], [300, 95000, 317, 2, 1]);
check("прошлый месяц клиентам", [r.clientsPrev.qty, r.clientsPrev.sum], [100, 30000]);
check("списано в месяце и из срезки месяца", [r.writeoff.total, r.writeoff.fromMonthCut], [190, 150]);
check("на складе из срезки — с партией Астаны", r.leftFromCut, 450);
check("неделя 01–04 и последняя 26–31", [r.weeks[0].label, r.weeks[r.weeks.length - 1].label, r.weeks[0].cut], ["01–04", "26–31", 1000]);
check("категория Третья: ушло всё, клиентам, прошлый месяц", (() => { const g = r.grades.find((x) => x.grade === "Третья")!; return [g.sold.qty, g.clients.qty, g.clientsPrevAvg, g.writeoff]; })(), [600, 200, 300, 190]);
check("менеджер", r.managers.map((m) => [m.name, m.money.qty, m.orders]), [["Ильяс", 300, 2]]);
check("месяц по умолчанию: до 5-го — прошлый", [defaultMonth("2026-11-02"), defaultMonth("2026-11-10"), cleanMonth("2026-13", "2026-11-02"), cleanMonth("2027-01", "2026-11-02"), shiftMonth("2026-01", -1)], ["2026-10", "2026-11", "2026-10", "2026-10", "2025-12"]);
console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
