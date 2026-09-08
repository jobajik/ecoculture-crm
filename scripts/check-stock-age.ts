/*
 * Проверка разбивки склада по времени хранения: 1–3, 4–7, 8–13, 14+ дней.
 *
 * Здесь легко ошибиться на границах (день 3 и день 4 обязаны попасть в разные
 * диапазоны) и потерять стебли при склейке ГРАДАЦИЙ (строки диапазона — это
 * ростовка: длина у розы, категория у хризантемы), поэтому проверяем и то и
 * другое на выдуманном складе с известными числами.
 *
 * Запуск: npx tsx scripts/check-stock-age.ts
 */
import { getStockSnapshot, ageBucketKeyOf, AGE_BUCKETS } from "../src/lib/stock";
import { groupByGrade } from "../src/lib/stockByGrade";
import { GRADES_BY_FLOWER_TYPE, gradeOrder } from "../src/lib/constants";

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

const NOW = new Date("2026-09-20T12:00:00");

/** Дата срезки «столько-то дней назад». */
function daysAgo(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const batches = [
  // Две партии розы 60 см разных сортов в первом диапазоне — должны сложиться в
  // одну строку «Роза 60»: сорт в разбивке по дням не участвует.
  { batchId: "B1", harvestDate: daysAgo(0), flowerType: "rose", variety: "Freedom", grade: "60", quantityIn: 200, quantityRemaining: 200, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  { batchId: "B2", harvestDate: daysAgo(3), flowerType: "rose", variety: "Prestige", grade: "60", quantityIn: 300, quantityRemaining: 300, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // День 4 — уже следующий диапазон.
  { batchId: "B3", harvestDate: daysAgo(4), flowerType: "rose", variety: "Explorer", grade: "60", quantityIn: 100, quantityRemaining: 100, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // Роза 9 дней — при сроке 7 это просрочка.
  { batchId: "B4", harvestDate: daysAgo(9), flowerType: "rose", variety: "Red Naomi", grade: "70", quantityIn: 50, quantityRemaining: 50, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // Хризантема 9 дней — при сроке 18 она ещё в норме. Тот же диапазон, другой цвет.
  { batchId: "B5", harvestDate: daysAgo(9), flowerType: "chrysanthemum", variety: "Altaj", grade: "Высшая", quantityIn: 400, quantityRemaining: 400, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // 20 дней — последний диапазон.
  { batchId: "B6", harvestDate: daysAgo(20), flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantityIn: 70, quantityRemaining: 70, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // Одна и та же градация «50» у розы и у эустомы в одном диапазоне: строки
  // обязаны остаться разными, иначе длина розы сложилась бы с эустомой.
  { batchId: "B8", harvestDate: daysAgo(1), flowerType: "rose", variety: "Freedom", grade: "50", quantityIn: 10, quantityRemaining: 10, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  { batchId: "B9", harvestDate: daysAgo(1), flowerType: "eustoma", variety: "Corelli", grade: "50", quantityIn: 20, quantityRemaining: 20, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
  // Пустая партия не должна попасть никуда.
  { batchId: "B7", harvestDate: daysAgo(5), flowerType: "rose", variety: "Freedom", grade: "60", quantityIn: 500, quantityRemaining: 0, location: "", receivedByEmail: "w@x.kz", receivedAt: "" },
] as never as Awaited<ReturnType<typeof import("../src/lib/repo/batches").listBatches>>;

const settings = {
  shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 },
  warningThreshold: 0.7,
} as never as Awaited<ReturnType<typeof import("../src/lib/repo/settings").getSettings>>;

async function main() {
  // --- Границы диапазонов --------------------------------------------------
  check("день 0 — первый диапазон", ageBucketKeyOf(0), "1-3");
  check("день 3 — ещё первый", ageBucketKeyOf(3), "1-3");
  check("день 4 — уже второй", ageBucketKeyOf(4), "4-7");
  check("день 7 — ещё второй", ageBucketKeyOf(7), "4-7");
  check("день 8 — третий", ageBucketKeyOf(8), "8-13");
  check("день 13 — ещё третий", ageBucketKeyOf(13), "8-13");
  check("день 14 — последний", ageBucketKeyOf(14), "14+");
  check("день 400 — тоже последний", ageBucketKeyOf(400), "14+");
  check("диапазонов всего", AGE_BUCKETS.length, 4);
  check(
    "диапазоны идут подряд без дыр",
    AGE_BUCKETS.slice(1).every((b, i) => b.minDays === AGE_BUCKETS[i].maxDays + 1),
    true
  );

  const snap = await getStockSnapshot(NOW, { batches, settings }, null);
  const bucket = (key: string) => snap.ageBuckets.find((b) => b.key === key)!;
  /** Все ростовки диапазона одним списком — плитка складывает их по цветку. */
  const gradesOf = (key: string) => bucket(key).flowers.flatMap((f) => f.grades);

  // --- Количества ----------------------------------------------------------
  check("всего на складе", snap.totalStems, 200 + 300 + 100 + 50 + 400 + 70 + 10 + 20);
  check(
    "сумма диапазонов = складу",
    snap.ageBuckets.reduce((s, b) => s + b.quantity, 0),
    snap.totalStems
  );
  check("1–3 дня", bucket("1-3").quantity, 500 + 30);
  check("4–7 дней", bucket("4-7").quantity, 100);
  check("8–13 дней", bucket("8-13").quantity, 450);
  check("14+ дней", bucket("14+").quantity, 70);

  // --- Склейка градаций ----------------------------------------------------
  check("две партии розы 60 см слились в одну строку", gradesOf("1-3").filter((g) => g.grade === "60").length, 1);
  check("строка диапазона — это градация", gradesOf("1-3").find((g) => g.grade === "60")!.grade, "60");
  check("Роза 60: количество", gradesOf("1-3").find((g) => g.grade === "60")!.quantity, 500);
  check("Роза 60: партий", gradesOf("1-3").find((g) => g.grade === "60")!.batches, 2);
  check("ростовок в первом диапазоне", gradesOf("1-3").length, 3);
  check("пустая партия никуда не попала", gradesOf("4-7").length, 1);
  check(
    "внутри диапазона одна строка на градацию",
    snap.ageBuckets.every((b) => {
      const all = b.flowers.flatMap((f) => f.grades);
      return new Set(all.map((g) => `${g.flowerType}:${g.grade}`)).size === all.length;
    }),
    true
  );
  check(
    "«50» у розы и у эустомы — разные строки",
    gradesOf("1-3")
      .filter((g) => g.grade === "50")
      .map((g) => `${g.flowerType}:${g.quantity}`)
      .sort(),
    ["eustoma:20", "rose:10"]
  );

  // --- Цвета: один диапазон, разные цветки, разные статусы ------------------
  const nine = gradesOf("8-13");
  check("роза 9 дней — просрочена", nine.find((g) => g.flowerType === "rose")?.status, "critical");
  check(
    "хризантема 9 дней — в норме",
    nine.find((g) => g.flowerType === "chrysanthemum")?.status,
    "ok"
  );
  check("диапазон красится по худшему", bucket("8-13").status, "critical");
  check("свежий диапазон — зелёный", bucket("1-3").status, "ok");

  // --- Сортировка и доли ---------------------------------------------------
  check(
    "цветки в плитке идут от крупного",
    bucket("8-13").flowers.map((f) => f.flowerType),
    ["chrysanthemum", "rose"]
  );
  check(
    "сумма по цветку = сумме его ростовок",
    bucket("8-13").flowers.every(
      (f) => f.grades.reduce((s, g) => s + g.quantity, 0) === f.quantity
    ),
    true
  );
  check(
    "цветок красится по худшей ростовке",
    bucket("8-13").flowers.find((f) => f.flowerType === "rose")?.status,
    "critical"
  );
  check(
    "доли складываются в единицу",
    Math.round(snap.ageBuckets.reduce((s, b) => s + b.share, 0) * 1000) / 1000,
    1
  );

  // --- Пустой склад --------------------------------------------------------
  const empty = await getStockSnapshot(NOW, { batches: [], settings }, null);
  check("пустой склад: диапазоны всё равно есть", empty.ageBuckets.length, 4);
  check("пустой склад: цветков внутри нет", empty.ageBuckets.every((b) => b.flowers.length === 0), true);
  check("пустой склад: без деления на ноль", empty.ageBuckets.every((b) => b.share === 0), true);

  // --- Фильтр по производству ----------------------------------------------
  const roseFarm = await getStockSnapshot(NOW, { batches, settings }, "rose_farm");
  check(
    "у Rose Farm хризантемы в диапазонах нет",
    roseFarm.ageBuckets.every((b) => b.flowers.every((f) => f.flowerType !== "chrysanthemum")),
    true
  );
  check(
    "у Rose Farm сумма диапазонов = его складу",
    roseFarm.ageBuckets.reduce((s, b) => s + b.quantity, 0),
    roseFarm.totalStems
  );

  // --- Разрез «ростовка → сорта» в «Подробно по позициям» -------------------
  const byGrade = groupByGrade(snap.varieties);
  const rose60 = byGrade.find((c) => c.flowerType === "rose" && c.grade === "60")!;
  check("роза 60 см собрана в одну строку", rose60 !== undefined, true);
  check("роза 60 см: всего", rose60.totalQuantity, 200 + 300 + 100);
  check(
    "внутри ростовки — сорта",
    rose60.varieties.map((v) => v.variety).sort(),
    ["Explorer", "Freedom", "Prestige"]
  );
  check(
    "сумма сортов = ростовке",
    rose60.varieties.reduce((s, v) => s + v.quantity, 0),
    rose60.totalQuantity
  );
  check("ростовка стареет по худшему сорту", rose60.oldestDays, 4);
  check("разброс дней виден", rose60.newestDays, 0);
  check(
    "все стебли склада попали в разрез",
    byGrade.reduce((s, c) => s + c.totalQuantity, 0),
    snap.totalStems
  );
  check(
    "цветки не перемешались",
    byGrade.every((c) => c.varieties.length > 0) &&
      new Set(byGrade.map((c) => c.key)).size === byGrade.length,
    true
  );
  check("пустой склад: разрез пустой", groupByGrade([]).length, 0);

  // --- Порядок ростовок ----------------------------------------------------
  // Он одинаковый везде: 40, 50, 60… мини-микс, второй сорт. Сортировать длины
  // по количеству нельзя — глаз каждый раз ищет строку заново.
  check("розы: 40 раньше 50", gradeOrder("rose", "40") < gradeOrder("rose", "50"), true);
  check("розы: мини-микс после длин", gradeOrder("rose", "Мини-микс") > gradeOrder("rose", "100"), true);
  check(
    "розы: второй сорт после мини-микса",
    gradeOrder("rose", "40 (2 сорт)") > gradeOrder("rose", "Мини-микс"),
    true
  );
  check(
    "розы: уценка в самом конце",
    gradeOrder("rose", "Уценка"),
    GRADES_BY_FLOWER_TYPE.rose.length - 1
  );
  check(
    "хризантема: высшая → первая → вторая",
    ["Высшая", "Первая", "Вторая", "Третья", "Четвёртая"].every(
      (g, i, arr) => i === 0 || gradeOrder("chrysanthemum", arr[i - 1]) < gradeOrder("chrysanthemum", g)
    ),
    true
  );
  check(
    "эустома: стандарт → 50 → мини-микс",
    ["Стандарт", "50", "Мини-микс"].map((g) => gradeOrder("eustoma", g)),
    [0, 1, 2]
  );
  check("незнакомая градация уходит в конец", gradeOrder("rose", "Что-то"), GRADES_BY_FLOWER_TYPE.rose.length);
  check(
    "в диапазоне ростовки идут в правильном порядке",
    bucket("1-3")
      .flowers.filter((f) => f.flowerType === "rose")
      .every((f) =>
        f.grades.every(
          (g, i, arr) => i === 0 || gradeOrder("rose", arr[i - 1].grade) <= gradeOrder("rose", g.grade)
        )
      ),
    true
  );
  check(
    "в «Подробно по позициям» тот же порядок",
    byGrade
      .filter((c) => c.flowerType === "rose")
      .every(
        (c, i, arr) => i === 0 || gradeOrder("rose", arr[i - 1].grade) <= gradeOrder("rose", c.grade)
      ),
    true
  );

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
