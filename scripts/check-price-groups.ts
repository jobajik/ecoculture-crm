/*
 * Проверка группировки прайса (`src/lib/priceGroups.ts`) на форме живых данных
 * сентября: 13 сортов одной ценой, 3 спрея, 2 средних, мини-миксы и сорт без цены.
 *
 * Запуск: npx tsx scripts/check-price-groups.ts
 */
import { groupVarietiesByPrice } from "../src/lib/priceGroups";
import { priceKey } from "../src/lib/priceList";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

const F = "rose";
const grades = ["40", "50", "60", "70", "Мини-микс"];
const prices: Record<string, number> = {};
const set = (v: string, list: number[]) => list.forEach((p, i) => (prices[priceKey(F, v, grades[i])] = p));

const standard = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];
standard.forEach((v) => set(v, [160, 180, 220, 240, 0]));
["S1", "S2", "S3"].forEach((v) => set(v, [730, 760, 800, 830, 0]));
["L1", "L2"].forEach((v) => set(v, [370, 390, 410, 430, 0]));
set("MM1", [0, 0, 0, 0, 120]);
set("MM2", [0, 0, 0, 0, 200]);
set("", [999, 0, 0, 0, 0]); // общая цена не должна стать группой

const order = ["S1", ...standard.slice(0, 5), "Mix", "L1", ...standard.slice(5), "S2", "L2", "S3", "MM1", "MM2"];
const { groups, none } = groupVarietiesByPrice(F, order, grades, prices);

check("групп пять (13 + 3 + 2 + два мини-микса)", groups.length === 5, groups.map((g) => g.members.length).join(","));
check("большая группа первой", groups[0].members.length === 13);
check("внутри группы — порядок справочника", groups[0].members.join() === standard.join());
check("сорт без цены — в «по общей»", none.join() === "Mix");
check("общая цена «Все сорта» не попадает в группы", !groups.some((g) => g.members.includes("")));
check("каждый сорт ровно в одном месте", [...groups.flatMap((g) => g.members), ...none].sort().join() === [...order].sort().join());
check("равные по размеру группы — в порядке появления", groups[3].members[0] === "MM1" && groups[4].members[0] === "MM2");

const empty = groupVarietiesByPrice(F, ["X", "Y"], grades, {});
check("пустой прайс: групп нет, все по общей", empty.groups.length === 0 && empty.none.length === 2);

if (failed) {
  console.log(`\nПровалено: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
