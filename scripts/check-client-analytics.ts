/*
 * Проверка аналитики клиентов за месяц (`src/lib/clientAnalytics.ts`).
 * Запуск: npx tsx scripts/check-client-analytics.ts
 */
import { buildClientAnalytics } from "../src/lib/clientAnalytics";
import type { Client, OrderWithItems } from "../src/lib/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

const client = (id: string, city: string, manager: string, extra: Partial<Client> = {}): Client =>
  ({
    clientId: id, createdAt: "2026-08-01", name: `Клиент ${id}`, city, shopName: "", clientType: "Цветочный магазин",
    contactPerson: "", phone: "", messenger: "", address: "", paymentTerms: "", source: "", note: "",
    managerEmail: manager, retail: "", active: true, paymentMethod: "", kaspiPay1: "", kaspiPay2: "", ...extra,
  }) as Client;

let n = 0;
const order = (clientId: string, created: string, manager: string, items: [string, number, number][], paid = 0, extra: Partial<OrderWithItems> = {}): OrderWithItems =>
  ({
    orderId: `O${++n}`, createdAt: `${created}T10:00:00`, managerEmail: manager, clientId, clientName: "", clientPhone: "",
    deliveryDate: created, status: "new", notes: "", paidAmount: paid, direction: "", kind: "", retail: "",
    items: items.map(([flowerType, quantity, unitPrice], i) => ({ itemId: `I${n}-${i}`, orderId: `O${n}`, flowerType, variety: "X", grade: "60", quantity, unitPrice, shippedQuantity: 0 })),
    ...extra,
  }) as unknown as OrderWithItems;

const clients = [
  client("A", "Алматы", "m1@x"),
  client("B", "алматы ", "m1@x"),
  client("C", "Астана", "m2@x"),
  client("D", "Шымкент", "m2@x"),
  client("S", "Алматы", "m1@x", { retail: "almaty" }), // наш магазин
  client("N", "Тараз", "m2@x"), // без заявок
];
const orders = [
  order("A", "2026-08-05", "m1@x", [["rose", 100, 200]], 20000), // A покупал в августе
  order("A", "2026-09-02", "m1@x", [["rose", 100, 200], ["chrysanthemum", 50, 400]], 40000),
  order("A", "2026-09-20", "m1@x", [["rose", 50, 200]], 0),
  order("B", "2026-09-10", "m1@x", [["rose", 10, 200]], 2000), // новый в сентябре
  order("C", "2026-09-12", "m2@x", [["chrysanthemum", 100, 300]], 30000), // новый
  order("D", "2026-08-01", "m2@x", [["rose", 500, 200]], 100000), // молчит с 1 августа
  order("D", "2026-07-01", "m2@x", [["rose", 500, 200]], 100000),
  order("C", "2026-09-13", "m2@x", [["rose", 1, 1]], 0, { status: "cancelled" } as never), // отменена
  order("S", "2026-09-14", "m1@x", [["rose", 999, 100]], 0, { retail: "almaty" } as never), // наш магазин
];
const names = new Map([["m1@x", "Эмиль"], ["m2@x", "Ильяс"]]);
const a = buildClientAnalytics({ clients, orders, nameByEmail: names, period: "2026-09", today: "2026-09-24" });

check("выручка месяца без отмен и магазина", a.current.revenue === 40000 + 10000 + 2000 + 30000, String(a.current.revenue));
check("покупали трое (A, B, C)", a.current.buyers === 3, String(a.current.buyers));
check("новых двое (B, C), вернулся один (A)", a.current.newBuyers === 2 && a.current.returning === 1);
check("A взял дважды", a.current.repeatBuyers === 1);
check("получено не больше счёта", a.current.paid === 40000 + 0 + 2000 + 30000, String(a.current.paid));
check("прошлый месяц — август", a.prevPeriod === "2026-08" && a.previous.revenue === 20000 + 100000);
check("в базе без магазина: 5 карточек", a.baseClients === 5);
check("без заявок: Тараз", a.neverOrdered === 1);

const m1 = a.byManager.find((r) => r.label === "Эмиль")!;
check("Эмиль: выручка и покупатели", m1.revenue === 52000 && m1.buyers === 2 && m1.newBuyers === 1, JSON.stringify(m1));
check("Эмиль: в базе 2 карточки (без магазина)", m1.baseClients === 2);
check("Эмиль: к прошлому — 20 000", m1.prevRevenue === 20000);
const shares = a.byManager.reduce((s, r) => s + r.share, 0);
check("доли менеджеров дают 100 %", Math.abs(shares - 100) < 0.01, String(shares));

const alm = a.byCity.find((r) => r.label.toLowerCase().startsWith("алматы"))!;
check("«Алматы» и «алматы » — один город", alm.buyers === 2 && a.byCity.filter((r) => r.label.toLowerCase().trim() === "алматы").length === 1);

const rose = a.byFlower.find((r) => r.key === "rose")!;
const chr = a.byFlower.find((r) => r.key === "chrysanthemum")!;
check("цветы по позициям: роза 32 000, хризантема 50 000", rose.revenue === 32000 && chr.revenue === 50000);
check("оплата смешанной заявки делится по долям", Math.abs((rose.paidPercent ?? 0) - ((20000 * 40000 / 40000 + 0 + 2000) / 32000) * 100) < 0.01, String(rose.paidPercent));

check("ABC: A-группа есть и доли 100 %", a.abc[0].clients >= 1 && Math.abs(a.abc.reduce((s, b) => s + b.share, 0) - 100) < 0.01);
check("топ: первый — A", a.top[0].clientId === "A");
// B взял один раз 14 дней назад — это уже повод позвонить; A и C заказывают в своём ритме.
check("молчат D (54 дня, ценный — первым) и B (14 дней)", a.quiet.map((q) => q.clientId).join() === "D,B" && a.quiet[0].daysSinceLast === 54, JSON.stringify(a.quiet.map((q) => [q.clientId, q.daysSinceLast])));
check("обычный перерыв D — 31 день", a.quiet[0].usualGap === 31);

const empty = buildClientAnalytics({ clients: [], orders: [], nameByEmail: new Map(), period: "2026-09", today: "2026-09-24" });
check("пустая база не падает", empty.current.revenue === 0 && empty.byManager.length === 0 && empty.abc[0].clients === 0);

if (failed) {
  console.log(`\nПровалено: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
