/*
 * Касса по цветкам: сколько денег пришло за розу, сколько за хризантему.
 *
 * Владелец прислал снимок страницы своей тетради — «касса: хриз. 20 000, роза
 * 30 000» — и попросил то же самое в программе. Значит вопрос настоящий: он
 * ведёт это на бумаге, потому что «Получено» стояло одним числом.
 *
 * Здесь проверяется то, на чём такой расчёт обычно и врёт:
 *
 * - деньги считаются по дню, когда ПРИШЛИ, а не когда оформили заявку;
 * - смешанный платёж делится пропорционально суммам позиций, а не поровну;
 * - сумма частей РАВНА платежу — копейки от округления не теряются;
 * - у городской заявки цены нет вовсе, и делить приходится по стеблям;
 * - отменённая заявка в кассу не идёт.
 *
 * Запуск: npx tsx scripts/check-cash-by-flower.ts
 */
import { cashByFlower, splitPaymentByFlower, type CashOrder } from "../src/lib/cashByFlower";
import { FLOWER_TYPES, ORDER_STATUSES } from "../src/lib/constants";

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

const ROSE = FLOWER_TYPES.ROSE;
const CHR = FLOWER_TYPES.CHRYSANTHEMUM;
const EUS = FLOWER_TYPES.EUSTOMA;

function order(over: Partial<CashOrder>): CashOrder {
  return {
    status: "new",
    paidAt: "2026-09-14T10:00:00",
    paidAmount: 0,
    items: [],
    ...over,
  };
}

const amountOf = (rows: { flowerType: string; amount: number }[], flower: string) =>
  rows.find((r) => r.flowerType === flower)?.amount ?? 0;

// --- Одна заявка одного цветка ----------------------------------------------

const roseOnly = order({
  paidAmount: 30_000,
  items: [{ flowerType: ROSE, quantity: 100, unitPrice: 300 }],
});
check("роза целиком в розу", [...splitPaymentByFlower(roseOnly)], [[ROSE, 30_000]]);

// --- Смешанная заявка: делим пропорционально СУММАМ, а не поровну -----------
//
// Поровну было бы катастрофой: «розы на 300 000 и хризантемы на 20 000» дало бы
// по 160 000 каждому — цифра, которой не было никогда.

const mixed = order({
  paidAmount: 50_000,
  items: [
    { flowerType: ROSE, quantity: 100, unitPrice: 300 }, // 30 000
    { flowerType: CHR, quantity: 100, unitPrice: 200 }, // 20 000
  ],
});
const mixedSplit = splitPaymentByFlower(mixed);
check("роза получила свою долю", mixedSplit.get(ROSE), 30_000);
check("хризантема свою", mixedSplit.get(CHR), 20_000);
check(
  "сумма частей равна платежу",
  [...mixedSplit.values()].reduce((a, b) => a + b, 0),
  50_000
);

// Частичная оплата делится в тех же долях: пришла половина — по половине.
const half = splitPaymentByFlower({ ...mixed, paidAmount: 25_000 });
check("частичная оплата: роза", half.get(ROSE), 15_000);
check("частичная оплата: хризантема", half.get(CHR), 10_000);

// --- Копейки от округления не теряются --------------------------------------

const awkward = splitPaymentByFlower(
  order({
    paidAmount: 10_000,
    items: [
      { flowerType: ROSE, quantity: 1, unitPrice: 1 },
      { flowerType: CHR, quantity: 1, unitPrice: 1 },
      { flowerType: EUS, quantity: 1, unitPrice: 1 },
    ],
  })
);
check(
  "три равные доли дают ровно платёж",
  [...awkward.values()].reduce((a, b) => a + b, 0),
  10_000
);

// --- Городская заявка: цены нет, делим по стеблям ----------------------------

const region = splitPaymentByFlower(
  order({
    paidAmount: 90_000,
    items: [
      { flowerType: ROSE, quantity: 200, unitPrice: 0 },
      { flowerType: CHR, quantity: 100, unitPrice: 0 },
    ],
  })
);
check("объём на город: роза по стеблям", region.get(ROSE), 60_000);
check("объём на город: хризантема по стеблям", region.get(CHR), 30_000);

// --- Касса за период --------------------------------------------------------

const orders: CashOrder[] = [
  mixed, // 14 сентября: 30 000 роза + 20 000 хризантема
  order({
    paidAt: "2026-09-14T18:00:00",
    paidAmount: 7_000,
    items: [{ flowerType: EUS, quantity: 10, unitPrice: 700 }],
  }),
  // Другой день — в кассу этого дня не попадает.
  order({
    paidAt: "2026-09-13T10:00:00",
    paidAmount: 100_000,
    items: [{ flowerType: ROSE, quantity: 200, unitPrice: 500 }],
  }),
  // Денег нет — строки в кассе не появится.
  order({ paidAt: "", paidAmount: 0, items: [{ flowerType: ROSE, quantity: 5, unitPrice: 100 }] }),
  // Отменённая: деньги по ней либо вернули, либо разбирают рекламацией.
  order({
    status: ORDER_STATUSES.CANCELLED,
    paidAmount: 999_999,
    items: [{ flowerType: CHR, quantity: 10, unitPrice: 100 }],
  }),
];

const day = cashByFlower(orders, "2026-09-14", "2026-09-14");
check("за день: роза", amountOf(day.rows, ROSE), 30_000);
check("за день: хризантема", amountOf(day.rows, CHR), 20_000);
check("за день: эустома", amountOf(day.rows, EUS), 7_000);
check("за день: итого", day.total, 57_000);
check("отменённая заявка в кассу не попала", day.total < 999_999, true);

const twoDays = cashByFlower(orders, "2026-09-13", "2026-09-14");
check("за два дня роза выросла на вчерашние деньги", amountOf(twoDays.rows, ROSE), 130_000);
check("за два дня итого", twoDays.total, 157_000);

// --- Порядок строк постоянный ------------------------------------------------
//
// Прыгающие строки («кто сегодня больше») заставляют искать нужную заново
// каждый день — та же причина, по которой длины в листе сборки идут по шкале.
check(
  "порядок цветков привычный и не зависит от сумм",
  day.rows.map((r) => r.flowerType),
  [ROSE, CHR, EUS]
);

// --- Пустая база не падает ---------------------------------------------------

const empty = cashByFlower([], "2026-09-01", "2026-09-30");
check("пустая касса: итого ноль", empty.total, 0);
check("но строки всё равно есть — с нулями", empty.rows.length, 3);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
