/*
 * Проверка прайс-листа: подстановка цены и её история.
 *
 * Два места, где легко ошибиться и не заметить: цена сорта должна перебивать
 * общую (иначе дорогой сорт продадут по цене дешёвого), а из истории должна
 * браться самая свежая запись на дату (иначе после повышения будут продавать
 * по старой цене). И то и другое стоит денег, поэтому проверяется здесь.
 *
 * Запуск: npx tsx scripts/check-prices.ts
 */
import {
  BASE_VARIETY,
  currentPrices,
  priceFor,
  priceFromMap,
  priceKey,
  priceMapForClient,
  type PriceRow,
} from "../src/lib/priceList";

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

const row = (date: string, variety: string, grade: string, price: number): PriceRow => ({
  date,
  flowerType: "rose",
  variety,
  grade,
  price,
});

const history: PriceRow[] = [
  row("2026-09-01", BASE_VARIETY, "40", 100),
  row("2026-09-01", BASE_VARIETY, "60", 160),
  row("2026-09-01", "Red Naomi", "60", 220),
  // Повышение общей цены с 5 сентября.
  row("2026-09-05", BASE_VARIETY, "60", 180),
  // Запись «из будущего» не должна влиять на сегодня.
  row("2026-12-01", BASE_VARIETY, "60", 300),
];

// --- Какая цена действует ---------------------------------------------------
const today = currentPrices(history, "2026-09-08");
check("общая цена 60 см — свежая", priceFor(today, "rose", "Freedom", "60"), 180);
check("сорт перебивает общую", priceFor(today, "rose", "Red Naomi", "60"), 220);
check("общая цена 40 см", priceFor(today, "rose", "Freedom", "40"), 100);
check("будущая цена сегодня не действует", priceFor(today, "rose", "Freedom", "60") === 300, false);

const before = currentPrices(history, "2026-09-03");
check("до повышения действовала старая", priceFor(before, "rose", "Freedom", "60"), 160);

// --- Чего нет ---------------------------------------------------------------
check("цены нет — ноль, а не выдумка", priceFor(today, "rose", "Freedom", "100"), 0);
check("чужой цветок не подставляется", priceFor(today, "chrysanthemum", "Altaj", "60"), 0);

// Ноль у сорта означает «цены нет» и НЕ должен перебивать общую: иначе снятая
// цена молча обнулила бы позицию в заявке.
const withZero = currentPrices([...history, row("2026-09-06", "Freedom", "60", 0)], "2026-09-08");
check("ноль у сорта не перебивает общую", priceFor(withZero, "rose", "Freedom", "60"), 180);

// --- Та же логика в браузере ------------------------------------------------
const map = priceMapForClient(today);
check("карта для браузера: общая", priceFromMap(map, "rose", "Freedom", "60"), 180);
check("карта для браузера: сорт", priceFromMap(map, "rose", "Red Naomi", "60"), 220);
check("карта для браузера: нет цены", priceFromMap(map, "rose", "Freedom", "100"), 0);
check(
  "сервер и браузер считают одинаково",
  ["Freedom", "Red Naomi"].every(
    (v) => priceFor(today, "rose", v, "60") === priceFromMap(map, "rose", v, "60")
  ),
  true
);

// --- Ключи ------------------------------------------------------------------
check("ключ различает сорт", priceKey("rose", "A", "60") === priceKey("rose", "B", "60"), false);
check("ключ различает длину", priceKey("rose", "A", "60") === priceKey("rose", "A", "70"), false);
check("ключ различает цветок", priceKey("rose", "A", "60") === priceKey("eustoma", "A", "60"), false);
check("строка «все сорта» — пустой сорт", priceKey("rose", BASE_VARIETY, "60"), "rose||60");

// --- Пустой прайс -----------------------------------------------------------
const empty = currentPrices([], "2026-09-08");
check("пустой прайс не ломается", priceFor(empty, "rose", "Freedom", "60"), 0);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
