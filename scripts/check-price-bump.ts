/*
 * Прайс разом на сумму (23.11.2026, владелец: «подними прайс на розы на 10 тенге на все виды и ростовки, эустому
 * стандартную — на 100»). Стережём обе стороны: пропустим строку сорта — он останется на старой цене и перебьёт
 * поднятую общую; тронем лишнее — у позиции без цены появится цена 10 ₸, сдвинется другая длина или чужой цветок.
 *
 * Запуск: npx tsx scripts/check-price-bump.ts
 */
import { currentPrices, priceFor, type PriceRow } from "../src/lib/priceList";
import { planPriceBump } from "../src/lib/priceBump";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const R = (flowerType: string, variety: string, grade: string, price: number, date = "2026-11-01"): PriceRow => ({ date, flowerType, variety, grade, price });
const rows = [
  R("rose", "", "40", 170), R("rose", "", "60", 235), R("rose", "", "Мини-микс", 60), R("rose", "", "2 сорт 40", 90),
  R("rose", "Red Naomi", "60", 410), R("rose", "Catalina", "60", 800), R("rose", "", "100", 0),
  R("rose", "", "60", 220, "2026-10-01"),
  R("eustoma", "", "Стандарт", 570), R("eustoma", "", "50", 400), R("eustoma", "Alissa White", "Стандарт", 630), R("eustoma", "", "Мини-микс", 150),
  R("chrysanthemum", "", "Третья", 180), R("chrysanthemum", "Altaj", "Третья", 195),
];
const prices = currentPrices(rows, "2026-11-23");
const plan = planPriceBump(prices, [{ flowerType: "rose", delta: 10 }, { flowerType: "eustoma", grade: "Стандарт", delta: 100 }]);
if (typeof plan === "string") throw new Error(plan);
const of = (v: string, g: string, f = "rose") => plan.lines.find((l) => l.flowerType === f && l.variety === v && l.grade === g);

check("роза: все длины и виды, общие и по сортам", plan.lines.filter((l) => l.flowerType === "rose").map((l) => `${l.variety || "все"}·${l.grade}:${l.before}→${l.after}`).sort(), ["Catalina·60:800→810", "Red Naomi·60:410→420", "все·2 сорт 40:90→100", "все·40:170→180", "все·60:235→245", "все·Мини-микс:60→70"].sort());
check("берётся действующая цена, а не старая строка истории", of("", "60")?.before, 235);
check("позиция без цены не трогается", of("", "100"), undefined);
check("эустома: только Стандарт — общая и сорт", plan.lines.filter((l) => l.flowerType === "eustoma").map((l) => `${l.variety || "все"}·${l.grade}:${l.after}`), ["все·Стандарт:670", "Alissa White·Стандарт:730"]);
check("эустома 50 см и мини-микс не тронуты", [of("", "50", "eustoma"), of("", "Мини-микс", "eustoma")], [undefined, undefined]);
check("хризантема не тронута", plan.lines.some((l) => l.flowerType === "chrysanthemum"), false);
check("пустых правил нет", plan.empty, []);

// после записи сорт со своей ценой по-прежнему перебивает общую, и обе выросли
const after = currentPrices([...rows, ...plan.lines.map((l) => R(l.flowerType, l.variety, l.grade, l.after, "2026-11-23"))], "2026-11-23");
check("после: общая роза 60 — 245, Red Naomi — 420, неизвестный сорт — общая", [priceFor(after, "rose", "Jana", "60"), priceFor(after, "rose", "Red Naomi", "60"), priceFor(after, "rose", "Новый", "40")], [245, 420, 180]);
check("после: эустома Стандарт 670 / Alissa White 730 / 50 см как было", [priceFor(after, "eustoma", "Corelli Pink", "Стандарт"), priceFor(after, "eustoma", "Alissa White", "Стандарт"), priceFor(after, "eustoma", "Corelli Pink", "50")], [670, 730, 400]);
check("вчера цены прежние (история цела)", priceFor(currentPrices([...rows, ...plan.lines.map((l) => R(l.flowerType, l.variety, l.grade, l.after, "2026-11-23"))], "2026-11-22"), "rose", "Jana", "60"), 235);

console.log("\n— Отказы —");
check("правило без суммы", typeof planPriceBump(prices, [{ flowerType: "rose", delta: 0 }]), "string");
check("цена ушла бы в ноль", typeof planPriceBump(prices, [{ flowerType: "rose", delta: -60 }]), "string");
check("пересечение правил", typeof planPriceBump(prices, [{ flowerType: "rose", delta: 10 }, { flowerType: "rose", grade: "60", delta: 5 }]), "string");
const none = planPriceBump(prices, [{ flowerType: "eustoma", grade: "Стандартная", delta: 100 }]);
check("длины нет в прайсе — правило названо пустым, а не молча пропущено", typeof none === "string" ? none : none.empty.length, 1);
// взятые цены хризантемы Rose Farm (у Есентая) не пишутся отдельными строками
const borrowed = planPriceBump(prices, [{ flowerType: "chrysanthemum_rf", delta: 10 }]);
check("взятые у другого цветка цены не пишутся", typeof borrowed === "string" ? borrowed : [borrowed.lines.length, borrowed.empty.length], [0, 1]);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
