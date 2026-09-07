/*
 * Проверки баланса «прогноз срезки против плана отгрузок» и распределения
 * остатка. Главное, за чем следим, — целостность сумм: сколько стеблей взяли,
 * столько и разложили, ни одного не потеряли и не выдумали.
 *
 * Запуск: npx tsx scripts/check-balance.ts
 */
import {
  DIRECTION_GROUPS,
  SHIPMENT_DIRECTIONS,
  groupOfDirection,
  isKnownDirection,
} from "../src/lib/constants";
import {
  buildFlowerBalance,
  distributeSurplus,
  splitStems,
  targetsFor,
  trimToForecast,
  type DirectionPlan,
} from "../src/lib/planBalance";

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

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

// --- Блоки направлений ----------------------------------------------------

check("блоков задано", DIRECTION_GROUPS.length, 4);
check(
  "все направления входят ровно в один блок",
  SHIPMENT_DIRECTIONS.every(
    (d) => DIRECTION_GROUPS.filter((g) => (g.directions as readonly string[]).includes(d)).length === 1
  ),
  true
);
check(
  "в блоках нет направлений вне общего списка",
  DIRECTION_GROUPS.flatMap((g) => [...g.directions]).every((d) => isKnownDirection(d)),
  true
);
check("направлений всего", SHIPMENT_DIRECTIONS.length, 9);
check("Астана — регионы", groupOfDirection("Астана")?.key, "regions");
check("Усть-Каменогорск — регионы", groupOfDirection("Усть-Каменогорск")?.key, "regions");
check("Киргизия — экспорт", groupOfDirection("Киргизия")?.key, "export");
check("РФ — экспорт", groupOfDirection("РФ")?.key, "export");
check("Пожарка — свой блок", groupOfDirection("Пожарка")?.key, "fire");
check("Магазины-ритейл — прочее", groupOfDirection("Магазины-ритейл")?.key, "retail");
check("неизвестное направление без блока", groupOfDirection("Алматы"), null);
check("targetsFor(regions)", targetsFor("regions"), [
  "Астана",
  "Караганда",
  "Семей",
  "Усть-Каменогорск",
]);
check("targetsFor(null) — все", targetsFor(null).length, 9);
check("targetsFor(мусор) — пусто", targetsFor("нет-такого"), []);

// --- Деление стеблей ------------------------------------------------------

const three = ["Астана", "Караганда", "Семей"];

let split = splitStems(100, three, {}, "equal");
check("поровну: сумма сходится", sum(split), 100);
check("поровну: 100 на троих", [split["Астана"], split["Караганда"], split["Семей"]], [34, 33, 33]);

split = splitStems(10, three, { Астана: 5000, Караганда: 3000, Семей: 2000 }, "proportional");
check("пропорционально: сумма сходится", sum(split), 10);
check("пропорционально 5:3:2", [split["Астана"], split["Караганда"], split["Семей"]], [5, 3, 2]);

split = splitStems(7, three, { Астана: 1, Караганда: 1, Семей: 1 }, "proportional");
check("остаток от округления не теряется", sum(split), 7);

// Все веса нулевые — пропорции нет, обязаны свалиться на «поровну»,
// иначе остаток просто исчез бы.
split = splitStems(9, three, { Астана: 0, Караганда: 0, Семей: 0 }, "proportional");
check("нулевые веса: делим поровну", sum(split), 9);
check("нулевые веса: по три", [split["Астана"], split["Караганда"], split["Семей"]], [3, 3, 3]);

check("ноль стеблей — ничего не раскладываем", sum(splitStems(0, three, {}, "equal")), 0);
check("отрицательный остаток игнорируется", sum(splitStems(-5, three, {}, "equal")), 0);
check("пустой список целей", splitStems(100, [], {}, "equal"), {});
check("одно направление забирает всё", splitStems(1234, ["РФ"], {}, "equal")["РФ"], 1234);

// Большое число с некрасивой пропорцией — самый частый источник расхождений.
const messy = splitStems(1_000_003, three, { Астана: 7, Караганда: 11, Семей: 13 }, "proportional");
check("большая сумма сходится", sum(messy), 1_000_003);
check("большая сумма: без дробей", Object.values(messy).every(Number.isInteger), true);

// --- Баланс по цветку -----------------------------------------------------

const plan: Record<string, DirectionPlan> = {
  Астана: { direction: "Астана", stems: 5000, amount: 2_500_000 },
  Караганда: { direction: "Караганда", stems: 3000, amount: 1_350_000 },
  Киргизия: { direction: "Киргизия", stems: 2000, amount: 1_000_000 },
};

