/**
 * Проверка «Продажи → Цветы» (`src/lib/flowerSales.ts`).
 * Запуск: npx tsx scripts/check-flower-sales.ts
 */
import "../src/lib/timezone";
import { buildFlowerSales, POINT_ROW_KEY } from "../src/lib/flowerSales";
import type { OrderWithItems } from "../src/lib/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

type It = [string, string, string, number, number]; // цветок, сорт, ростовка, шт, цена
function order(id: string, createdAt: string, manager: string, items: It[], extra: Record<string, unknown> = {}): OrderWithItems {
  return {
    orderId: id,
    createdAt,
    managerEmail: manager,
    clientId: `C-${id}`,
    clientName: `Клиент ${id}`,
    status: "new",
    direction: "",
    retail: "",
    kind: "",
    items: items.map(([flowerType, variety, grade, quantity, unitPrice], i) => ({
      orderId: id,
      itemId: `${id}-${i}`,
      flowerType,
      variety,
      grade,
      quantity,
      unitPrice,
      shippedQuantity: 0,
    })),
    totalAmount: items.reduce((s, x) => s + x[3] * x[4], 0),
    ...extra,
  } as unknown as OrderWithItems;
}

const orders = [
  // Сентябрь
  order("A", "2026-09-05T10:00:00+05:00", "ilyas@x", [
    ["chrysanthemum", "Балтика", "Третья", 1000, 250],
    ["chrysanthemum", "Балтика", "Первая", 500, 400],
  ]),
  order("B", "2026-09-10T10:00:00+05:00", "emil@x", [
    ["chrysanthemum", "Зембла", "Третья", 300, 290],
    ["rose", "Prestige", "60", 200, 300],
    ["rose", "Prestige", "50", 100, 250],
  ]),
  order("C", "2026-09-12T10:00:00+05:00", "emil@x", [["eustoma", "Розита", "Стандарт", 50, 600]]),
  // Отменённая — не в счёт
  order("D", "2026-09-12T10:00:00+05:00", "ilyas@x", [["chrysanthemum", "Балтика", "Третья", 999, 1]], { status: "cancelled" }),
  // Наш магазин — не продажа
  order("E", "2026-09-12T10:00:00+05:00", "ilyas@x", [["rose", "Prestige", "60", 777, 1]], { retail: "almaty" }),
  // Точка на базаре — отдельной строкой
  order("F", "2026-09-15T10:00:00+05:00", "ilyas@x", [["chrysanthemum", "Балтика", "Третья", 400, 200]], { direction: "Пожарка" }),
  // 30.09 23:30 по Алматы — это сентябрь, хотя по Гринвичу уже нет разницы; 01.10 00:30 по Алматы — октябрь
  order("G", "2026-09-30T23:30:00+05:00", "ilyas@x", [["chrysanthemum", "Балтика", "Вторая", 10, 300]]),
  order("H", "2026-10-01T00:30:00+05:00", "ilyas@x", [["chrysanthemum", "Балтика", "Вторая", 20, 300]]),
  // Август — для сравнения
  order("P", "2026-08-20T10:00:00+05:00", "ilyas@x", [["chrysanthemum", "Балтика", "Третья", 600, 250]]),
];
const names = new Map([
  ["ilyas@x", "Ильяс"],
  ["emil@x", "Эмиль"],
]);

console.log("Все цветы, сентябрь");
const all = buildFlowerSales({ orders, period: "2026-09", flower: null, nameByEmail: names });
check("итог стеблей без отмены, магазина и точки", all.totals.stems === 1000 + 500 + 300 + 200 + 100 + 50 + 10, String(all.totals.stems));
check(
  "итог денег",
  all.totals.amount === 1000 * 250 + 500 * 400 + 300 * 290 + 200 * 300 + 100 * 250 + 50 * 600 + 10 * 300,
  String(all.totals.amount)
);
check("заявок 4 (A, B, C, G)", all.totals.orders === 4, String(all.totals.orders));
check("цветы по порядку: роза, хризантема, эустома", all.byFlower.map((r) => r.key).join(",") === "rose,chrysanthemum,eustoma", all.byFlower.map((r) => r.key).join(","));
const shareSum = all.byFlower.reduce((s, r) => s + r.share, 0);
check("доли цветков дают 100 %", Math.abs(shareSum - 100) < 1e-9, String(shareSum));
check("«50» розы и «Третья» хризантемы — разные строки", all.byGrade.some((r) => r.key === "rose|50") && all.byGrade.some((r) => r.key === "chrysanthemum|Третья"));
check(
  "ростовки идут по порядку цветка: 50 раньше 60, Первая раньше Третьей",
  all.byGrade.findIndex((r) => r.key === "rose|50") < all.byGrade.findIndex((r) => r.key === "rose|60") &&
    all.byGrade.findIndex((r) => r.key === "chrysanthemum|Первая") < all.byGrade.findIndex((r) => r.key === "chrysanthemum|Третья")
);
const third = all.byGrade.find((r) => r.key === "chrysanthemum|Третья")!;
check("Третья: 1300 шт., к августу 600", third.stems === 1300 && third.prevStems === 600, `${third.stems}/${third.prevStems}`);
check("граница месяца по Алматы: 30.09 23:30 — сентябрь", all.byGrade.find((r) => r.key === "chrysanthemum|Вторая")?.stems === 10);
const point = all.byManager.find((r) => r.key === POINT_ROW_KEY);
check("точка на базаре — отдельной строкой для справки", !!point && point.aside === true && point.stems === 400 && point.share === 0);
check("менеджеры: Ильяс 1510, Эмиль 650", all.byManager.find((r) => r.key === "Ильяс")?.stems === 1510 && all.byManager.find((r) => r.key === "Эмиль")?.stems === 650);
check("при всех цветах матрицы нет", all.matrix === null);

console.log("Хризантема, сентябрь");
const ch = buildFlowerSales({ orders, period: "2026-09", flower: "chrysanthemum", nameByEmail: names });
check("итог только по хризантеме", ch.totals.stems === 1810, String(ch.totals.stems));
check("сорта: Балтика 1510, Зембла 300", ch.byVariety[0].label === "Балтика" && ch.byVariety[0].stems === 1510 && ch.byVariety[1].stems === 300);
check("матрица: колонки по порядку категорий", ch.matrix?.grades.join(",") === "Первая,Вторая,Третья", ch.matrix?.grades.join(","));
const ily = ch.matrix?.rows.find((r) => r.key === "Ильяс");
check("матрица: Ильяс Третья 1000, Первая 500", ily?.cells["Третья"] === 1000 && ily?.cells["Первая"] === 500);
check("матрица: итог по Третьей без точки", ch.matrix?.totals["Третья"] === 1300, String(ch.matrix?.totals["Третья"]));
check("матрица: точка последней строкой", ch.matrix?.rows[ch.matrix.rows.length - 1].key === POINT_ROW_KEY);
check("неизвестный цветок = все", buildFlowerSales({ orders, period: "2026-09", flower: "tulip", nameByEmail: names }).flower === null);

console.log("Пустой месяц");
const empty = buildFlowerSales({ orders, period: "2025-01", flower: null, nameByEmail: names });
check("пусто без деления на ноль", empty.totals.stems === 0 && empty.byGrade.length === 0);

if (failed) {
  console.log(`\nПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
