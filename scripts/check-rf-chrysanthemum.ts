/**
 * Хризантема Rose Farm — отдельный товар (03.11.2026, владелец: «есть хриза на розах и есть хриза на Есентае; стоки,
 * ответственные лица и всё остальное тоже должно быть прописано»). Проверяет, что она живёт в Rose Farm (склад, счёт,
 * изоляция), но во всём «как хризантема» (категории, слова, срок хранения, бонус 2 %), прайс без своих цен берёт цены
 * Есентая по категории, а бот берёт склад того хозяйства, где хватает.
 *
 *   npx tsx scripts/check-rf-chrysanthemum.ts
 */
import {
  CHRYSANTHEMUM_GRADES,
  DEFAULT_SHELF_LIFE_DAYS,
  FLOWER_TYPES,
  bonusRateFor,
  baseFlowerType,
  flowerPickLabel,
  flowerTypesForFarm,
  getFarmFor,
  getGradesFor,
  gradeColumnLabel,
  gradeColumnLabelFor,
  isChrysanthemum,
  isLiquidGrade,
  isTopGrade,
} from "../src/lib/constants";
import { currentPrices, priceFor, type PriceRow } from "../src/lib/priceList";
import { invoiceByFarm } from "../src/lib/orderMoney";
import { planBotOrder } from "../src/lib/botOrder";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const RF = FLOWER_TYPES.CHRYSANTHEMUM_RF;
const ES = FLOWER_TYPES.CHRYSANTHEMUM;

// --- Хозяйство -------------------------------------------------------------------------------------------------
check("хризантема Rose Farm — Rose Farm", getFarmFor(RF), "rose_farm");
check("хризантема Есентая — Есентай", getFarmFor(ES), "esentai");
check("склад Rose Farm видит свою хризантему", flowerTypesForFarm("rose_farm").includes(RF), true);
check("склад Есентая хризантему Rose Farm НЕ видит", flowerTypesForFarm("esentai"), [ES]);
check("бонус 2 %, как у хризантемы", bonusRateFor(RF), 0.02);
check("подпись при выборе: Есентай", flowerPickLabel(ES), "Хризантема Есентай");
check("подпись при выборе: Rose Farm", flowerPickLabel(RF), "Хризантема Rose Farm");

// --- Как хризантема ---------------------------------------------------------------------------------------------
check("это хризантема", [isChrysanthemum(RF), isChrysanthemum(ES), isChrysanthemum("rose")], [true, true, false]);
check("базовый цветок", baseFlowerType(RF), ES);
check("категории те же", getGradesFor(RF), CHRYSANTHEMUM_GRADES);
check("колонка — «Категория»", gradeColumnLabel(RF), "Категория");
check("список из двух хризантем — «Категория»", gradeColumnLabelFor([ES, RF]), "Категория");
check("высшая и ликвид как у хризантемы", [isTopGrade(RF, "Высшая"), isLiquidGrade(RF, "Вторая"), isLiquidGrade(RF, "Третья")], [true, true, false]);
check("срок хранения по умолчанию как у хризантемы", DEFAULT_SHELF_LIFE_DAYS[RF], DEFAULT_SHELF_LIFE_DAYS[ES]);

// --- Счёт -------------------------------------------------------------------------------------------------------
const money = invoiceByFarm([
  { flowerType: ES, quantity: 100, unitPrice: 270 },
  { flowerType: RF, quantity: 200, unitPrice: 250 },
  { flowerType: "rose", quantity: 30, unitPrice: 235 },
]);
check(
  "счета: хризантема Rose Farm — в счёт Rose Farm",
  money.map((m) => [m.farm, m.amount]),
  [["rose_farm", 200 * 250 + 30 * 235], ["esentai", 100 * 270]]
);

// --- Прайс: своих цен нет — цены Есентая по категории -----------------------------------------------------------
const row = (flowerType: string, variety: string, grade: string, price: number): PriceRow => ({ date: "2026-11-01", flowerType, variety, grade, price });
const esentai = [row(ES, "", "Первая", 580), row(ES, "Altaj", "Первая", 600), row(ES, "", "Вторая", 400)];
let p = currentPrices(esentai, "2026-11-03");
check("своих цен нет — общая цена Есентая", priceFor(p, RF, "Bacardy", "Первая"), 580);
check("своих цен нет — цена сорта Есентая", priceFor(p, RF, "Altaj", "Первая"), 600);
check("взятая цена помечена", p.get(`${RF}||Первая`)?.borrowedFrom, ES);
check("у Есентая цены свои", priceFor(p, ES, "Altaj", "Первая"), 600);

p = currentPrices([...esentai, row(RF, "", "Первая", 500)], "2026-11-03");
check("своя общая цена на категорию — она и для сорта", priceFor(p, RF, "Altaj", "Первая"), 500);
check("другая категория по-прежнему как у Есентая", priceFor(p, RF, "Altaj", "Вторая"), 400);
check("Есентаю своя цена Rose Farm не мешает", priceFor(p, ES, "Bacardy", "Первая"), 580);

p = currentPrices([...esentai, row(RF, "Altaj", "Первая", 650)], "2026-11-03");
check("своя цена сорта без общей: сорт свой", priceFor(p, RF, "Altaj", "Первая"), 650);
check("своя цена сорта без общей: остальные — общая Есентая", priceFor(p, RF, "Bacardy", "Первая"), 580);

// --- Бот: берёт склад того хозяйства, где хватает ----------------------------------------------------------------
const stock = [
  { flower: ES, variety: "Altaj", grade: "Третья", qty: 100 },
  { flower: RF, variety: "Altaj", grade: "Третья", qty: 500 },
];
const draft = (flowerType: string, quantity: number) => ({
  confirmed: true,
  items: [{ flowerType, variety: "Altaj", grade: "Третья", quantity }],
  deliveryDate: "2026-11-04",
  city: "",
  point: "",
  address: "",
  kaspiPhone: "",
});
const plan = (flowerType: string, quantity: number) =>
  planBotOrder({ draft: draft(flowerType, quantity) as never, stock, priceOf: () => 270, today: "2026-11-03" });
const pick = (x: ReturnType<typeof plan>) => (x.ok ? x.items.map((i) => [i.flowerType, i.quantity]) : x.question);
check("хватает у Есентая — Есентай", pick(plan(ES, 100)), [[ES, 100]]);
check("у Есентая мало, у Rose Farm хватает — Rose Farm", pick(plan(ES, 300)), [[RF, 300]]);
check("нигде не хватает — вопрос про остаток", typeof pick(plan(ES, 900)), "string");

console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе проверки прошли.");
process.exit(failed ? 1 : 0);
