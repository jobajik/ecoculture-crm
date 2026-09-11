/*
 * Удаление заявки совсем.
 *
 * Это единственное действие в программе, у которого НЕТ ВОЗВРАТА: в
 * Google-таблице нет корзины, удалённая строка не восстанавливается ничем.
 * Поэтому проверок здесь больше, чем кода.
 *
 * Первое: **удаляет только администратор.** Обычный путь — отмена: заявка
 * остаётся в базе и выходит из выручки, долгов и бонусов. Удаление придумано
 * ровно для мусора — завели дважды, завели на пробу.
 *
 * Второе: **удаляется только то, по чему ничего не происходило.** Была
 * отгрузка — со склада уйдут стебли, которых потом не объяснить ни продажей, ни
 * списанием. Пришли деньги — сумма исчезнет из выручки, и касса разойдётся с
 * программой. Есть рекламация — она превратится в строку про несуществующий
 * заказ. Каждый из трёх случаев отказывает СВОИМИ словами: запрет без
 * объяснения человек обходит, а не соблюдает.
 *
 * Третье: **запись в журнал должна читаться сама по себе.** Заявки больше нет,
 * и «удалена заявка ORD-175…» через месяц не ответит ни на один вопрос. В
 * строке обязаны быть клиент, менеджер, сумма, позиции и причина.
 *
 * Запуск: npx tsx scripts/check-order-delete.ts
 */
import {
  canDeleteOrder,
  deleteOrderRefusal,
  describeDeletedOrder,
  type DeleteCheckInput,
} from "../src/lib/orderDelete";
import { ORDER_STATUSES, ROLES } from "../src/lib/constants";

/**
 * `toLocaleString("ru-RU")` разделяет тысячи НЕРАЗРЫВНЫМ пробелом, а не
 * обычным. На экране разницы нет, а в проверке «строка содержит 50 000» есть —
 * на этом я тут и споткнулся. Сравниваем по обычному пробелу.
 */
