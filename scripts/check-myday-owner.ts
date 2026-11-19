/**
 * Главная владельца и РОПа — «состояние на сейчас» (`src/lib/myDay/owner.ts`, 18.11.2026).
 *
 * Проверяем счёт, а не вид: продано сегодня — по дню оформления по Алматы и без не-продаж; получено — по дню
 * поступления и по компаниям; должники — по клиентам, просроченные первыми; цвет менеджера — относительно темпа
 * месяца; склад за день — приёмка только основного склада, отгрузки с учётом возвратов, к отгрузке сегодня — только
 * готовые заявки.
 *
 * Запуск: npx tsx scripts/check-myday-owner.ts
 */
import { buildOwnerDay, managerTone, type OwnerDayInput } from "../src/lib/myDay/owner";
import type { ManagerSalesRow } from "../src/lib/salesAnalytics";
import type { OrderWithItems, Payment } from "../src/lib/types";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const TODAY = "2026-11-18";
const toDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" });

const item = (flowerType: string, quantity: number, unitPrice: number, shippedQuantity = 0) => ({ flowerType, variety: "V", grade: "60", quantity, shippedQuantity, unitPrice });
const order = (p: Partial<OrderWithItems> & { orderId: string }): OrderWithItems =>
  ({
    createdAt: "2026-11-01T10:00:00+05:00", managerEmail: "ilyas@x.kz", clientName: "Цветы 24", clientPhone: "", deliveryDate: "2026-11-25",
    status: "new", notes: "", managerConfirmed: true, paid: true, paidAmount: 100_000, totalAmount: 100_000, retail: "", kind: "", direction: "",
    store: "", items: [item("rose", 500, 200)],
    ...p,
  }) as unknown as OrderWithItems;
const payment = (p: Partial<Payment> & { paymentId: string }): Payment =>
  ({ orderId: "x", createdAt: "", date: TODAY, amount: 1000, farm: "rose_farm", method: "Каспи", accountantEmail: "", note: "", ...p }) as Payment;
const manager = (p: Partial<ManagerSalesRow> & { managerEmail: string }): ManagerSalesRow =>
  ({ name: "", amountMonth: 0, stemsMonth: 0, ordersMonth: 0, amountToday: 0, ordersToday: 0, targetAmount: 0, targetStems: 0, progressPercent: 0, avgOrderAmount: 0, byFarm: {}, byFlower: {}, ...p }) as ManagerSalesRow;

const orders = [
  // Сегодня: 18.11 00:30 по Алматы — это ещё 17.11 по Гринвичу, но день считается по Алматы.
  order({ orderId: "A", createdAt: "2026-11-18T00:30:00+05:00", totalAmount: 120_000, items: [item("rose", 300, 250), item("chrysanthemum", 100, 450)] as never }),
  order({ orderId: "B", createdAt: "2026-11-18T11:00:00+05:00", totalAmount: 80_000, items: [item("eustoma", 200, 400)] as never }),
  // Вчера: 17.11 23:50 по Алматы.
  order({ orderId: "C", createdAt: "2026-11-17T23:50:00+05:00", totalAmount: 150_000 }),
  // Не продажи и отменённые — мимо: перемещение в наш магазин, объём на город, отмена.
  order({ orderId: "D", createdAt: "2026-11-18T09:00:00+05:00", retail: "almaty", totalAmount: 50_000 }),
  order({ orderId: "E", createdAt: "2026-11-18T09:00:00+05:00", kind: "region", direction: "Астана", totalAmount: 0, items: [item("rose", 5000, 0)] as never }),
  order({ orderId: "F", createdAt: "2026-11-18T09:00:00+05:00", status: "cancelled", totalAmount: 70_000 }),
  // К отгрузке сегодня: готова, роза (осталось 500); офисная (осталось 150); хризантема; неподтверждённая — нет; завтра — нет.
  order({ orderId: "G", deliveryDate: TODAY }),
  order({ orderId: "H", deliveryDate: TODAY, store: "office", items: [item("rose", 200, 200, 50)] as never }),
  order({ orderId: "I", deliveryDate: TODAY, items: [item("chrysanthemum", 300, 200)] as never }),
  order({ orderId: "J", deliveryDate: TODAY, managerConfirmed: false }),
  order({ orderId: "K", deliveryDate: "2026-11-19" }),
  // Со склада города — своей строкой.
  order({ orderId: "L", deliveryDate: TODAY, store: "karaganda", items: [item("rose", 60, 200)] as never }),
];

