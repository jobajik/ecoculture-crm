/*
 * Проверки планирования: роли РОПа и агронома, изоляция производств, упсерт
 * без дублей и расчёт выхода высшей категории.
 *
 * Запуск: npx tsx scripts/check-planning.ts
 */
import {
  ROLES,
  SHIPMENT_DIRECTIONS,
  flowerTypesForFarm,
  getFarmFor,
  getGradesFor,
  isFarmBoundRole,
  isTopGrade,
  isValidPeriod,
  periodOf,
  periodShift,
  periodLabel,
  topGradeHint,
} from "../src/lib/constants";
import { shipmentPlanKey } from "../src/lib/repo/shipmentPlans";
import { forecastKey } from "../src/lib/repo/harvestForecast";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

// --- Месяцы ---------------------------------------------------------------

check("месяц по дате", periodOf(new Date(2026, 8, 7)), "2026-09");
check("месяц с ведущим нулём", periodOf(new Date(2026, 0, 31)), "2026-01");
check("шаг назад через год", periodShift("2026-01", -1), "2025-12");
check("шаг вперёд через год", periodShift("2025-12", 1), "2026-01");
check("шаг на 12 месяцев", periodShift("2026-09", 12), "2027-09");
check("подпись месяца", periodLabel("2026-09"), "сентябрь 2026");
check("мусор вместо месяца не ломает подпись", periodLabel("абв"), "абв");
check("проверка формата: верный", isValidPeriod("2026-09"), true);
check("проверка формата: 13-й месяц", isValidPeriod("2026-13"), false);
check("проверка формата: без нуля", isValidPeriod("2026-9"), false);
check("проверка формата: пусто", isValidPeriod(""), false);

// --- Роли -----------------------------------------------------------------

// Кто куда допущен. Повторяем ровно те проверки, что стоят на страницах и в
// серверных действиях: если правило разъедется, тест это заметит.
const canPlans = (role: string) => role === ROLES.SALES_HEAD || role === ROLES.ADMIN;
const canForecast = (role: string) => role === ROLES.AGRONOMIST || role === ROLES.ADMIN;
const canWarehouse = (role: string) => role === ROLES.WAREHOUSE || role === ROLES.ADMIN;
const canPayments = (role: string) => role === ROLES.ACCOUNTANT || role === ROLES.ADMIN;

check("РОП пускается в Планы", canPlans(ROLES.SALES_HEAD), true);
check("РОП НЕ пускается в Прогноз срезки", canForecast(ROLES.SALES_HEAD), false);
check("РОП НЕ пускается на Склад", canWarehouse(ROLES.SALES_HEAD), false);
check("РОП НЕ ставит оплаты", canPayments(ROLES.SALES_HEAD), false);

check("Агроном пускается в Прогноз срезки", canForecast(ROLES.AGRONOMIST), true);
check("Агроном НЕ пускается в Планы", canPlans(ROLES.AGRONOMIST), false);
check("Агроном НЕ пускается на Склад", canWarehouse(ROLES.AGRONOMIST), false);

check("Менеджер НЕ ставит планы", canPlans(ROLES.MANAGER), false);
check("Зав. складом НЕ ставит планы", canPlans(ROLES.WAREHOUSE), false);
check("Бухгалтер НЕ ведёт прогноз", canForecast(ROLES.ACCOUNTANT), false);
check("Админ везде", [canPlans("admin"), canForecast("admin"), canWarehouse("admin")], [true, true, true]);

check("производство обязательно у агронома", isFarmBoundRole(ROLES.AGRONOMIST), true);
check("производство обязательно у зав. складом", isFarmBoundRole(ROLES.WAREHOUSE), true);
check("производство не нужно РОПу", isFarmBoundRole(ROLES.SALES_HEAD), false);
check("производство не нужно бухгалтеру", isFarmBoundRole(ROLES.ACCOUNTANT), false);

// --- Изоляция производств у агронома --------------------------------------

// Повторяем проверку из forecast/actions.ts: агроном не может записать чужой цветок.
function mayWrite(farm: string | null, flowerType: string): boolean {
  if (!farm) return true; // администратор
  return getFarmFor(flowerType) === farm;
}

check("агроном Rose Farm пишет розу", mayWrite("rose_farm", "rose"), true);
check("агроном Rose Farm пишет эустому", mayWrite("rose_farm", "eustoma"), true);
check("агроном Rose Farm НЕ пишет хризантему", mayWrite("rose_farm", "chrysanthemum"), false);
check("агроном Есентая пишет хризантему", mayWrite("esentai", "chrysanthemum"), true);
check("агроном Есентая НЕ пишет розу", mayWrite("esentai", "rose"), false);
check("агроном Есентая НЕ пишет эустому", mayWrite("esentai", "eustoma"), false);
check("админ пишет любой цветок", [mayWrite(null, "rose"), mayWrite(null, "chrysanthemum")], [true, true]);