function plain(text: string): string {
  return text.replace(/\u00A0/g, " ");
}

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
function checkSome(label: string, actual: string, expectEmpty: boolean) {
  const ok = expectEmpty ? actual === "" : actual !== "";
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${actual ? `«${actual}»` : "можно"}${
      ok ? "" : ` (ждали ${expectEmpty ? "«можно»" : "отказ"})`
    }`
  );
}

function ask(over: Partial<DeleteCheckInput> = {}): string {
  const base: DeleteCheckInput = {
    order: {
      status: ORDER_STATUSES.NEW,
      paidAmount: 0,
      items: [{ shippedQuantity: 0 }],
    },
    role: ROLES.ADMIN,
    shipments: 0,
    claims: 0,
    shippedStatus: ORDER_STATUSES.SHIPPED,
  };
  return deleteOrderRefusal({ ...base, ...over });
}

// --- Кто удаляет -----------------------------------------------------------

checkSome("администратор удаляет", ask(), true);
checkSome("менеджер — нет", ask({ role: ROLES.MANAGER }), false);
checkSome("бухгалтер — нет", ask({ role: ROLES.ACCOUNTANT }), false);
checkSome("РОП — нет", ask({ role: ROLES.SALES_HEAD }), false);
checkSome("зав. складом — нет", ask({ role: ROLES.WAREHOUSE }), false);
checkSome("менеджер розницы — нет", ask({ role: ROLES.RETAIL_ALMATY }), false);
checkSome("агроном — нет", ask({ role: ROLES.AGRONOMIST }), false);
checkSome("пустая роль — нет (грабли 1.10)", ask({ role: "" }), false);
checkSome("незнакомая роль — нет", ask({ role: "директор" }), false);
// Отказ по роли должен подсказывать обычный путь, а не просто запрещать.
check("менеджеру предлагают отмену", ask({ role: ROLES.MANAGER }).includes("отменить"), true);

// --- Что удаляется ---------------------------------------------------------

checkSome("чистую заявку удалить можно", ask(), true);
checkSome("отменённую тоже можно", ask({ order: { status: ORDER_STATUSES.CANCELLED, paidAmount: 0, items: [{ shippedQuantity: 0 }] } }), true);
checkSome("заявку без позиций можно", ask({ order: { status: ORDER_STATUSES.NEW, paidAmount: 0, items: [] } }), true);

// Отгрузка закрывает удаление тремя разными способами — на случай, если один
// из признаков окажется неполным (например, статус поставили руками).
const shippedByItem = ask({
  order: { status: ORDER_STATUSES.NEW, paidAmount: 0, items: [{ shippedQuantity: 5 }] },
});
checkSome("отгруженную позицию удалить нельзя", shippedByItem, false);
check("и сказано это про отгрузку", shippedByItem.includes("отгрузка"), true);
checkSome("запись отгрузки тоже закрывает", ask({ shipments: 1 }), false);
checkSome(
  "статус «отгружена» тоже закрывает",
  ask({ order: { status: ORDER_STATUSES.SHIPPED, paidAmount: 0, items: [{ shippedQuantity: 0 }] } }),
  false
);

const paid = ask({
  order: { status: ORDER_STATUSES.NEW, paidAmount: 50_000, items: [{ shippedQuantity: 0 }] },
});
checkSome("оплаченную удалить нельзя", paid, false);
check("и сумма названа", plain(paid).includes("50 000"), true);
check("и сказано, что делать", paid.includes("снимите оплату"), true);
// Копейка от округления при пересчёте — это не оплата, и держать из-за неё
// заявку было бы тем же самым, из-за чего заявка висела бы в долгах.
checkSome(
  "копейка удалению не мешает",
  ask({ order: { status: ORDER_STATUSES.NEW, paidAmount: 0.4, items: [{ shippedQuantity: 0 }] } }),
  true
);

const claimed = ask({ claims: 1 });
checkSome("с рекламацией удалить нельзя", claimed, false);
check("и сказано это про рекламацию", claimed.includes("рекламация"), true);

// Порядок отказов: сначала роль — чужому человеку незачем знать, что именно
// мешает удалить чужую заявку.
check(
  "роль проверяется раньше остального",
  ask({ role: ROLES.MANAGER, shipments: 3, claims: 2 }).includes("администратор"),
  true
);

check("кнопка показывается по тому же правилу", canDeleteOrder({
  order: { status: ORDER_STATUSES.NEW, paidAmount: 0, items: [{ shippedQuantity: 0 }] },
  role: ROLES.ADMIN,
  shipments: 0,
  claims: 0,
  shippedStatus: ORDER_STATUSES.SHIPPED,
}), true);
check("и прячется у менеджера", canDeleteOrder({
  order: { status: ORDER_STATUSES.NEW, paidAmount: 0, items: [{ shippedQuantity: 0 }] },
  role: ROLES.MANAGER,
  shipments: 0,
  claims: 0,
  shippedStatus: ORDER_STATUSES.SHIPPED,
}), false);

// --- Что останется в журнале ------------------------------------------------

const line = describeDeletedOrder({
  orderId: "ORD-1757924831",
  clientName: "Салон «Ирис»",
  managerEmail: "emil@x.kz",
  totalAmount: 207_900,
  items: [
    { variety: "Фридом", grade: "60", quantity: 450 },
    { variety: "Балтика", grade: "Высшая", quantity: 120 },
  ],
  reason: "  завели дважды  ",
});

check("в строке есть номер", line.includes("ORD-1757924831"), true);
check("есть клиент", line.includes("Салон «Ирис»"), true);
check("есть менеджер", line.includes("emil@x.kz"), true);
check("есть сумма", plain(line).includes("207 900"), true);
check("есть позиции", line.includes("Фридом 60 — 450 шт."), true);
check("есть вторая позиция", line.includes("Балтика Высшая — 120 шт."), true);
check("есть причина без лишних пробелов", line.includes("причина: завели дважды"), true);
// Пустая заявка не должна ронять запись — журнал обязан записаться всегда.
const empty = describeDeletedOrder({
  orderId: "ORD-1",
  clientName: "",
  managerEmail: "",
  totalAmount: 0,
  items: [],
  reason: "тест",
});
check("пустая заявка не роняет запись", empty.includes("клиент: не указан"), true);
check("и позиций в ней нет", empty.includes("позиции"), false);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