const input: OwnerDayInput = {
  today: TODAY,
  pacePercent: 60,
  orders,
  managers: [
    manager({ managerEmail: "ilyas@x.kz", name: "Ильяс", amountMonth: 3_000_000, amountToday: 120_000, ordersToday: 1, targetAmount: 4_000_000 }),
    manager({ managerEmail: "emil@x.kz", name: "Эмиль", amountMonth: 5_000_000, amountToday: 0, ordersToday: 0, targetAmount: 12_000_000 }),
    manager({ managerEmail: "ilgar@x.kz", name: "Ильгар", amountMonth: 1_000_000, amountToday: 80_000, ordersToday: 1 }),
  ],
  totals: { amountMonth: 3_600_000, targetAmount: 6_000_000 },
  payments: [
    payment({ paymentId: "1", amount: 100_000, farm: "rose_farm" }),
    payment({ paymentId: "2", amount: 40_000, farm: "esentai" }),
    payment({ paymentId: "3", amount: 10_000, farm: "" }),
    payment({ paymentId: "4", amount: 70_000, date: "2026-11-17" }),
    payment({ paymentId: "5", amount: 500_000, date: "2026-11-03" }),
    payment({ paymentId: "6", amount: 900_000, date: "2026-10-30" }),
    // Платёж «из будущего» в месяц не идёт.
    payment({ paymentId: "7", amount: 1, date: "2026-11-25" }),
  ],
  debts: { total: 900_000, overdue: 500_000 },
  calls: [
    { clientName: "Магнолия", debt: 300_000, overdue: true, days: 20 },
    { clientName: "магнолия ", debt: 100_000, overdue: false, days: 3 },
    { clientName: "Флора", debt: 350_000, overdue: false, days: 5 },
    { clientName: "Тюльпан", debt: 200_000, overdue: true, days: 9 },
    { clientName: "Оплачено", debt: 0, overdue: false, days: 0 },
  ],
  shipments: [
    { orderId: "X1", quantity: 400, createdAt: "2026-11-18T06:00:00+05:00" },
    { orderId: "X1", quantity: 100, createdAt: "2026-11-18T06:00:00+05:00" },
    { orderId: "X2", quantity: 250, createdAt: "2026-11-18T10:00:00+05:00" },
    // Возврат сегодня уменьшает отгруженное, но заявкой не считается.
    { orderId: "X3", quantity: -50, createdAt: "2026-11-18T12:00:00+05:00" },
    { orderId: "X4", quantity: 900, createdAt: "2026-11-17T12:00:00+05:00" },
  ],
  writeoffs: [
    { quantity: 30, createdAt: "2026-11-18T08:00:00+05:00" },
    { quantity: 20, createdAt: "2026-11-18T09:00:00+05:00" },
    { quantity: 500, createdAt: "2026-11-17T09:00:00+05:00" },
  ],
  batches: [
    { receivedAt: "2026-11-18T07:00:00+05:00", quantityIn: 2000, store: "" },
    { receivedAt: "2026-11-18", quantityIn: 500, store: "" },
    // Отрезок для офиса и склада города — приход ноль, в приёмку не идёт; вчерашняя приёмка — тоже.
    { receivedAt: "2026-11-18T07:00:00+05:00", quantityIn: 0, store: "office" },
    { receivedAt: "2026-11-18T07:00:00+05:00", quantityIn: 300, store: "astana" },
    { receivedAt: "2026-11-17T07:00:00+05:00", quantityIn: 9000, store: "" },
    { receivedAt: "мусор", quantityIn: 7000, store: "" },
  ],
  nameByEmail: new Map([["ilyas@x.kz", "Ильяс А."]]),
  toDay,
};

const day = buildOwnerDay(input);

check("продано сегодня: сумма, заявок, стеблей — без не-продаж и отменённых", [day.sold.amount, day.sold.orders, day.sold.stems], [200_000, 2, 600]);
check("сегодня по цветам — в порядке роза, хризантема, эустома", day.sold.byFlower.map((f) => [f.flowerType, f.stems, f.amount]), [["rose", 300, 75_000], ["chrysanthemum", 100, 45_000], ["eustoma", 200, 80_000]]);
check("вчера — по дню Алматы", [day.sold.yesterdayAmount, day.sold.yesterdayOrders], [150_000, 1]);
check("обычный день месяца — без сегодняшнего: (3,6 млн − 200 тыс) / 17 дней", day.sold.avgDay, 200_000);
check("первого числа обычного дня ещё нет", buildOwnerDay({ ...input, today: "2026-11-01" }).sold.avgDay, 0);

