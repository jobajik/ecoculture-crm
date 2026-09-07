/*
 * Проверки недель внутри месяца. Здесь легче всего ошибиться и труднее всего
 * заметить: неделя, потерявшая день, не падает с ошибкой — она просто тихо
 * недосчитывает план.
 *
 * Главное правило, которое проверяем на каждом месяце: сумма дней всех недель
 * ровно равна числу дней в месяце, недели идут подряд без дыр и нахлёстов, и
 * каждая (кроме крайних) начинается с понедельника.
 *
 * Запуск: npx tsx scripts/check-weeks.ts
 */
import {
  isValidWeekCode,
  monthOfWeek,
  weekIndexOf,
  weekLabel,
  weekOfDate,
  weeksOfMonth,
} from "../src/lib/constants";

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

const daysIn = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

// --- Инвариант на всех месяцах пяти лет ------------------------------------

let bad: string[] = [];
for (let year = 2024; year <= 2028; year++) {
  for (let month = 1; month <= 12; month++) {
    const period = `${year}-${String(month).padStart(2, "0")}`;
    const weeks = weeksOfMonth(period);
    const total = weeks.reduce((s, w) => s + w.days, 0);

    if (total !== daysIn(period)) bad.push(`${period}: дней ${total} вместо ${daysIn(period)}`);
    if (weeks.length < 4 || weeks.length > 6) bad.push(`${period}: недель ${weeks.length}`);

    // Идут подряд, без дыр и нахлёстов.
    for (let i = 0; i < weeks.length; i++) {
      const from = Number(weeks[i].from.slice(-2));
      const to = Number(weeks[i].to.slice(-2));
      if (to < from) bad.push(`${period}: неделя ${i + 1} задом наперёд`);
      const prevTo = i === 0 ? 0 : Number(weeks[i - 1].to.slice(-2));
      if (from !== prevTo + 1) bad.push(`${period}: разрыв перед неделей ${i + 1}`);
    }
    if (Number(weeks[0].from.slice(-2)) !== 1) bad.push(`${period}: не с первого числа`);
    if (Number(weeks[weeks.length - 1].to.slice(-2)) !== daysIn(period)) {
      bad.push(`${period}: не до последнего числа`);
    }

    // Все недели, кроме первой, начинаются с понедельника.
    for (let i = 1; i < weeks.length; i++) {
      const d = new Date(weeks[i].from + "T00:00:00");
      if (d.getDay() !== 1) bad.push(`${period}: неделя ${i + 1} начинается не с понедельника`);
    }
    // Все недели, кроме последней, заканчиваются воскресеньем.
    for (let i = 0; i < weeks.length - 1; i++) {
      const d = new Date(weeks[i].to + "T00:00:00");
      if (d.getDay() !== 0) bad.push(`${period}: неделя ${i + 1} кончается не воскресеньем`);
    }
  }
}
check("60 месяцев подряд: инварианты соблюдены", bad.slice(0, 3), []);

// --- Конкретные месяцы-ловушки --------------------------------------------

// Сентябрь 2026 начинается во вторник.
const sep = weeksOfMonth("2026-09");
check("сентябрь 2026: недель", sep.length, 5);
check("сентябрь 2026: первая неделя короткая", [sep[0].from, sep[0].to, sep[0].days], [
  "2026-09-01",
  "2026-09-06",
  6,
]);
check("сентябрь 2026: вторая — полная", [sep[1].from, sep[1].to, sep[1].days], [
  "2026-09-07",
  "2026-09-13",
  7,
]);
check("сентябрь 2026: последняя обрезана", [sep[4].from, sep[4].to, sep[4].days], [
  "2026-09-28",
  "2026-09-30",
  3,
]);
check("сентябрь 2026: подпись первой", sep[0].label, "1–6 сентября");
check("сентябрь 2026: короткая подпись", sep[1].shortLabel, "7–13");

// Февраль 2024 — високосный, 29 дней.
const feb24 = weeksOfMonth("2024-02");
check("февраль 2024: дней всего", feb24.reduce((s, w) => s + w.days, 0), 29);
// Февраль 2026 — обычный.
check(
  "февраль 2026: дней всего",
  weeksOfMonth("2026-02").reduce((s, w) => s + w.days, 0),
  28
);

// Месяц, который начинается ровно с понедельника: первая неделя полная.
// 1 июня 2026 — понедельник.
const jun = weeksOfMonth("2026-06");
check("июнь 2026 начинается с понедельника", jun[0].days, 7);
check("июнь 2026: недель", jun.length, 5);

// Месяц, который начинается с воскресенья: первая «неделя» — один день.
// 1 марта 2026 — воскресенье.
const mar = weeksOfMonth("2026-03");
check("март 2026: первая неделя — один день", mar[0].days, 1);
check("март 2026: подпись без диапазона", mar[0].label, "1 марта");
check("март 2026: короткая подпись", mar[0].shortLabel, "1");
check("март 2026: дней всего", mar.reduce((s, w) => s + w.days, 0), 31);

// --- Коды недель ----------------------------------------------------------

check("код первой недели", sep[0].code, "2026-09-W1");
check("месяц из кода", monthOfWeek("2026-09-W3"), "2026-09");
check("месяц из месячной строки", monthOfWeek("2026-09"), "2026-09");
check("месяц из мусора", monthOfWeek("абв"), "");
check("номер недели", weekIndexOf("2026-09-W4"), 4);
check("номер недели у месячной строки", weekIndexOf("2026-09"), 0);

check("верный код принимается", isValidWeekCode("2026-09-W5"), true);
check("шестой недели в сентябре нет", isValidWeekCode("2026-09-W6"), false);
check("нулевая неделя не принимается", isValidWeekCode("2026-09-W0"), false);
check("месячный код не является недельным", isValidWeekCode("2026-09"), false);
check("мусор не принимается", isValidWeekCode("2026-13-W1"), false);
check("подпись по коду", weekLabel("2026-09-W2"), "7–13 сентября");
check("подпись неизвестного кода — он сам", weekLabel("абв"), "абв");

// --- Неделя по дате -------------------------------------------------------

check("1 сентября 2026 — первая неделя", weekOfDate(new Date(2026, 8, 1)), "2026-09-W1");
check("6 сентября — ещё первая", weekOfDate(new Date(2026, 8, 6)), "2026-09-W1");
check("7 сентября — уже вторая", weekOfDate(new Date(2026, 8, 7)), "2026-09-W2");
check("30 сентября — пятая", weekOfDate(new Date(2026, 8, 30)), "2026-09-W5");
check("1 июня 2026 — первая", weekOfDate(new Date(2026, 5, 1)), "2026-06-W1");

// Каждый день месяца обязан попасть ровно в одну неделю.
let uncovered: number[] = [];
for (let day = 1; day <= 30; day++) {
  const code = weekOfDate(new Date(2026, 8, day));
  const week = sep.find((w) => w.code === code);
  const from = Number(week!.from.slice(-2));
  const to = Number(week!.to.slice(-2));
  if (day < from || day > to) uncovered.push(day);
}
check("каждый день сентября попал в свою неделю", uncovered, []);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
