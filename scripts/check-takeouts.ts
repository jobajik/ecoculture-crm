/*
 * Цветы в счёт зарплаты: стебли уходят, деньги не приходят.
 *
 * Три вещи здесь ломаются тихо и стоят дорого.
 *
 * Первая — учёт «именно по сотрудникам», ради которого раздел и делался.
 * Фамилию вписывают руками, и если «Ахметова Разия», «ахметова разия» и
 * «Ахметова Р.» окажутся тремя людьми, итог за месяц перестанет быть итогом, а
 * бухгалтер удержит с человека треть того, что он взял.
 *
 * Вторая — граница производств. Выдача снимает стебли со склада, то есть это
 * такое же распоряжение чужим цветком, как отгрузка и списание.
 *
 * Третья — сумма. Она нигде не хранится и считается как количество × цена;
 * стоит завести второе поле «итого» — и два числа об одном и том же разъедутся.
 *
 * Запуск: npx tsx scripts/check-takeouts.ts
 */
import {
  buildStaffMonth,
  buildTakeoutDay,
  canFillTakeouts,
  canSeeTakeouts,
  cleanStaffName,
  findSimilarStaff,
  knownStaffNames,
  looseStaffKey,
  staffSpellings,
  staffKey,
  takeoutFarmScope,
  takeoutRefusal,
  takeoutStemsByFlower,
  type RawTakeout,
} from "../src/lib/staffTakeout";
import { ROLES } from "../src/lib/constants";

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

// --- Фамилия: одна и та же, как её ни напиши -------------------------------

check("лишние пробелы убираются", cleanStaffName("  Ахметова   Разия "), "Ахметова Разия");
check("пустое остаётся пустым", cleanStaffName("   "), "");
check("очень длинное обрезается", cleanStaffName("А".repeat(80)).length, 60);

check("регистр не делает второго человека", staffKey("АХМЕТОВА Разия"), staffKey("ахметова разия"));
check("«ё» не делает второго человека", staffKey("Фёдорова Анна"), staffKey("Федорова Анна"));
check("точка после инициала не делает второго", staffKey("Ахметова Р."), staffKey("ахметова Р"));
check("однофамильцы с разными именами — разные люди", staffKey("Ким Ольга") === staffKey("Ким Сергей"), false);

check("грубый ключ сводит имя и инициал", looseStaffKey("Ахметова Разия"), looseStaffKey("Ахметова Р."));
check("но не сводит однофамильцев с разными именами", looseStaffKey("Ким Ольга") === looseStaffKey("Ким Сергей"), false);

const KNOWN = ["Ахметова Разия", "Ким Ольга"];
check("подсказка про похожее написание", findSimilarStaff("Ахметова Р.", KNOWN), "Ахметова Разия");
check("точное совпадение ни о чём не спрашивает", findSimilarStaff("Ахметова Разия", KNOWN), "");
check("новый человек ни о чём не спрашивает", findSimilarStaff("Досов Ерлан", KNOWN), "");
check("пустое имя ни о чём не спрашивает", findSimilarStaff("  ", KNOWN), "");

check(
  "подсказка фамилий — сначала те, кого выдавали недавно",
  knownStaffNames([
    { staffName: "Ким Ольга", date: "2026-09-01" },
    { staffName: "Ахметова Разия", date: "2026-09-09" },
    { staffName: "ахметова разия", date: "2026-09-10" },
  ]),
  ["Ахметова Разия", "Ким Ольга"]
);

// Написание, которым человека показывают. Одна запись строчными не должна
// навсегда превращать сотрудницу в «ахметова разия» в отчёте бухгалтера.
check(
  "строчное написание не побеждает приличное, даже если оно свежее",
  staffSpellings([
    { staffName: "Ахметова Разия", date: "2026-09-01" },
    { staffName: "ахметова разия", date: "2026-09-10" },
  ]).get(staffKey("Ахметова Разия"))?.name,
  "Ахметова Разия"
);
check(
  "а правку написания учитываем: среди приличных побеждает свежее",
  staffSpellings([
    { staffName: "Федорова Анна", date: "2026-09-01" },
    { staffName: "Фёдорова Анна", date: "2026-09-10" },
  ]).get(staffKey("Федорова Анна"))?.name,
  "Фёдорова Анна"
);
check(
  "разные имена при одной фамилии остаются разными людьми",
  staffSpellings([
    { staffName: "Ахметова Р.", date: "2026-09-01" },
    { staffName: "Ахметова Разия", date: "2026-09-10" },
  ]).size,
  2
);
check(
  "если приличных написаний нет, берём последнее",
  staffSpellings([
    { staffName: "ахметова разия", date: "2026-09-01" },
    { staffName: "ахметова  разия", date: "2026-09-10" },
  ]).get(staffKey("Ахметова Разия"))?.name,
  "ахметова разия"
);

