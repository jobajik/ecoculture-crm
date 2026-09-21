/*
 * Стадия оплаты и короткий номер заявки.
 *
 * Раньше у заявки было два состояния — «не оплачено» и «оплачено», — и первое
 * отвечало сразу на ДВА разных вопроса: счёт ещё не выставили или клиент тянет
 * с деньгами. Звонить в этих случаях надо по-разному, а строка выглядела
 * одинаково. Владелец попросил развести их.
 *
 * Что здесь легко сломать:
 *
 * Первое: **стадия не хранится**, а считается из отметки о счёте и полученной
 * суммы. Заведи её третьим полем — и оно разъедется с двумя первыми, как
 * разъехались бы «оплачено всего» и «оплачено по компаниям», вводись оба руками.
 *
 * Второе: **деньги перебивают отметку.** Бухгалтер, забывшая отметить счёт, не
 * должна видеть оплаченную заявку как неоформленную — иначе она станет ставить
 * отметку задним числом, и дата отправки счёта перестанет что-либо значить.
 *
 * Третье: **копеечный остаток — это оплачено.** Тот же допуск, что и во всех
 * денежных сравнениях программы: после пересчёта по рекламации сумма
 * становится вроде 799 999,6, и без допуска заявка навсегда осталась бы
 * «оплаченной частично».
 *
 * Четвёртое: **поиск по короткому номеру.** Бухгалтеру называют по телефону
 * пять цифр, и она должна найти заявку, набрав их как угодно — «24831»,
 * «24 831», «24-831».
 *
 * Запуск: npx tsx scripts/check-payment-stage.ts
 */
import {
  PAYMENT_STAGES,
  STAGE_HINTS,
  STAGE_LABELS,
  STAGE_SHORT,
  invoiceFieldsOnSent,
  STAGE_TONES,
  invoiceSentRefusal,
  matchesOrderSearch,
  orderCode,
  paymentStage,
} from "../src/lib/paymentStage";
import { ORDER_KINDS, ORDER_STATUSES, ROLES, SHEET_HEADERS, SHEET_TABS } from "../src/lib/constants";

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

// --- Колонка дописана в конец (грабли 1.1) ---------------------------------

const headers = SHEET_HEADERS[SHEET_TABS.ORDERS];
// Каждая новая колонка дописывается В КОНЕЦ и сдвигает предыдущую последнюю —
// порядок и проверяем целиком, а не одно имя: перепутанный порядок ломает
// чтение всей вкладки (грабли 1.1).
check(
  "последние колонки Orders идут в том порядке, в каком их дописывали",
  headers.slice(-4),
  ["Kind", "InvoiceSentAt", "InvoiceNote", "Realization1C"]
);

// --- Стадии ----------------------------------------------------------------

const SENT = "2026-09-12T10:00:00.000Z";

check(
  "ничего не делали — счёт не отправлен",
  paymentStage({ totalAmount: 100_000, paidAmount: 0 }),
  PAYMENT_STAGES.NEW
);
check(
  "отметили счёт — счёт отправлен",
  paymentStage({ totalAmount: 100_000, paidAmount: 0, invoiceSentAt: SENT }),
  PAYMENT_STAGES.INVOICED
);
check(
  "пришла часть — частично",
  paymentStage({ totalAmount: 100_000, paidAmount: 40_000, invoiceSentAt: SENT }),
  PAYMENT_STAGES.PARTIAL
);
check(
  "пришло всё — оплачено",
  paymentStage({ totalAmount: 100_000, paidAmount: 100_000, invoiceSentAt: SENT }),
  PAYMENT_STAGES.PAID
);
// Деньги перебивают отметку: забытая отметка не делает оплаченную заявку новой.
check(
  "оплачено без отметки о счёте — всё равно оплачено",
  paymentStage({ totalAmount: 100_000, paidAmount: 100_000 }),
  PAYMENT_STAGES.PAID
);
check(
  "часть денег без отметки — всё равно частично",
  paymentStage({ totalAmount: 100_000, paidAmount: 10 }),
  PAYMENT_STAGES.PARTIAL
);
// Копейка после пересчёта по рекламации — это оплачено, а не «частично».
check(
  "копеечный остаток — оплачено",
  paymentStage({ totalAmount: 799_999.6, paidAmount: 800_000 }),
  PAYMENT_STAGES.PAID
);
check(
  "переплата — оплачено",
  paymentStage({ totalAmount: 100_000, paidAmount: 120_000 }),
  PAYMENT_STAGES.PAID
);
// Пустая отметка в ячейке не должна ничего утверждать (грабли 1.10).
check(
  "пробелы в ячейке — это «не отправляли»",
  paymentStage({ totalAmount: 100_000, paidAmount: 0, invoiceSentAt: "   " }),
  PAYMENT_STAGES.NEW
);

// У каждой стадии есть подпись, короткая подпись, пояснение и тон — иначе в
// таблице появится пустая ячейка, которую человек прочитает как поломку.
for (const stage of Object.values(PAYMENT_STAGES)) {
  check(`есть подпись: ${stage}`, Boolean(STAGE_LABELS[stage]), true);
  check(`есть короткая подпись: ${stage}`, Boolean(STAGE_SHORT[stage]), true);
  check(`есть пояснение: ${stage}`, Boolean(STAGE_HINTS[stage]), true);
  check(`есть тон: ${stage}`, Boolean(STAGE_TONES[stage]), true);
}

// --- Кто отмечает счёт -----------------------------------------------------

const clientOrder: { status: string; retail: string; kind: string } = {
  status: ORDER_STATUSES.NEW,
  retail: "",
  kind: "",
};
const ask = (role: string, order = clientOrder) =>
  invoiceSentRefusal({ role, order, cancelledStatus: ORDER_STATUSES.CANCELLED });

