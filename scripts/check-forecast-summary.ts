/*
 * Проверка аналитики загруженного прогноза срезки.
 *
 * Страница агронома больше не форма, а отчёт: что вырастет, каких сортов, какой
 * ростовки и сколько в этом высшей категории и ликвида. Ошибиться здесь легко
 * тихо — например посчитать долю от чужого итога или сложить недели соседнего
 * месяца, — поэтому цифры проверяются на выдуманном прогнозе, где ответы
 * известны заранее.
 *
 * Запуск: npx tsx scripts/check-forecast-summary.ts
 */
import { buildForecastSummary } from "../src/lib/forecastSummary";
import { weeksOfMonth } from "../src/lib/constants";

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

const MONTH = "2026-09";
const weeks = weeksOfMonth(MONTH);
const w1 = weeks[0].code;
const w2 = weeks[1].code;

const summary = buildForecastSummary({
  month: MONTH,
  weeks,
  flowerTypes: ["rose", "chrysanthemum", "eustoma"],
  varieties: [
    { period: w1, flowerType: "rose", variety: "Prestige", targetStems: 6000 },
    { period: w2, flowerType: "rose", variety: "Prestige", targetStems: 4000 },
    { period: w1, flowerType: "rose", variety: "Avalanche", targetStems: 2000 },
    // Ноль не должен создавать строку.
    { period: w1, flowerType: "rose", variety: "Red Naomi", targetStems: 0 },
    // Неделя чужого месяца в расчёт не идёт.
    { period: "2026-08-W1", flowerType: "rose", variety: "Prestige", targetStems: 9999 },
    { period: w1, flowerType: "chrysanthemum", variety: "Altaj", targetStems: 5000 },
  ],
  mix: [
    // Роза: 12 000 всего, из них 80 см и 90 см — высшая (2 000), первый сорт по
    // длинам — ликвид (10 000), мини-микс и второй сорт в ликвид не входят.
    { period: w1, flowerType: "rose", grade: "60", targetStems: 5000 },
    { period: w2, flowerType: "rose", grade: "60", targetStems: 3000 },
    { period: w1, flowerType: "rose", grade: "40", targetStems: 2000 },
    { period: w1, flowerType: "rose", grade: "80", targetStems: 1500 },
    { period: w1, flowerType: "rose", grade: "90", targetStems: 500 },
    // 70 см высшей больше не считается — проверяем это отдельно ниже.
    { period: w1, flowerType: "rose", grade: "Мини-микс", targetStems: 1000 },
    { period: w1, flowerType: "chrysanthemum", grade: "Высшая", targetStems: 1000 },
    { period: w1, flowerType: "chrysanthemum", grade: "Третья", targetStems: 3000 },
  ],
});

const rose = summary.flowers.find((f) => f.flowerType === "rose")!;
const chrysanthemum = summary.flowers.find((f) => f.flowerType === "chrysanthemum")!;
const eustoma = summary.flowers.find((f) => f.flowerType === "eustoma")!;

// --- Итоги -------------------------------------------------------------------
check("роза: всего по сортам", rose.total, 12_000);
check("роза: по неделям", [rose.byWeek[w1], rose.byWeek[w2]], [8000, 4000]);
check("чужой месяц не попал", Object.values(rose.byWeek).reduce((s, v) => s + v, 0), 12_000);
check("ноль не создаёт строку", rose.varieties.map((v) => v.label), ["Prestige", "Avalanche"]);
check("сорта отсортированы по объёму", rose.varieties[0].label, "Prestige");
check("доля сорта считается от своего цветка", Math.round(rose.varieties[0].share), 83);
check(
  "сумма долей сортов — сто процентов",
  Math.round(rose.varieties.reduce((s, v) => s + v.share, 0)),
  100
);

// --- Ростовка ----------------------------------------------------------------
check("роза: всего по ростовке", rose.mixTotal, 13_000);
check("расхождение двух таблиц видно", rose.mismatch, 1000);
check(
  "ростовка в естественном порядке",
  rose.grades.map((g) => g.label),
  ["40", "60", "80", "90", "Мини-микс"]
);
check("высшая категория: 80 и 90", rose.topStems, 2000);
check("роза 70 см в высшую не входит", rose.grades.every((g) => g.label !== "70"), true);
check("доля высшей считается от ростовки", Math.round(rose.topPercent!), 15);
check("ликвид: первый сорт по длинам", rose.liquidStems, 5000 + 3000 + 2000 + 1500 + 500);
check("мини-микс в ликвид не входит", rose.grades.find((g) => g.label === "Мини-микс")?.liquid, false);
check("доля ликвида", Math.round(rose.liquidPercent!), 92);

// --- Хризантема --------------------------------------------------------------
check("хризантема: всего", chrysanthemum.total, 5000);
check("хризантема: высшая", chrysanthemum.topStems, 1000);
check("хризантема: третья не ликвид", chrysanthemum.liquidStems, 1000);
check(
  "хризантема: доля ликвида от своей ростовки",
  Math.round(chrysanthemum.liquidPercent!),
  25
);

// --- Пустое ------------------------------------------------------------------
check("эустома без данных: ноль", [eustoma.total, eustoma.mixTotal], [0, 0]);
check("эустома без данных: доли не выдуманы", [eustoma.topPercent, eustoma.liquidPercent], [null, null]);
check("итог по хозяйству", summary.totalStems, 13_000 + 5000);
check("не пусто, раз есть цифры", summary.empty, false);

const empty = buildForecastSummary({
  month: MONTH,
  weeks,
  flowerTypes: ["rose"],
  varieties: [],
  mix: [],
});
check("пустой прогноз помечен пустым", empty.empty, true);
check("пустой прогноз не делит на ноль", empty.flowers[0].topPercent, null);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