check("получено сегодня, вчера и за месяц (по дню поступления)", [day.received.today, day.received.yesterday, day.received.month], [150_000, 70_000, 720_000]);
check("получено по компаниям", day.received.byFarm.map((f) => [f.label, f.amount]), [["Rose Farm", 100_000], ["Есентай Агро Хим", 40_000], ["без компании", 10_000]]);

check("долг и просрочка — как в «Оплатах»", [day.debts.total, day.debts.overdue], [900_000, 500_000]);
check("заявок с долгом, из них просрочено, клиентов", [day.debts.openOrders, day.debts.overdueOrders, day.debts.clients], [4, 2, 3]);
check("должники: один клиент — одна строка, просроченные первыми", day.debts.top.map((d) => [d.clientName, d.debt, d.overdue, d.orders, d.days]), [
  ["Магнолия", 400_000, 300_000, 2, 20],
  ["Тюльпан", 200_000, 200_000, 1, 9],
  ["Флора", 350_000, 0, 1, 5],
]);
check("на главной не больше шести должников", buildOwnerDay({ ...input, calls: Array.from({ length: 9 }, (_, i) => ({ clientName: `К${i}`, debt: 1000 + i, overdue: false, days: 1 })) }).debts.top.length, 6);

check("месяц к плану", [day.month.amount, day.month.target, day.month.percent, day.month.tone], [3_600_000, 6_000_000, 60, "good"]);
check("плана нет — процента и цвета нет", (() => { const d = buildOwnerDay({ ...input, totals: { amountMonth: 5, targetAmount: 0 } }); return [d.month.percent, d.month.tone]; })(), [null, "none"]);
check("темп: выше — хорошо, чуть ниже — внимание, сильно ниже — плохо, без плана — без цвета", [managerTone(61, 60), managerTone(50, 60), managerTone(40, 60), managerTone(null, 60)], ["good", "warn", "bad", "none"]);

check("менеджеры: сначала кто продал сегодня, потом по месяцу; имя — из сотрудников", day.managers.map((m) => [m.name, m.todayAmount, m.todayOrders, m.monthAmount, m.percent === null ? null : Math.round(m.percent), m.tone]), [
  ["Ильяс А.", 120_000, 1, 3_000_000, 75, "good"],
  ["Ильгар", 80_000, 1, 1_000_000, null, "none"],
  ["Эмиль", 0, 0, 5_000_000, 42, "bad"],
]);

check("строка без имени менеджера подписана", buildOwnerDay({ ...input, managers: [manager({ managerEmail: "", amountMonth: 5 }), manager({ managerEmail: "gone@x.kz", amountMonth: 4 })] }).managers.map((m) => m.name), ["без менеджера", "gone@x.kz"]);
check("склад: принято сегодня — только настоящая приёмка основного склада", day.warehouse.received, 2500);
check("склад: отгружено сегодня с учётом возврата, заявок", [day.warehouse.shipped, day.warehouse.shippedOrders], [700, 2]);
check("склад: списано сегодня", day.warehouse.writtenOff, 50);
check("склад: осталось отгрузить сегодня — только готовые, по складам", [day.warehouse.toShipOrders, day.warehouse.toShipStems, day.warehouse.toShip], [
  4,
  1010,
  [
    { label: "Rose Farm", orders: 1, stems: 500 },
    { label: "Есентай Агро Хим", orders: 1, stems: 300 },
    { label: "Офис", orders: 1, stems: 150 },
    { label: "Караганда", orders: 1, stems: 60 },
  ],
]);

const empty = buildOwnerDay({ ...input, orders: [], managers: [], payments: [], calls: [], shipments: [], writeoffs: [], batches: [], totals: { amountMonth: 0, targetAmount: 0 }, debts: { total: 0, overdue: 0 } });
check("пустая база не роняет расчёт", [empty.sold.amount, empty.received.today, empty.debts.top.length, empty.warehouse.shipped, empty.warehouse.toShip.length, empty.managers.length], [0, 0, 0, 0, 0, 0]);

if (fails > 0) {
  console.error(`\nПровалено проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