checkSome("бухгалтер отмечает", ask(ROLES.ACCOUNTANT), true);
checkSome("администратор тоже", ask(ROLES.ADMIN), true);
checkSome("менеджер — нет", ask(ROLES.MANAGER), false);
checkSome("РОП — нет", ask(ROLES.SALES_HEAD), false);
checkSome("зав. складом — нет", ask(ROLES.WAREHOUSE), false);
checkSome("пустая роль — нет (грабли 1.10)", ask(""), false);
checkSome(
  "по отменённой счёт не выставляют",
  ask(ROLES.ACCOUNTANT, { ...clientOrder, status: ORDER_STATUSES.CANCELLED }),
  false
);
// Счёта нет у двух видов заявок, и слова у них разные.
const retailRefusal = ask(ROLES.ACCOUNTANT, { ...clientOrder, retail: "almaty" });
checkSome("по заявке в наш магазин счёта нет", retailRefusal, false);
check("и сказано это про магазин", retailRefusal.includes("магазин"), true);
const regionRefusal = ask(ROLES.ACCOUNTANT, { ...clientOrder, kind: ORDER_KINDS.REGION });
checkSome("по объёму на город счёта нет", regionRefusal, false);
check("и сказано это про город", regionRefusal.includes("город"), true);
// Отгруженная заявка оплачена по определению, но снять ошибочную отметку с неё
// должно быть можно: запрет здесь не защищает ничего, а руки связывает.
checkSome(
  "по отгруженной отметку поправить можно",
  ask(ROLES.ACCOUNTANT, { ...clientOrder, status: ORDER_STATUSES.SHIPPED }),
  true
);

// --- Короткий номер --------------------------------------------------------

check("обычный номер", orderCode("ORD-1757924831"), "24831");
check("короткий номер целиком", orderCode("ORD-A1"), "A1");
check("номер без приставки", orderCode("1757924831"), "24831");
check("пусто не роняет", orderCode(""), "");
check("пусто не роняет и на null", orderCode(null), "");
// Два номера одной секунды всё же различаются — в этом и смысл хвоста.
check(
  "соседние заявки различаются",
  orderCode("ORD-1757924831") === orderCode("ORD-1757924832"),
  false
);

// --- Поиск -----------------------------------------------------------------

const row = {
  orderId: "ORD-1757924831",
  clientName: "Салон «Ирис»",
  managerName: "Эмиль Нурланов",
};
const found = (q: string) => matchesOrderSearch(row, q);

check("пустой запрос показывает всё", found(""), true);
check("по короткому номеру", found("24831"), true);
check("номер с пробелом", found("24 831"), true);
check("номер с дефисом", found("24-831"), true);
check("часть номера", found("831"), true);
check("полный номер", found("ORD-1757924831"), true);
check("по клиенту", found("ирис"), true);
check("по менеджеру", found("нурланов"), true);
check("по куску имени", found("эмиль"), true);
check("чужой номер не находится", found("99999"), false);
check("чужое имя не находится", found("Айгерим"), false);

// Просьба бухгалтера: искать по сумме из выписки и по номеру реализации 1С.
const row2 = { ...row, amount: 150_000, realization1c: "РН-000123" };
const found2 = (q: string) => matchesOrderSearch(row2, q);
check("по сумме целиком", found2("150000"), true);
check("по сумме с пробелом", found2("150 000"), true);
check("по сумме со знаком тенге", found2("150 000 ₸"), true);
check("по части суммы от четырёх цифр", found2("1500"), true);
check("три цифры суммы не ищут по части", found2("150") === found("150"), true);
check("чужая сумма не находится", found2("275 000"), false);
check("по номеру реализации", found2("РН-000123"), true);
check("по цифрам номера реализации", found2("000123"), true);

// --- Колонка отметки НОВАЯ, и подпись обязана это признавать ----------------
//
// Так решил владелец. У всех заявок, заведённых до сентября, отметка пуста, и
// назвать их «счёт не отправлен» значило бы соврать про счета, которые Юлия
// давно отправила руками. Программа говорит «отметки нет» — то есть ровно то,
// что знает (грабли 1.10: пустая ячейка ничего не утверждает).
check("пустая отметка не утверждает, что счёт не отправлен", /не отправлен/i.test(STAGE_LABELS.new), false);
check("а говорит, что отметки нет", /отметк/i.test(STAGE_LABELS.new), true);
check("короткая подпись так же", /отметк/i.test(STAGE_SHORT.new), true);

// --- Что записывается при отметке о счёте -----------------------------------
//
// Заметка «почему счёт не ушёл» появилась после случая владельца: два счёта не
// отправили из-за неверных телефонов клиентов, и какие именно — приходилось
// вспоминать. Живёт она ровно до отправки счёта.
const firstMark = invoiceFieldsOnSent(true, { invoiceSentAt: "" });
check("первая отметка ставит дату", Boolean(firstMark.invoiceSentAt), true);
check("и стирает заметку «почему не ушёл»", firstMark.invoiceNote, "");

const secondMark = invoiceFieldsOnSent(true, { invoiceSentAt: "2026-09-10T08:00:00.000Z" });
check(
  "повторная отметка НЕ двигает дату первой отправки",
  secondMark.invoiceSentAt,
  "2026-09-10T08:00:00.000Z"
);

const removed = invoiceFieldsOnSent(false, { invoiceSentAt: "2026-09-10T08:00:00.000Z" });
check("снятие отметки стирает дату целиком", removed.invoiceSentAt, "");
check("и заметку при этом не трогает", removed.invoiceNote, undefined);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
