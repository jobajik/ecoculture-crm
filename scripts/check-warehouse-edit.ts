/**
 * Правка заявки зав. складом — по своему цветку.
 *
 * Самое опасное здесь — граница производств: она держит весь склад, и если
 * ослабнет в этом одном месте, зав. складом Есентая начнёт править розу. Второе
 * по цене — деньги: правка меняет сумму заявки, а с ней долг, собираемость и
 * бонус менеджера.
 */
import {
  warehouseEditRefusal,
  warehouseEditedRefusal,
  describeWarehouseChanges,
  applyWarehouseEdit,
  totalAfterWarehouseEdit,
  moneyWarning,
  myItems,
  type WarehouseCurrentItem,
} from "../src/lib/warehouseOrderEdit";
import { FARMS, ROLES } from "../src/lib/constants";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(
    `${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}
function refuses(name: string, refusal: string) {
  const ok = refusal.length > 0;
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${ok ? refusal : "разрешено, а не должно"}`);
}
function allows(name: string, refusal: string) {
  const ok = refusal === "";
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}${ok ? "" : `: отказ «${refusal}»`}`);
}

const ROSE: WarehouseCurrentItem = {
  itemId: "O-I1",
  flowerType: "rose",
  variety: "Prestige",
  grade: "60",
  quantity: 800,
  unitPrice: 260,
  shippedQuantity: 0,
};
const CHRYS: WarehouseCurrentItem = {
  itemId: "O-I2",
  flowerType: "chrysanthemum",
  variety: "Altaj",
  grade: "Высшая",
  quantity: 300,
  unitPrice: 400,
  shippedQuantity: 0,
};
const current = [ROSE, CHRYS];

const order = {
  status: "new",
  paidAmount: 0,
  items: current,
};

const REASON = "В холодильнике только 640 шестидесятки";

// --- Кто вообще может --------------------------------------------------------
allows("зав. складом розы правит", warehouseEditRefusal(order, ROLES.WAREHOUSE, FARMS.ROSE_FARM));
refuses("менеджер этой правкой не пользуется", warehouseEditRefusal(order, ROLES.MANAGER, null));
refuses("админ правит обычной правкой, а не этой", warehouseEditRefusal(order, ROLES.ADMIN, null));
refuses(
  "зав. складом без производства не правит ничего (грабли 1.10)",
  warehouseEditRefusal(order, ROLES.WAREHOUSE, "")
);
refuses(
  "отгруженную заявку не правят",
  warehouseEditRefusal({ ...order, status: "shipped" }, ROLES.WAREHOUSE, FARMS.ROSE_FARM)
);
refuses(
  "отменённую тоже",
  warehouseEditRefusal({ ...order, status: "cancelled" }, ROLES.WAREHOUSE, FARMS.ROSE_FARM)
);
refuses(
  "заявку без своего цветка не открываем вовсе",
  warehouseEditRefusal({ ...order, items: [CHRYS] }, ROLES.WAREHOUSE, FARMS.ROSE_FARM)
);

// --- Что видно -------------------------------------------------------------
check(
  "Rose Farm видит розу",
  myItems(order, FARMS.ROSE_FARM).map((i) => i.itemId),
  ["O-I1"]
);
check(
  "Есентай видит хризантему",
  myItems(order, FARMS.ESENTAI).map((i) => i.itemId),
  ["O-I2"]
);
check("без производства не видно ничего", myItems(order, null), []);

// --- Граница производств ----------------------------------------------------
const ok = (next: unknown[], farm: string | null, reason = REASON) =>
  warehouseEditedRefusal({
    current,
    next: next as never,
    farm,
    reason,
    region: false,
  });

refuses(
  "чужую позицию не правят, даже прислав её напрямую",
  ok([{ itemId: "O-I2", grade: "Высшая", quantity: 100, unitPrice: 400 }], FARMS.ROSE_FARM)
);
refuses(
  "и наоборот — Есентай не правит розу",
  ok([{ itemId: "O-I1", grade: "60", quantity: 100, unitPrice: 260 }], FARMS.ESENTAI)
);
refuses(
  "выдуманная позиция отвергается",
  ok([{ itemId: "O-I9", grade: "60", quantity: 100, unitPrice: 260 }], FARMS.ROSE_FARM)
);
refuses(
  "одна и та же позиция дважды",
  ok(
    [
      { itemId: "O-I1", grade: "60", quantity: 700, unitPrice: 260 },
      { itemId: "O-I1", grade: "50", quantity: 100, unitPrice: 260 },
    ],
    FARMS.ROSE_FARM
  )
);

// --- Что можно менять --------------------------------------------------------
allows(
  "количество правится",
  ok([{ itemId: "O-I1", grade: "60", quantity: 640, unitPrice: 260 }], FARMS.ROSE_FARM)
);
allows(
  "ростовка правится",
  ok([{ itemId: "O-I1", grade: "50", quantity: 800, unitPrice: 260 }], FARMS.ROSE_FARM)
);
allows(
  "цена правится",
  ok([{ itemId: "O-I1", grade: "60", quantity: 800, unitPrice: 240 }], FARMS.ROSE_FARM)
);
refuses(
  "выдуманная ростовка не проходит",
  ok([{ itemId: "O-I1", grade: "82 см", quantity: 800, unitPrice: 260 }], FARMS.ROSE_FARM)
);
refuses(
  "ноль стеблей не бывает",
  ok([{ itemId: "O-I1", grade: "60", quantity: 0, unitPrice: 260 }], FARMS.ROSE_FARM)
);
refuses(
  "дробные стебли не бывают",
  ok([{ itemId: "O-I1", grade: "60", quantity: 10.5, unitPrice: 260 }], FARMS.ROSE_FARM)
);
refuses(
  "отрицательная цена не бывает",
  ok([{ itemId: "O-I1", grade: "60", quantity: 800, unitPrice: -5 }], FARMS.ROSE_FARM)
);
refuses(
  "без причины не сохраняем",
  ok([{ itemId: "O-I1", grade: "60", quantity: 640, unitPrice: 260 }], FARMS.ROSE_FARM, "  ")
);
refuses(
  "правка, которая ничего не меняет, — не правка",
  ok([{ itemId: "O-I1", grade: "60", quantity: 800, unitPrice: 260 }], FARMS.ROSE_FARM)
);

// --- Отгруженное -------------------------------------------------------------
const shipped = [{ ...ROSE, shippedQuantity: 500 }, CHRYS];
refuses(
  "ниже отгруженного заказ не опускают",
  warehouseEditedRefusal({
    current: shipped,
    next: [{ itemId: "O-I1", grade: "60", quantity: 400, unitPrice: 260 }],
    farm: FARMS.ROSE_FARM,
    reason: REASON,
    region: false,
  })
);
allows(
  "ровно до отгруженного — можно",
  warehouseEditedRefusal({
    current: shipped,
    next: [{ itemId: "O-I1", grade: "60", quantity: 500, unitPrice: 260 }],
    farm: FARMS.ROSE_FARM,
    reason: REASON,
    region: false,
  })
);

// --- Чужое остаётся нетронутым ----------------------------------------------
const applied = applyWarehouseEdit({
  current,
  next: [{ itemId: "O-I1", grade: "50", quantity: 640, unitPrice: 260 }],
  region: false,
});
check("своя позиция изменена", [applied[0].grade, applied[0].quantity], ["50", 640]);
check(
  "чужая позиция осталась ровно такой же",
  applied[1],
  CHRYS
);
check("сумма пересчитана по всем позициям", totalAfterWarehouseEdit(applied), 640 * 260 + 300 * 400);
check(
  "у городской заявки цена обнуляется, а не проверяется",
  applyWarehouseEdit({
    current,
    next: [{ itemId: "O-I1", grade: "60", quantity: 640, unitPrice: 999 }],
    region: true,
  })[0].unitPrice,
  0
);

// --- Что попадёт в журнал ----------------------------------------------------
check(
  "изменения описаны словами",
  describeWarehouseChanges({
    current,
    next: [{ itemId: "O-I1", grade: "50", quantity: 640, unitPrice: 240 }],
    region: false,
  }),
  ["Prestige: 800 → 640 шт, 60 см → 50 см, 260 → 240 ₸"]
);

// --- Деньги: человек должен увидеть последствие ДО сохранения ----------------
check("по неоплаченной заявке предупреждать не о чем", moneyWarning(0, 208_000, 166_400), "");
check(
  "уменьшили оплаченную — это переплата",
  moneyWarning(208_000, 208_000, 166_400).includes("переплата"),
  true
);
check(
  "увеличили оплаченную — отгружать нельзя, пока не доплатят",
  moneyWarning(208_000, 208_000, 260_000).includes("отгружать её нельзя"),
  true
);
// Зав. складом видит ТОЛЬКО свой цветок, а итог заявки складывается из обоих
// производств. Назвать сумму в предупреждении значило бы показать ей деньги
// чужого цветка (грабли 1.1-ter), поэтому цифр в тексте нет ни одной.
check(
  "в предупреждении нет сумм",
  /\d/.test(moneyWarning(208_000, 208_000, 166_400) + moneyWarning(208_000, 208_000, 260_000)),
  false
);
check(
  "частичная оплата и уменьшение в пределах внесённого — молчим",
  moneyWarning(50_000, 208_000, 166_400),
  ""
);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