// --- Права ------------------------------------------------------------------

check("зав. складом записывает выдачи", canFillTakeouts(ROLES.WAREHOUSE), true);
check("администратор тоже", canFillTakeouts(ROLES.ADMIN), true);
check("бухгалтер выдачи не записывает", canFillTakeouts(ROLES.ACCOUNTANT), false);
check("менеджер тем более", canFillTakeouts(ROLES.MANAGER), false);
check("но бухгалтер их видит — ей удерживать", canSeeTakeouts(ROLES.ACCOUNTANT), true);
check("менеджер не видит", canSeeTakeouts(ROLES.MANAGER), false);
check("агроном не видит", canSeeTakeouts(ROLES.AGRONOMIST), false);
check("пустая роль не видит (грабли 1.10)", canSeeTakeouts(""), false);

check("зав. складом видит только своё производство", takeoutFarmScope(ROLES.WAREHOUSE, "rose_farm"), "rose_farm");
check("бухгалтер видит оба", takeoutFarmScope(ROLES.ACCOUNTANT, null), null);
check("администратор видит оба", takeoutFarmScope(ROLES.ADMIN, "rose_farm"), null);

// --- Отказ сервера ----------------------------------------------------------

const TODAY = "2026-09-11";
const ROSE_BATCH = { flowerType: "rose", quantityRemaining: 100 };
const CHRYS_BATCH = { flowerType: "chrysanthemum", quantityRemaining: 100 };

function refusal(patch: Partial<Parameters<typeof takeoutRefusal>[0]>) {
  return takeoutRefusal({
    role: ROLES.WAREHOUSE,
    farm: "rose_farm",
    staffName: "Ахметова Разия",
    quantity: 20,
    unitPrice: 150,
    date: TODAY,
    today: TODAY,
    batch: ROSE_BATCH,
    ...patch,
  });
}

check("обычная выдача проходит", refusal({}), "");
check("менеджеру нельзя", refusal({ role: ROLES.MANAGER }) !== "", true);
check("бухгалтеру нельзя (она только смотрит)", refusal({ role: ROLES.ACCOUNTANT }) !== "", true);
check("без фамилии нельзя", refusal({ staffName: "   " }) !== "", true);
check("без партии нельзя", refusal({ batch: null }) !== "", true);
check("чужой цветок выдать нельзя", refusal({ batch: CHRYS_BATCH }) !== "", true);
check(
  "зав. складом без производства не работает со складом (грабли 1.10)",
  refusal({ farm: null }) !== "",
  true
);
check("администратору чужого цветка не бывает", refusal({ role: ROLES.ADMIN, farm: null, batch: CHRYS_BATCH }), "");
check("ноль стеблей нельзя", refusal({ quantity: 0 }) !== "", true);
check("минус нельзя", refusal({ quantity: -5 }) !== "", true);
check("половина стебля нельзя", refusal({ quantity: 2.5 }) !== "", true);
check("больше остатка партии нельзя", refusal({ quantity: 101 }) !== "", true);
check("ровно остаток — можно", refusal({ quantity: 100 }), "");
check("цена без значения допускается", refusal({ unitPrice: 0 }), "");
check("отрицательная цена нельзя", refusal({ unitPrice: -1 }) !== "", true);
check("будущим днём выдать нельзя", refusal({ date: "2026-09-12" }) !== "", true);
check("вчерашним можно — записывают задним числом", refusal({ date: "2026-09-10" }), "");
check("кривая дата нельзя", refusal({ date: "11.09.2026" }) !== "", true);

// --- Таблица за день --------------------------------------------------------

