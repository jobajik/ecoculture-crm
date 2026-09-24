/*
 * Проверка аналитики склада (`src/lib/stockAnalytics.ts`).
 * Запуск: npx tsx scripts/check-stock-analytics.ts
 */
import { buildStockAnalytics } from "../src/lib/stockAnalytics";
import type { Batch, OrderWithItems, Shipment, StaffTakeout, Writeoff } from "../src/lib/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

const batch = (id: string, flowerType: string, variety: string, grade: string, received: string, qin: number, rem: number, harvest = received): Batch =>
  ({ batchId: id, receivedAt: received, harvestDate: harvest, flowerType, variety, grade, quantityIn: qin, quantityRemaining: rem, location: "", receivedByEmail: "" }) as Batch;
let n = 0;
const ship = (batchId: string, orderId: string, day: string, q: number): Shipment =>
  ({ shipmentId: `S${++n}`, createdAt: `${day}T10:00:00`, orderId, itemId: "", batchId, quantity: q, warehouseEmail: "", notes: "" }) as Shipment;
const wo = (batchId: string, day: string, q: number): Writeoff =>
  ({ writeoffId: `W${++n}`, createdAt: `${day}T10:00:00`, batchId, quantity: q, reason: "Порча", warehouseEmail: "" }) as Writeoff;
const take = (batchId: string, day: string, q: number, kind = ""): StaffTakeout =>
  ({ takeoutId: `T${++n}`, createdAt: day, date: day, staffName: "", batchId, flowerType: "rose", variety: "", grade: "", quantity: q, unitPrice: 0, warehouseEmail: "", note: "", kind }) as StaffTakeout;
const order = (orderId: string, extra: Partial<OrderWithItems> = {}) => ({ orderId, retail: "", kind: "", items: [], ...extra }) as unknown as OrderWithItems;

// Загрузка остатков 10.08, дальше приход в августе и сентябре.
const batches = [
  batch("R1", "rose", "Prestige", "60", "2026-08-10", 1000, 0),
  batch("R2", "rose", "Prestige", "60", "2026-09-05", 500, 200, "2026-09-05"),
  batch("R3", "rose", "Avalanche", "50", "2026-09-10", 300, 300, "2026-09-01"), // лежит 23 дня — просрочен (роза 7)
  batch("C1", "chrysanthemum", "Bacardy", "Высшая", "2026-09-12", 800, 100),
];
const orders = [order("O-CL"), order("O-SH", { retail: "almaty" }), order("O-RG", { kind: "region" })];
const shipments = [
  ship("R1", "O-CL", "2026-08-20", 600),
  ship("R1", "O-SH", "2026-09-02", 300),
  ship("R2", "O-RG", "2026-09-06", 250),
  ship("R2", "O-CL", "2026-09-07", 50),
  ship("R2", "O-CL", "2026-09-08", -20), // возврат
  ship("C1", "O-CL", "2026-09-15", 600),
];
const writeoffs = [wo("R1", "2026-09-03", 100), wo("R2", "2026-09-09", 10), wo("C1", "2026-09-20", 90)];
const takeouts = [take("R2", "2026-09-09", 5), take("C1", "2026-09-21", 10, "company"), take("R2", "2026-09-10", 5)];
const settings = { shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 }, warningThreshold: 0.7 };

const a = buildStockAnalytics({ batches, shipments, writeoffs, takeouts, orders, settings, period: "2026-09", today: "2026-09-24", now: new Date("2026-09-24T12:00:00") });
const c = a.current;

check("остаток на начало сентября = 1000 − 600", c.opening === 400, String(c.opening));
check("приход сентября", c.received === 1600, String(c.received));
check("отгрузки по видам: клиентам 50−20+600, магазины 300, города 250", c.toClients === 630 && c.toShops === 300 && c.toRegions === 250, JSON.stringify(c));
check("списано и выдачи", c.writtenOff === 200 && c.toStaff === 10 && c.toCompany === 10);
const out = c.toClients + c.toShops + c.toRegions + c.writtenOff + c.toStaff + c.toCompany;
check("начало + приход − расход = конец", c.opening + c.received - out === c.closing, `${c.opening}+${c.received}-${out} vs ${c.closing}`);
check("конец по движениям = живой остаток (всё записано)", c.closing === 600 && a.unexplained === 0, `${c.closing} / ${a.unexplained}`);
check("учтено 24 дня сентября", c.days === 24);
check("август: приход 1000, из них загрузка остатков 10.08", a.previous.received === 1000 && a.previous.initialLoad === 1000 && a.previous.initialLoadDay === "2026-08-10");
check("в сентябре загрузки нет", c.initialLoad === 0);
check("отгружено всего и в прошлом месяце", a.shipped === 1180 && a.prevShipped === 600);
check("просрочено сейчас: розы старше 7 дней (200 + 300)", a.expiredNow === 500, String(a.expiredNow));
check("запас в днях = остаток / (отгрузки / дни)", Math.abs((a.coverDays ?? 0) - 600 / (1180 / 24)) < 0.001);

const rose = a.byFlower.find((r) => r.key === "rose")!;
check("розы: приход 800, отгрузка 580, списано 110, прочее 10", rose.received === 800 && rose.shipped === 580 && rose.writtenOff === 110 && rose.other === 10, JSON.stringify(rose));
check("порядок цветков: роза, потом хризантема", a.byFlower.map((r) => r.key).join() === "rose,chrysanthemum");
check("ростовки розы по порядку длин: 50 раньше 60", a.byGrade.findIndex((r) => r.key === "rose|50") < a.byGrade.findIndex((r) => r.key === "rose|60"));
check("главная потеря — Prestige 60 (110)", a.losses[0].key === "rose|Prestige|60" && a.losses[0].writtenOff === 110);
check("последняя неделя (28–30) ещё впереди", a.weeks[a.weeks.length - 1].future && !a.weeks[0].future);
check("недели: приход сходится с месяцем", a.weeks.reduce((s, w) => s + w.received, 0) === c.received);

// Расхождение: из партии ушло 50 без записи.
const broken = batches.map((b) => (b.batchId === "C1" ? { ...b, quantityRemaining: 50 } : b));
const x = buildStockAnalytics({ batches: broken, shipments, writeoffs, takeouts, orders, settings, period: "2026-09", today: "2026-09-24" });
check("неучтённое движение видно отдельной цифрой", x.unexplained === -50, String(x.unexplained));

// Производство: зав. складом Есентая видит только хризантему.
const e = buildStockAnalytics({ batches, shipments, writeoffs, takeouts, orders, settings, period: "2026-09", today: "2026-09-24", farm: "esentai" });
check("Есентай: только хризантема", e.byFlower.length === 1 && e.byFlower[0].key === "chrysanthemum" && e.current.received === 800 && e.current.toClients === 600);
check("Есентай: загрузка остатков считается по всей базе (10.08), в сентябре её нет", e.current.initialLoad === 0);

const empty = buildStockAnalytics({ batches: [], shipments: [], writeoffs: [], takeouts: [], orders: [], settings, period: "2026-09", today: "2026-09-24" });
check("пустой склад не падает", empty.current.received === 0 && empty.coverDays === null && empty.byFlower.length === 0);

if (failed) {
  console.log(`\nПровалено: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
