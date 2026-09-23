/*
 * Надёжность записи и правила, найденные аудитом сентября.
 *
 * Аудит живой базы показал, что данные теряются не в логике, а на стыке с
 * Google: отгрузка писалась четырьмя запросами, правка переписывала всю строку,
 * повторное нажатие давало второй платёж, отменённую заявку можно было
 * отгрузить. Здесь проверяются чистые правила, на которых держатся исправления:
 *  - что пишется в ячейку (число — числом, текст — текстом, формула не
 *    рождается из телефона);
 *  - что правка трогает только изменившиеся поля;
 *  - повтор платежа отличается от второго платежа;
 *  - отменённую нельзя собрать и подтвердить, заявку с деньгами — отменить;
 *  - дата новой заявки без опечатки в годе;
 *  - доступ к разделам — из одной таблицы, и склад без производства не видит
 *    ничего.
 *
 * Запуск: npx tsx scripts/check-integrity.ts
 */
import { changedCells, toCellData } from "../src/lib/sheets";
import { duplicatePaymentRefusal, DUPLICATE_PAYMENT_WINDOW_MS } from "../src/lib/payments";
import { isReadyToShip, notReadyReason } from "../src/lib/orderReady";
import { cancelRefusal, confirmRefusal } from "../src/lib/orderRules";
import { newOrderDateRefusal } from "../src/lib/orderEdit";
import { canOpen, missingFarm } from "../src/lib/access";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

console.log("\n— Значение ячейки при атомарной записи —");
check("число — числом", toCellData(120), { userEnteredValue: { numberValue: 120 } });
check("строка из цифр — числом (суммы в таблице считаются)", toCellData("120"), { userEnteredValue: { numberValue: 120 } });
check("телефон с плюсом — текстом, не формулой", toCellData("+7 701 555 20 30"), { userEnteredValue: { stringValue: "+7 701 555 20 30" } });
check("текст с «=» — текстом", toCellData("=СУММ(A1)"), { userEnteredValue: { stringValue: "=СУММ(A1)" } });
check("дата — текстом, не серийным числом", toCellData("2026-09-18"), { userEnteredValue: { stringValue: "2026-09-18" } });
check("ведущий ноль сохраняется (номер 1С)", toCellData("00012"), { userEnteredValue: { stringValue: "00012" } });
check("пусто — пустой строкой", toCellData(undefined), { userEnteredValue: { stringValue: "" } });
check("флаг — словом TRUE, как читает toFlag", toCellData(true), { userEnteredValue: { stringValue: "TRUE" } });
check("NaN не пишется числом", toCellData(Number.NaN), { userEnteredValue: { stringValue: "" } });

console.log("\n— Правка пишет только изменившиеся поля —");
check(
  "статус не трогает оплату",
  changedCells({ Status: "new", PaidAmount: "5000" }, { Status: "shipped" }),
  { Status: "shipped" }
);
check("то же значение числом — не изменение", changedCells({ PaidAmount: "5000" }, { PaidAmount: 5000 }), {});
check("стирание поля — изменение", changedCells({ Note: "ждём" }, { Note: "" }), { Note: "" });

console.log("\n— Повтор платежа —");
const now = Date.parse("2026-09-23T10:00:00Z");
const recent = [{ amount: 60000, method: "Каспи", date: "2026-09-23", createdAt: "2026-09-23T09:59:10Z" }];
check(
  "та же сумма, способ и день минуту назад — отказ",
  duplicatePaymentRefusal({ lines: [{ amount: 60000, method: "Каспи" }], date: "2026-09-23", recent, now }) !== "",
  true
);
check(
  "другой способ — это другой платёж",
  duplicatePaymentRefusal({ lines: [{ amount: 60000, method: "Наличные" }], date: "2026-09-23", recent, now }),
  ""
);
check(
  "другая сумма — другой платёж",
  duplicatePaymentRefusal({ lines: [{ amount: 50000, method: "Каспи" }], date: "2026-09-23", recent, now }),
  ""
);
check(
  "через три минуты — уже второй платёж",
  duplicatePaymentRefusal({ lines: [{ amount: 60000, method: "Каспи" }], date: "2026-09-23", recent, now: now + DUPLICATE_PAYMENT_WINDOW_MS }),
  ""
);

console.log("\n— Отменённую не собирают —");
const ready = { managerConfirmed: true, paid: true, paidAmount: 100, totalAmount: 100 };
check("готовая открытая — можно", isReadyToShip({ ...ready, status: "new" }), true);
check("отменённая с галочками — нельзя", isReadyToShip({ ...ready, status: "cancelled" }), false);
check("отгруженная целиком — нельзя", isReadyToShip({ ...ready, status: "shipped" }), false);
check("причина говорит об отмене", notReadyReason({ ...ready, status: "cancelled" }), "Заявка отменена");
check(
  "подтвердить отменённую нельзя",
  confirmRefusal({ status: "cancelled", managerEmail: "m@x" }, "manager", "m@x", true),
  "Заявка отменена"
);
check("подтвердить свою открытую можно", confirmRefusal({ status: "new", managerEmail: "m@x" }, "manager", "m@x", true), "");

console.log("\n— Отмена заявки с деньгами —");
const base = { status: "new", managerEmail: "m@x", items: [{ shippedQuantity: 0 }] };
check("без денег — можно", cancelRefusal({ ...base, paidAmount: 0 }, "manager", "m@x"), "");
check("с деньгами — нельзя", cancelRefusal({ ...base, paidAmount: 120000 }, "manager", "m@x").startsWith("По заявке уже получено 120"), true);
check("и админу нельзя", cancelRefusal({ ...base, paidAmount: 120000 }, "admin", "a@x") !== "", true);

console.log("\n— Дата доставки новой заявки —");
const today = "2026-09-23";
check("завтра — можно", newOrderDateRefusal("2026-09-24", today), "");
check("без даты — можно (отдельное предупреждение)", newOrderDateRefusal("", today), "");
check("неделю назад — можно (вносят задним числом)", newOrderDateRefusal("2026-09-16", today), "");
check("месяц назад — отказ", newOrderDateRefusal("2026-08-20", today) !== "", true);
check("опечатка в годе — отказ", newOrderDateRefusal("2062-09-24", today) !== "", true);
check("31 февраля — отказ", newOrderDateRefusal("2026-02-31", today), "Дата доставки указана неверно");

console.log("\n— Доступ: одна таблица на все места —");
check("РОП в «Продажи»", canOpen("sales_head", "/sales"), true);
check("бухгалтер в «Продажи»", canOpen("accountant", "/sales"), true);
check("склад в «Продажи» — нет", canOpen("warehouse", "/sales"), false);
check("без роли — никуда", canOpen("", "/orders"), false);
check("админ — везде", canOpen("admin", "/plans"), true);
check("журнал — бухгалтеру, но не РОПу", [canOpen("accountant", "/finance/log"), canOpen("sales_head", "/finance/log")], [true, false]);
check("склад без производства — закрыт", missingFarm("warehouse", ""), true);
check("склад с производством — открыт", missingFarm("warehouse", "rose_farm"), false);
check("менеджеру производство не нужно", missingFarm("manager", ""), false);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