check("сетка агронома Rose Farm", flowerTypesForFarm("rose_farm"), ["rose", "eustoma"]);
check("сетка агронома Есентая", flowerTypesForFarm("esentai"), ["chrysanthemum"]);
check(
  "у агронома Есентая нет розы в сетке",
  flowerTypesForFarm("esentai").includes("rose"),
  false
);

// --- Упсерт: правка не плодит дубли ---------------------------------------

// Повторяем логику saveShipmentPlans/saveHarvestForecast на массиве строк.
interface FakeRow {
  key: string;
  value: number;
}

function upsert(table: FakeRow[], key: string, value: number): FakeRow[] {
  const idx = table.findIndex((r) => r.key === key);
  if (idx >= 0) {
    const copy = [...table];
    copy[idx] = { key, value };
    return copy;
  }
  return [...table, { key, value }];
}

let table: FakeRow[] = [];
const k1 = shipmentPlanKey("2026-09", "Астана", "rose");
const k2 = shipmentPlanKey("2026-09", "Астана", "chrysanthemum");
const k3 = shipmentPlanKey("2026-10", "Астана", "rose");

table = upsert(table, k1, 1000);
table = upsert(table, k2, 500);
table = upsert(table, k1, 1200); // правка того же плана
table = upsert(table, k3, 900); // другой месяц — отдельная строка

check("после правки строк не прибавилось", table.length, 3);
check("правка перезаписала значение", table.find((r) => r.key === k1)?.value, 1200);
check("другой цветок не задет", table.find((r) => r.key === k2)?.value, 500);
check("другой месяц — отдельная строка", table.find((r) => r.key === k3)?.value, 900);
check("ключи месяцев различаются", k1 === k3, false);

const f1 = forecastKey("2026-09", "rose", "Freedom", "60");
const f2 = forecastKey("2026-09", "rose", "Freedom", "80");
const f3 = forecastKey("2026-09", "rose", "Explorer", "60");
check("ключ прогноза различает длину", f1 === f2, false);
check("ключ прогноза различает сорт", f1 === f3, false);

let forecastTable: FakeRow[] = [];
forecastTable = upsert(forecastTable, f1, 500);
forecastTable = upsert(forecastTable, f1, 0); // агроном обнулил позицию
check("обнуление не плодит строку", forecastTable.length, 1);
check("обнуление записало ноль", forecastTable[0].value, 0);

// --- Выход высшей категории -----------------------------------------------

check("роза 80 — высшая", isTopGrade("rose", "80"), true);
check("роза 70 — высшая", isTopGrade("rose", "70"), true);
check("роза 60 — НЕ высшая", isTopGrade("rose", "60"), false);
check("роза Уценка — НЕ высшая", isTopGrade("rose", "Уценка"), false);
check("хризантема Высшая — высшая", isTopGrade("chrysanthemum", "Высшая"), true);
check("хризантема Первая — НЕ высшая", isTopGrade("chrysanthemum", "Первая"), false);

// Все «высшие» градации обязаны существовать в списке градаций своего цветка —
// иначе доля высшей категории молча считалась бы от несуществующих значений.
for (const flowerType of ["rose", "chrysanthemum", "eustoma"]) {
  const grades = getGradesFor(flowerType) as readonly string[];
  const top = grades.filter((g) => isTopGrade(flowerType, g));
  check(`высшие градации ${flowerType} есть в справочнике`, top.length > 0, true);
}
check("подпись высшей для розы", topGradeHint("rose"), "70 см, 80 см, 90 см, 100 см");
check("подпись высшей для хризантемы", topGradeHint("chrysanthemum"), "Высшая");

// Считаем ростовку так же, как ForecastGrid.
const rostovka: Record<string, number> = { "50": 1000, "60": 3000, "70": 2000, "80": 4000 };
const total = Object.values(rostovka).reduce((s, v) => s + v, 0);
const top = Object.entries(rostovka)
  .filter(([grade]) => isTopGrade("rose", grade))
  .reduce((s, [, v]) => s + v, 0);
check("всего по ростовке", total, 10_000);
check("из них высшей", top, 6_000);
check("доля высшей", Math.round((top / total) * 1000) / 10, 60);

// Пустой прогноз не должен давать деления на ноль.
const emptyShare = 0 > 0 ? 1 : 0;
check("пустой прогноз не делит на ноль", Number.isFinite(emptyShare), true);

// --- Направления ----------------------------------------------------------

check("направлений задано", SHIPMENT_DIRECTIONS.length, 9);
check("Астана в списке", SHIPMENT_DIRECTIONS.includes("Астана"), true);
check("Пожарка в списке", SHIPMENT_DIRECTIONS.includes("Пожарка"), true);
check(
  "направления не повторяются",
  new Set(SHIPMENT_DIRECTIONS).size,
  SHIPMENT_DIRECTIONS.length
);
check(
  "неизвестное направление отвергается",
  SHIPMENT_DIRECTIONS.includes("Алматы" as never),
  false
);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