const balance = buildFlowerBalance(
  "rose",
  { "60": 8000, "80": 4000, Уценка: 1000 },
  plan
);
check("прогноз всего", balance.forecastStems, 13_000);
check("из них высшей (80 см)", balance.forecastTopStems, 4_000);
check("план всего", balance.plannedStems, 10_000);
check("сумма плана", balance.plannedAmount, 4_850_000);
check("остаток", balance.diff, 3_000);

const regions = balance.groups.find((g) => g.key === "regions");
const exportGroup = balance.groups.find((g) => g.key === "export");
check("регионы: стебли", regions?.stems, 8_000);
check("экспорт: стебли", exportGroup?.stems, 2_000);
check("доля регионов", Math.round((regions?.share ?? 0) * 100), 80);
check("доля экспорта", Math.round((exportGroup?.share ?? 0) * 100), 20);
check(
  "сумма долей блоков = 1",
  Math.round(balance.groups.reduce((s, g) => s + g.share, 0) * 1000) / 1000,
  1
);

const emptyBalance = buildFlowerBalance("rose", {}, {});
check("пустой месяц: без деления на ноль", emptyBalance.groups.every((g) => g.share === 0), true);
check("пустой месяц: остаток ноль", emptyBalance.diff, 0);

// --- Распределение остатка ------------------------------------------------

const spread = distributeSurplus(plan, 3000, targetsFor(null), "proportional");
const spreadStems = SHIPMENT_DIRECTIONS.reduce((s, d) => s + spread.next[d].stems, 0);
check("после распределения план = прогнозу", spreadStems, 13_000);
check("разошлось ровно столько, сколько было", spread.distributed, 3_000);
check("Астана получила половину (5000 из 10000)", spread.next["Астана"].stems, 6_500);
check("нетронутое направление осталось нулём", spread.next["Семей"].stems, 0);

// Деньги обязаны ехать за стеблями по цене самого направления: у Астаны
// 500 ₸ за стебель, значит +1500 стеблей это +750 000 ₸.
check("сумма Астаны выросла по своей цене", spread.next["Астана"].amount, 3_250_000);

const onlyRegions = distributeSurplus(plan, 1000, targetsFor("regions"), "equal");
check(
  "в блок «регионы»: экспорт не тронут",
  onlyRegions.next["Киргизия"].stems,
  2_000
);
check(
  "в блок «регионы»: разошлось по четырём",
  targetsFor("regions").reduce((s, d) => s + onlyRegions.next[d].stems, 0),
  8_000 + 1_000
);
check("поровну достаётся и пустым направлениям", onlyRegions.next["Семей"].stems, 250);

// У Семея своей цены нет — берём среднюю по цветку (4 850 000 / 10 000 = 485).
check("пустому направлению — средняя цена", onlyRegions.next["Семей"].amount, 121_250);

check("нулевой остаток ничего не меняет", distributeSurplus(plan, 0, targetsFor(null), "equal").distributed, 0);

// --- Ужатие плана под нехватку --------------------------------------------

const trimmed = trimToForecast(plan, 5000);
const trimmedStems = SHIPMENT_DIRECTIONS.reduce((s, d) => s + trimmed.next[d].stems, 0);
check("после ужатия план = прогнозу", trimmedStems, 5_000);
check("ужали пропорционально: Астана", trimmed.next["Астана"].stems, 2_500);
check("ужали пропорционально: Караганда", trimmed.next["Караганда"].stems, 1_500);
check("ужали пропорционально: Киргизия", trimmed.next["Киргизия"].stems, 1_000);
check("сумма Астаны упала по своей цене", trimmed.next["Астана"].amount, 1_250_000);

const noTrim = trimToForecast(plan, 20_000);
check("прогноза хватает — план не трогаем", noTrim.next["Астана"].stems, 5_000);
check("прогноза хватает — ничего не срезано", noTrim.distributed, 0);

check(
  "ужатие до нуля обнуляет план",
  SHIPMENT_DIRECTIONS.reduce((s, d) => s + trimToForecast(plan, 0).next[d].stems, 0),
  0
);

// Ужатие с некрасивой пропорцией: сумма всё равно обязана сойтись.
const oddPlan: Record<string, DirectionPlan> = {
  Астана: { direction: "Астана", stems: 3331, amount: 999_300 },
  Караганда: { direction: "Караганда", stems: 1777, amount: 533_100 },
  РФ: { direction: "РФ", stems: 911, amount: 273_300 },
};
const oddTrim = trimToForecast(oddPlan, 4321);
check(
  "некрасивое ужатие сходится в ноль",
  SHIPMENT_DIRECTIONS.reduce((s, d) => s + oddTrim.next[d].stems, 0),
  4_321
);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
