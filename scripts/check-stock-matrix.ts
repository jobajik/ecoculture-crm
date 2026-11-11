/** Проверка расчёта «Сорта и ростовки на складе» (`src/lib/stockMatrix.ts`). Запуск: npx tsx scripts/check-stock-matrix.ts */
import { EARLIER, NO_DATE, buildStockMatrix, daysAgo, harvestDayOf } from "../src/lib/stockMatrix";
import type { Batch } from "../src/lib/types";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !extra ? "" : ` — ${extra}`}`);
}
let n = 0;
const b = (flowerType: string, variety: string, grade: string, remaining: number, harvestDate: string, store = ""): Batch =>
  ({ batchId: `b${++n}`, receivedAt: `${harvestDate || "2026-11-01"}T08:00:00`, harvestDate, flowerType, variety, grade, quantityIn: remaining + 10, quantityRemaining: remaining, location: "", receivedByEmail: "", store, sourceBatchId: "" }) as Batch;

const batches = [
  b("rose", "Jumilia", "60", 300, "2026-11-11"),
  b("rose", "Jumilia", "60", 200, "2026-11-09"),
  b("rose", "Jumilia", "70", 100, "2026-11-11"),
  b("rose", "jumilia ", "50", 40, "2026-10-20"),
  b("rose", "Pink Mondial", "60", 0, "2026-11-11"),
  b("rose", "Pink Mondial", "50", 75, "2026-11-10", "office"),
  b("eustoma", "Белая", "70", 60, "2026-11-10"),
  b("chrysanthemum", "Altaj", "Вторая", 500, "2026-11-08"),
  b("chrysanthemum", "Altaj", "Высшая", 120, "2026-11-11"),
  b("chrysanthemum_rf", "Altaj", "Третья", 90, ""),
];
const today = "2026-11-12";

const main = buildStockMatrix({ batches, today });
check("основной склад: офисная партия не считается", main.total === 300 + 200 + 100 + 40 + 60 + 500 + 120 + 90, String(main.total));
check("порядок цветков: роза, хризантема, хризантема RF, эустома", main.flowers.map((f) => f.flowerType).join() === "rose,chrysanthemum,chrysanthemum_rf,eustoma");
const rose = main.flowers[0];
check("сорт склеивается без учёта регистра и пробелов", rose.rows.length === 1 && rose.rows[0].total === 640);
check("ростовки по порядку", rose.grades.join() === "50,60,70", rose.grades.join());
check("сорт × ростовка", rose.rows[0].byGrade["60"] === 500 && rose.rows[0].byGrade["70"] === 100 && rose.rows[0].byGrade["50"] === 40);
check("итоги по ростовкам сходятся", Object.values(rose.gradeTotals).reduce((s, x) => s + x, 0) === rose.total);
check("итоги по дням сходятся", Object.values(rose.dateTotals).reduce((s, x) => s + x, 0) === rose.total);
check("дни срезки — свежие первыми", rose.dates.join() === "2026-11-11,2026-11-09,2026-10-20", rose.dates.join());
check("самая старая и свежая срезка сорта", rose.rows[0].oldest === "2026-10-20" && rose.rows[0].newest === "2026-11-11");
check("строка ростовки по дням", rose.rows[0].lines.find((l) => l.grade === "60")?.byDate["2026-11-09"] === 200);
check("партия с нулём не даёт сорта", !rose.rows.some((r) => r.variety === "Pink Mondial"));
const chr = main.flowers[1];
check("категории хризантемы по порядку", chr.grades[0] === "Высшая", chr.grades.join());
check("без даты срезки и приёмки нет — берём день приёмки", harvestDayOf({ harvestDate: "", receivedAt: "2026-11-01T08:00:00" }) === "2026-11-01");
check("мусор вместо даты — «без даты»", harvestDayOf({ harvestDate: "46274", receivedAt: "" }) === NO_DATE);

const few = buildStockMatrix({ batches, today, maxDates: 1 });
check("старые дни складываются в «раньше»", few.flowers[0].dates.join() === `2026-11-11,${EARLIER}` && few.flowers[0].dateTotals[EARLIER] === 240, JSON.stringify(few.flowers[0].dateTotals));

const day = buildStockMatrix({ batches, today, from: "2026-11-11", to: "2026-11-11" });
check("фильтр по дню срезки", day.total === 300 + 100 + 120, String(day.total));
check("чипы дней — по всему складу, а не по фильтру", day.dates.length === main.dates.length && day.dates[0].date === "2026-11-11" && day.dates[0].quantity === 520);

const office = buildStockMatrix({ batches, today, store: "office" });
check("склад офиса", office.total === 75 && office.flowers[0].rows[0].variety === "Pink Mondial");
const all = buildStockMatrix({ batches, today, store: "all" });
check("все склады", all.total === main.total + 75);

const es = buildStockMatrix({ batches, today, farm: "esentai" });
check("зав. складом Есентая видит только свою хризантему", es.flowers.length === 1 && es.flowers[0].flowerType === "chrysanthemum" && es.total === 620);
const rf = buildStockMatrix({ batches, today, farm: "rose_farm" });
check("Rose Farm — роза, эустома и своя хризантема, без Есентая", !rf.flowers.some((f) => f.flowerType === "chrysanthemum") && rf.flowers.length === 3);

check("возраст срезки", daysAgo("2026-11-11", today) === 1 && daysAgo("2026-11-12", today) === 0 && daysAgo("", today) === 0);
check("пустой склад не роняет расчёт", buildStockMatrix({ batches: [], today }).total === 0);

console.log(failed ? `\nПровалено: ${failed}` : "\nВсё сходится.");
process.exit(failed ? 1 : 0);
