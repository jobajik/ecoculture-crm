/**
 * Проверка приёмки Rose Farm (02.11.2026): строка из браузера проверяется заново (длина из списка цветка, целые
 * стебли, брак с причиной, замер в пределах), повторы дня ловятся, итоги считаются правильно (брак — от пришедшего,
 * средняя длина розы — только первый сорт, вес стебля — взвешенный стеблями дня), хризантема Rose Farm не смешивается
 * с Есентаем, день раскладывается в строки сортов и обратно, вкладки и права.
 *
 * Запуск: npx tsx scripts/check-intake.ts
 */
import {
  byBlock,
  byDay,
  byReason,
  byVariety,
  cleanIntakeRow,
  filterIntake,
  flowersIn,
  gradeLabel,
  gradeShort,
  intakeDay,
  intakeDuplicate,
  intakeGrades,
  intakeInsights,
  intakeStats,
  intakeVariety,
  lastIntakeLines,
  recentVarieties,
  type IntakeClean,
  type IntakeRow,
} from "../src/lib/greenhouse/intake";
import { intakeVarietyList } from "../src/lib/greenhouse/intakeData";
import { planDayRows } from "../src/lib/greenhouse/day";
import { greenhouseScope } from "../src/lib/greenhouse/access";
import { pickGreenhouseFarm } from "../src/lib/greenhouse/farm";
import { greenhouseTabsFor } from "../src/app/greenhouse/tabs";
import { SHEET_HEADERS, SHEET_TABS } from "../src/lib/constants";
import { isPayrollTab } from "../src/lib/sheets";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` — ждали ${JSON.stringify(want)}`}`);
}

const TODAY = "2026-11-02";
const KNOWN = ["Avalanche", "Red Naomi", "Alissa White", "Altaj"];

console.log("--- Справочники");
check("длины розы: основные и 2 сорт", intakeGrades("rose"), ["40", "50", "60", "70", "80", "90", "100", "Мини-микс", "40 (2 сорт)", "50 (2 сорт)", "60 (2 сорт)", "70 (2 сорт)", "B-quality"]);
check("категории хризантемы — без брака и уценки", intakeGrades("chrysanthemum").includes("Брак") || intakeGrades("chrysanthemum").includes("Уценка"), false);
check("подписи колонок", ["60", "50 (2 сорт)", "Высшая", "Мини-микс"].map(gradeShort), ["60", "2с 50", "Высш.", "Мини"]);
check("подписи длин", [gradeLabel("rose", "60"), gradeLabel("rose", "70 (2 сорт)"), gradeLabel("chrysanthemum", "Первая"), gradeLabel("eustoma", "Стандарт")], ["60 см", "2 сорт 70 см", "Первая кат.", "Стандарт"]);
check("сорт в одном написании", [intakeVariety(" avalanche ", KNOWN), intakeVariety("RED  NAOMI", KNOWN), intakeVariety("Новый", KNOWN)], ["Avalanche", "Red Naomi", "Новый"]);
const vl = intakeVarietyList([{ id: "x", farm: "rose_farm", date: TODAY, flower: "rose", block: "", variety: "Explorer", kind: "accept", grade: "60", reason: "", qty: 10, stemG: 0, headCm: 0, buds: 0, note: "" }], { rose: ["Avalanche", "avalanche", "Mix", "Мини-микс кустовые"], eustoma: ["Alissa White"] });
check("сорта приёмки: без мини-микса и Mix, двойники склеены, принятые добавлены", [vl.byFlower.rose, vl.byFlower.eustoma, vl.byFlower.chrysanthemum.includes("Altaj")], [["Avalanche", "Explorer"], ["Alissa White"], true]);

console.log("--- Проверка строки");
const acc = cleanIntakeRow({ flower: "rose", variety: "avalanche", kind: "accept", grade: "60", qty: "1 200", block: "3.0" }, TODAY, TODAY, KNOWN);
check("принято: чистая строка", acc.row && [acc.row.flower, acc.row.variety, acc.row.grade, acc.row.qty, acc.row.block], ["rose", "Avalanche", "60", 1200, "3"]);
check("принято: длина не из списка розы", cleanIntakeRow({ flower: "rose", variety: "Avalanche", kind: "accept", grade: "Первая", qty: 5 }, TODAY, TODAY, KNOWN).error, "Avalanche: не указана длина");
check("принято: дробные стебли", cleanIntakeRow({ flower: "rose", variety: "Avalanche", kind: "accept", grade: "60", qty: "12,5" }, TODAY, TODAY, KNOWN).error, "Avalanche, 60 см: стебли — целое число");
check("принято: ноль", cleanIntakeRow({ flower: "rose", variety: "Avalanche", kind: "accept", grade: "60", qty: "0" }, TODAY, TODAY, KNOWN).error, "Avalanche, 60 см: стеблей больше нуля");
check("день из будущего", cleanIntakeRow({ flower: "rose", variety: "Avalanche", kind: "accept", grade: "60", qty: 1 }, "2026-11-03", TODAY, KNOWN).error, "дата из будущего");
check("без сорта", cleanIntakeRow({ flower: "rose", variety: " ", kind: "accept", grade: "60", qty: 1 }, TODAY, TODAY, KNOWN).error, "не указан сорт");
check("цветок не из списка", cleanIntakeRow({ flower: "tulip", variety: "X", kind: "accept", grade: "60", qty: 1 }, TODAY, TODAY, KNOWN).error, "не указан цветок");
const rej = cleanIntakeRow({ flower: "eustoma", variety: "Alissa White", kind: "reject", reason: "botrytis", qty: "40" }, TODAY, TODAY, KNOWN);
check("брак: чистая строка", rej.row && [rej.row.kind, rej.row.reason, rej.row.qty], ["reject", "botrytis", 40]);
check("брак без причины", cleanIntakeRow({ flower: "eustoma", variety: "Alissa White", kind: "reject", reason: "", qty: "40" }, TODAY, TODAY, KNOWN).error, "брак Alissa White: не указана причина");
const mea = cleanIntakeRow({ flower: "rose", variety: "Avalanche", kind: "measure", stemG: "45", headCm: "5,4" }, TODAY, TODAY, KNOWN);
check("замер: вес и бутон, запятая", mea.row && [mea.row.stemG, mea.row.headCm, mea.row.buds], [45, 5.4, 0]);
check("замер: бутон розы вне пределов", cleanIntakeRow({ flower: "rose", variety: "Avalanche", kind: "measure", headCm: "54" }, TODAY, TODAY, KNOWN).error, "Avalanche: высота бутона — от 1.5 до 10 см");
check("замер: бутон розы — не у хризантемы", cleanIntakeRow({ flower: "chrysanthemum", variety: "Altaj", kind: "measure", headCm: "5" }, TODAY, TODAY, KNOWN).error, "Altaj: у этого цветка так не меряют");
check("замер пустой — не строка и не ошибка", cleanIntakeRow({ flower: "rose", variety: "Avalanche", kind: "measure", stemG: "", headCm: "" }, TODAY, TODAY, KNOWN), { row: null, error: "" });
const c = (x: Partial<IntakeClean>): IntakeClean => ({ id: "", date: TODAY, flower: "rose", block: "", variety: "Avalanche", kind: "accept", grade: "60", reason: "", qty: 10, stemG: 0, headCm: 0, buds: 0, note: "", ...x });
check("повтор клетки ловится", intakeDuplicate([c({}), c({ variety: "avalanche" })]), "avalanche, 60 см: строка дважды — сложите в одну");
check("та же клетка в другом блоке — не повтор", intakeDuplicate([c({ block: "1" }), c({ block: "2" })]), "");
check("два брака одного сорта с разными причинами — можно", intakeDuplicate([c({ kind: "reject", reason: "botrytis" }), c({ kind: "reject", reason: "pests" })]), "");
check("замер дважды ловится", intakeDuplicate([c({ kind: "measure", grade: "", stemG: 40 }), c({ kind: "measure", grade: "", stemG: 41 })]), "Avalanche: характеристики записаны дважды");

console.log("--- Итоги");
let k = 0;
const r = (x: Partial<IntakeRow>): IntakeRow => ({ id: `I${k++}`, farm: "rose_farm", date: TODAY, flower: "rose", block: "", variety: "Avalanche", kind: "accept", grade: "60", reason: "", qty: 0, stemG: 0, headCm: 0, buds: 0, note: "", ...x });
const rows: IntakeRow[] = [
  r({ grade: "60", qty: 600 }),
  r({ grade: "80", qty: 400 }),
  r({ grade: "50 (2 сорт)", qty: 100 }),
  r({ kind: "measure", grade: "", stemG: 40, headCm: 5 }),
  r({ variety: "Red Naomi", grade: "40", qty: 200 }),
  r({ variety: "Red Naomi", kind: "measure", grade: "", stemG: 30 }),
  r({ variety: "Red Naomi", kind: "reject", grade: "", reason: "botrytis", qty: 50 }),
  r({ variety: "Avalanche", kind: "reject", grade: "", reason: "pests", qty: 25 }),
  r({ flower: "chrysanthemum", variety: "Altaj", grade: "Высшая", qty: 300 }),
  r({ flower: "chrysanthemum", variety: "Altaj", grade: "Вторая", qty: 100 }),
  r({ date: "2026-11-01", grade: "70", qty: 500 }),
];
const today = rows.filter((x) => x.date === TODAY);
const rose = intakeStats(today, "rose");
check("роза: принято и брак от пришедшего", [rose.accepted, rose.rejected, Number(rose.rejectPct!.toFixed(2))], [1300, 75, 5.45]);
check("роза: средняя длина — только первый сорт (2 сорт не в счёт)", Number(rose.avgLength!.toFixed(2)), Number(((600 * 60 + 400 * 80 + 200 * 40) / 1200).toFixed(2)));
check("роза: 80+ и 2 сорт — доли от принятого", [Number(rose.topPct!.toFixed(2)), Number(rose.secondPct!.toFixed(2))], [Number(((400 * 100) / 1300).toFixed(2)), Number(((100 * 100) / 1300).toFixed(2))]);
check("роза: вес стебля взвешен стеблями сорта за день", Number(rose.measures.stemG!.toFixed(2)), Number(((40 * 1100 + 30 * 200) / 1300).toFixed(2)));
check("роза: бутон — только где мерили", rose.measures.headCm, 5);
check("роза: порядок длин — шкала, а не количество", rose.byGrade.map((g) => g.grade), ["40", "60", "80", "50 (2 сорт)"]);
const chr = intakeStats(today, "chrysanthemum");
check("хризантема Rose Farm: высшая от принятого, длины нет", [chr.accepted, chr.topPct, chr.avgLength], [400, 75, null]);
check("цветки в записях — по порядку", flowersIn(today), ["rose", "chrysanthemum"]);
const vs = byVariety(today);
check("сорта: доля внутри своего цветка", vs.map((v) => [v.flower, v.variety, v.accepted, Math.round(v.share)]), [["rose", "Avalanche", 1100, 85], ["rose", "Red Naomi", 200, 15], ["chrysanthemum", "Altaj", 400, 100]]);
check("брак по причинам", byReason(today).map((x) => [x.reason, x.qty, Math.round(x.share)]), [["botrytis", 50, 67], ["pests", 25, 33]]);
const days = byDay(rows, "2026-10-31", TODAY);
check("по дням — с пустыми днями", days.map((d) => [d.date, d.accepted, d.rejected]), [["2026-10-31", 0, 0], ["2026-11-01", 500, 0], [TODAY, 1700, 75]]);
check("отбор по цветку и сорту", [filterIntake(rows, { from: TODAY, to: TODAY, flower: "rose" }).length, filterIntake(rows, { from: "2026-11-01", to: TODAY, variety: "Avalanche" }).length], [8, 6]);
check("блоки: без блока — одной строкой в конце", byBlock([r({ block: "2", qty: 10 }), r({ block: "", qty: 5 }), r({ block: "1", qty: 7 })]).map((b) => [b.block, b.accepted]), [["1", 7], ["2", 10], ["", 5]]);
const ins = intakeInsights(today, rows.filter((x) => x.date === "2026-11-01"));
check("выводы: роза стала короче, принято больше", [ins.some((l) => l.startsWith("Роза стала короче")), ins.some((l) => l.startsWith("Роза: принято больше"))], [true, true]);

console.log("--- День в браузере");
const d = intakeDay(rows, TODAY);
check("день: строки сортов с клетками и замером", d.lines.map((l) => [l.flower, l.variety, Object.keys(l.cells), !!l.measure]), [["rose", "Avalanche", ["60", "80", "50 (2 сорт)"], true], ["rose", "Red Naomi", ["40"], true], ["chrysanthemum", "Altaj", ["Высшая", "Вторая"], false]]);
check("день: брак отдельно", d.rejects.map((x) => [x.variety, x.reason, x.qty]), [["Red Naomi", "botrytis", 50], ["Avalanche", "pests", 25]]);
check("как в прошлый раз: сорта последнего дня приёмки", lastIntakeLines(rows, "rose", TODAY), { date: "2026-11-01", lines: [{ variety: "Avalanche", block: "" }] });
check("недавние сорта — только до этого дня", recentVarieties(rows, "rose", TODAY).map((x) => x.variety), ["Avalanche"]);
const plan = planDayRows(["I0", "I1", "I2"], [{ id: "I0" }, { id: "" }], (x) => x.id, ["I0", "I1"]);
check("сохранение дня: удаляется только виденное", [plan.update.length, plan.add.length, plan.remove], [1, 1, ["I1"]]);

console.log("--- Таблица, права, вкладки");
check("вкладка приёмки — во второй таблице (как теплица)", isPayrollTab(SHEET_TABS.GH_INTAKE), true);
check("колонки приёмки", SHEET_HEADERS[SHEET_TABS.GH_INTAKE].slice(0, 13), ["IntakeID", "Farm", "Date", "Flower", "Block", "Variety", "Kind", "Grade", "Reason", "Qty", "StemG", "HeadCm", "Buds"]);
const razia = greenhouseScope({ role: "warehouse", farm: "rose_farm", payrollRole: "", payrollDepartments: [] });
check("зав. складом Rose Farm: пишет, компания закреплена", [razia?.editsLogs, razia?.farmLocked, pickGreenhouseFarm("esentai", undefined, razia?.farmLocked ?? null)], [true, "rose_farm", "rose_farm"]);
check("вкладки Rose Farm: Обзор, Приёмка, Записи, Аналитика", greenhouseTabsFor(razia, "rose_farm").map((t) => t.label), ["Обзор", "Приёмка", "Записи", "Аналитика"]);
const rop = greenhouseScope({ role: "sales_head", farm: "", payrollRole: "", payrollDepartments: [] });
check("РОП смотрит — без «Приёмки»", greenhouseTabsFor(rop, "rose_farm").map((t) => t.label), ["Обзор", "Записи", "Аналитика"]);
check("Есентай — прежние вкладки", greenhouseTabsFor(razia ? { ...razia, farmLocked: null } : null, "esentai").map((t) => t.label), ["Обзор", "Внести день", "Записи", "Аналитика", "Отчёты"]);

if (failed) {
  console.log(`\nНе прошло: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли.");
