/*
 * Проверка разбора дат из Google-таблицы.
 *
 * Повод конкретный: таблица отдаёт значения так, как они ОТОБРАЖАЮТСЯ. У ячейки
 * с числовым форматом дата вернётся счётчиком дней Google — «46268», у ячейки с
 * датным форматом — «03.09.2026». И то и другое `new Date(...)` не понимает:
 * срок хранения становится нулём, а FIFO сортирует даты как строки.
 * На боевой загрузке склада так «помолодели» 12 705 стеблей.
 *
 * Запуск: npx tsx scripts/check-sheet-date.ts
 */
import { toIsoDate, toIsoDateTime } from "../src/lib/sheetDate";
import { formatDay, formatMoment } from "../src/lib/formatDate";
import { daysBetween, computeBatchStorageInfo } from "../src/lib/shelfLife";

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

// --- Как приходит из таблицы ------------------------------------------------
check("ISO как есть", toIsoDate("2026-09-03"), "2026-09-03");
check("ISO со временем", toIsoDate("2026-09-03T08:00:00"), "2026-09-03");
check("русский формат", toIsoDate("03.09.2026"), "2026-09-03");
check("русский без нулей", toIsoDate("3.9.2026"), "2026-09-03");
check("через слэш", toIsoDate("03/09/2026"), "2026-09-03");
check("через дефис", toIsoDate("03-09-2026"), "2026-09-03");
check("двузначный год", toIsoDate("03.09.26"), "2026-09-03");
check("объект Date", toIsoDate(new Date(2026, 8, 3)), "2026-09-03");
check("пробелы по краям", toIsoDate("  2026-09-03  "), "2026-09-03");

// Серийный номер Google: ячейка с числовым форматом отдаёт дату числом.
check("серийный номер Google", toIsoDate("46268"), "2026-09-03");
check("серийный номер как число", toIsoDate(46272), "2026-09-07");
check("серийный с дробью (время)", toIsoDate("46268.5"), "2026-09-03");
check("серийник 46000", toIsoDate("46000"), "2025-12-09");

// --- Чего быть не должно ----------------------------------------------------
check("пусто остаётся пустым", toIsoDate(""), "");
check("мусор не превращается в дату", toIsoDate("позавчера"), "");
check("31 февраля отвергается", toIsoDate("31.02.2026"), "");
check("13-й месяц отвергается", toIsoDate("2026-13-01"), "");
check("null не ломает", toIsoDate(null), "");
// Количество стеблей не должно превратиться в дату.
check("6840 — не дата", toIsoDate("6840"), "");
check("999999 — не дата", toIsoDate("999999"), "");

// Главное: русский формат и ISO должны давать ОДИН И ТОТ ЖЕ день.
check(
  "оба формата — один день",
  toIsoDate("03.09.2026") === toIsoDate("2026-09-03"),
  true
);

// --- Срок хранения ----------------------------------------------------------
const NOW = new Date("2026-09-07T12:00:00");
check("четыре дня от ISO", daysBetween("2026-09-03", NOW), 4);
check("четыре дня от русской даты", daysBetween(toIsoDate("03.09.2026"), NOW), 4);
check("сегодня — ноль дней", daysBetween("2026-09-07", NOW), 0);

// Без приведения роза, срезанная 4 дня назад, показывалась бы свежей — вот
// ровно этот случай.
const settings = {
  shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 },
  warningThreshold: 0.7,
} as never as Parameters<typeof computeBatchStorageInfo>[1];
const batch = {
  batchId: "B1",
  receivedAt: "",
  harvestDate: toIsoDate("03.09.2026"),
  flowerType: "rose",
  variety: "Prestige",
  grade: "40",
  quantityIn: 100,
  quantityRemaining: 100,
  location: "",
  receivedByEmail: "",
} as never as Parameters<typeof computeBatchStorageInfo>[0];
check("партия знает свой возраст", computeBatchStorageInfo(batch, settings, NOW).daysInStorage, 4);

// --- FIFO: сортировка строк ------------------------------------------------
// Строковое сравнение «03.09.2026» < «02.10.2026» дало бы неверный порядок,
// после приведения к ISO порядок правильный.
const dates = ["05.10.2026", "03.09.2026", "2026-09-30"].map(toIsoDate).sort();
check("порядок списания правильный", dates, ["2026-09-03", "2026-09-30", "2026-10-05"]);

// --- Дата со временем ------------------------------------------------------
// Заявка несёт дату оформления со временем. Ломается она так же, как обычная
// дата, только заметнее: `new Date("46274")` — это 1 января 46274 года, и
// именно эту дату владелец увидел в поле «Дата доставки».
check("ISO со временем остаётся как есть", toIsoDateTime("2026-09-05T09:30:00"), "2026-09-05T09:30:00");
check("серийник без дробной части — просто дата", toIsoDateTime("46274"), "2026-09-09");
check("серийник с дробной частью несёт время", toIsoDateTime("46274,5"), "2026-09-09T12:00:00");
check("отображаемая дата со временем", toIsoDateTime("05.09.2026 9:30:00"), "2026-09-05T09:30:00");
check("просто дата остаётся датой", toIsoDateTime("05.09.2026"), "2026-09-05");
check("мусор не превращается в дату", toIsoDateTime("щшрш"), "");
check("пустое остаётся пустым", toIsoDateTime(""), "");

// Показ человеку: из «46274» не должно получиться «01.01.46274».
check("серийник не показывается как год 46274", formatDay("46274"), "—");
check("непонятное — прочерк, а не выдуманная дата", formatDay("щшрш"), "—");
check("нормальная дата показывается", formatDay("2026-09-09"), "09.09.2026");
check("дата не уезжает на сутки назад", formatDay("2026-01-01"), "01.01.2026");
check("момент показывается с временем", formatMoment("2026-09-05T09:30:00").startsWith("05.09.2026"), true);
check("чистая дата показывается без времени", formatMoment("2026-09-05"), "05.09.2026");

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