const TAKEOUTS: RawTakeout[] = [
  {
    takeoutId: "TK-1",
    date: "2026-09-11",
    staffName: "Ахметова Разия",
    flowerType: "rose",
    variety: "Freedom",
    grade: "60",
    quantity: 20,
    unitPrice: 150,
  },
  {
    takeoutId: "TK-2",
    date: "2026-09-11",
    staffName: "ахметова  разия",
    flowerType: "rose",
    variety: "Explorer",
    grade: "50",
    quantity: 10,
    unitPrice: 100,
  },
  {
    takeoutId: "TK-3",
    date: "2026-09-11",
    staffName: "Ким Ольга",
    flowerType: "chrysanthemum",
    variety: "Зембла",
    grade: "Высшая",
    quantity: 15,
    unitPrice: 0, // цену ещё не вписали
  },
  {
    takeoutId: "TK-4",
    date: "2026-09-05",
    staffName: "Ким Ольга",
    flowerType: "chrysanthemum",
    variety: "Зембла",
    grade: "Первая",
    quantity: 5,
    unitPrice: 90,
  },
  {
    takeoutId: "TK-5",
    date: "2026-08-31",
    staffName: "Ахметова Разия",
    flowerType: "rose",
    variety: "Freedom",
    grade: "60",
    quantity: 40,
    unitPrice: 150,
  },
];

const dayAll = buildTakeoutDay({ takeouts: TAKEOUTS, date: "2026-09-11", farm: null });
check("за день три строки", dayAll.rows.length, 3);
check("стеблей за день", dayAll.stems, 45);
check("сумма за день = Σ количество × цена", dayAll.amount, 20 * 150 + 10 * 100 + 0);
check("строка без цены посчитана отдельно", dayAll.noPrice, 1);
check("два разных написания — один человек", dayAll.people, 2);

const dayRose = buildTakeoutDay({ takeouts: TAKEOUTS, date: "2026-09-11", farm: "rose_farm" });
check("зав. складом роз видит только свои строки", dayRose.rows.map((r) => r.takeoutId), ["TK-1", "TK-2"]);
check("и свои стебли", dayRose.stems, 30);

const dayEsentai = buildTakeoutDay({ takeouts: TAKEOUTS, date: "2026-09-11", farm: "esentai" });
check("зав. складом хризантемы — только свои", dayEsentai.rows.map((r) => r.takeoutId), ["TK-3"]);

check("пустой день не падает", buildTakeoutDay({ takeouts: [], date: "2026-09-11", farm: null }).stems, 0);

// --- Итог за месяц ----------------------------------------------------------

const month = buildStaffMonth({ takeouts: TAKEOUTS, month: "2026-09", farm: null });
check("в сентябре двое сотрудников", month.people, 2);
check(
  "выдачи одного человека сложились в одну строку",
  month.rows.find((r) => r.key === staffKey("Ахметова Разия"))?.stems,
  30
);
check("август в сентябрьский итог не попал", month.stems, 50);
check("сумма за месяц", month.amount, 20 * 150 + 10 * 100 + 0 + 5 * 90);
check("сверху тот, у кого набежало больше", month.rows[0].key, staffKey("Ахметова Разия"));
check(
  "разбивка по цветку у второго человека",
  month.rows.find((r) => r.key === staffKey("Ким Ольга"))?.byFlower,
  [{ flowerType: "chrysanthemum", stems: 20 }]
);
check(
  "в отчёте стоит приличное написание фамилии, а не последнее",
  month.rows.find((r) => r.key === staffKey("Ахметова Разия"))?.staffName,
  "Ахметова Разия"
);
check(
  "и в таблице за день — тоже одно написание на человека",
  Array.from(new Set(dayAll.rows.map((r) => r.staffName))).sort(),
  ["Ахметова Разия", "Ким Ольга"]
);
check("строки без цены видно и в месяце", month.noPrice, 1);
check("итог сходится с суммой строк", month.rows.reduce((s, r) => s + r.amount, 0), month.amount);

const monthRose = buildStaffMonth({ takeouts: TAKEOUTS, month: "2026-09", farm: "rose_farm" });
check("у зав. складом роз в месяце один человек", monthRose.people, 1);
check("и только свои стебли", monthRose.stems, 30);

const monthAugust = buildStaffMonth({ takeouts: TAKEOUTS, month: "2026-08", farm: null });
check("август считается отдельно", monthAugust.stems, 40);
check("пустой месяц не падает", buildStaffMonth({ takeouts: [], month: "2026-07", farm: null }).amount, 0);

// --- Баланс склада ----------------------------------------------------------

check(
  "выдачи по цветку за отрезок — чтобы строка «по цветку» сходилась",
  takeoutStemsByFlower({ takeouts: TAKEOUTS, from: "2026-09-01", to: "2026-09-30" }),
  { rose: 30, chrysanthemum: 20 }
);
check(
  "границы отрезка включаются",
  takeoutStemsByFlower({ takeouts: TAKEOUTS, from: "2026-09-11", to: "2026-09-11" }),
  { rose: 30, chrysanthemum: 15 }
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
