/*
 * Проверка правил счёта Kaspi Pay через ApiPay (`src/lib/kaspiInvoice.ts`) и
 * подписи вебхука (`verifyWebhookSignature` в `src/lib/apipay.ts`).
 * Запуск: npx tsx scripts/check-kaspi.ts
 */
import { createHmac } from "node:crypto";
import {
  kaspiDescription,
  kaspiDueAmount,
  kaspiPhone,
  kaspiSendRefusal,
  kaspiStatusPlan,
  suggestedKaspiPhone,
  type KaspiSendInput,
} from "../src/lib/kaspiInvoice";
import { unwrapInvoice, validationText, verifyWebhookSignature } from "../src/lib/apipay";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}

// --- Номер ----------------------------------------------------------------------
check("+7 701 555 20 30", kaspiPhone("+7 701 555 20 30"), "87015552030");
check("8 (701) 555-20-30", kaspiPhone("8 (701) 555-20-30"), "87015552030");
check("7015552030", kaspiPhone("7015552030"), "87015552030");
check("городской 727 — не Kaspi", kaspiPhone("8 727 255 20 30"), "");
check("короткий", kaspiPhone("555-20-30"), "");
check("первый годный из списка", suggestedKaspiPhone(["", "12", "+77015552030", "87770000000"]), "87015552030");

// --- Подпись счёта ----------------------------------------------------------------
check("подпись до 60 знаков", kaspiDescription("esentai", "24831").length <= 60, true);
check("подпись с компанией и номером", kaspiDescription("esentai", "24831").includes("24831"), true);

// --- Остаток -------------------------------------------------------------------------
check("остаток до целого вверх", kaspiDueAmount({ amount: 12345.4, paidAmount: 0 }), 12346);
check("копейка — не долг", kaspiDueAmount({ amount: 1000, paidAmount: 999.5 }), 0);

// --- Можно ли выставить -----------------------------------------------------------------
const base: KaspiSendInput = {
  role: "accountant",
  farmConfigured: true,
  farm: "esentai",
  invoiceFarms: [
    { farm: "rose_farm", amount: 50000, paidAmount: 0 },
    { farm: "esentai", amount: 30000, paidAmount: 10000 },
  ],
  orderStatus: "new",
  noInvoice: false,
  phone: "87015552030",
  amount: 20000,
  existing: [],
};
check("бухгалтер, остаток Есентая", kaspiSendRefusal(base), "");
check("РОП не выставляет", kaspiSendRefusal({ ...base, role: "sales_head" }), "Счёт в Kaspi выставляет бухгалтер");
check("менеджер не выставляет", kaspiSendRefusal({ ...base, role: "manager" }), "Счёт в Kaspi выставляет бухгалтер");
check("админ выставляет", kaspiSendRefusal({ ...base, role: "admin" }), "");
check("касса Rose Farm не подключена", kaspiSendRefusal({ ...base, farm: "rose_farm", farmConfigured: false, amount: 1000 }).includes("не подключена"), true);
check("больше остатка", kaspiSendRefusal({ ...base, amount: 20001 }).startsWith("Больше остатка"), true);
check("дробная сумма", kaspiSendRefusal({ ...base, amount: 100.5 }), "Сумма — целое число тенге, больше нуля");
check("ноль", kaspiSendRefusal({ ...base, amount: 0 }), "Сумма — целое число тенге, больше нуля");
check("плохой номер", kaspiSendRefusal({ ...base, phone: "12345" }).startsWith("Нужен мобильный"), true);
check("отменённая заявка", kaspiSendRefusal({ ...base, orderStatus: "cancelled" }), "Заявка отменена");
check("наш магазин", kaspiSendRefusal({ ...base, noInvoice: true }), "У этой заявки нет счёта клиенту");
check("нет цветка компании", kaspiSendRefusal({ ...base, invoiceFarms: [{ farm: "rose_farm", amount: 1, paidAmount: 0 }] }), "В заявке нет цветка этой компании");
check(
  "уже оплачено",
  kaspiSendRefusal({ ...base, invoiceFarms: [{ farm: "esentai", amount: 30000, paidAmount: 30000 }] }),
  "Эта часть заявки уже оплачена"
);
check(
  "открытый счёт не дублируем",
  kaspiSendRefusal({ ...base, existing: [{ farm: "esentai", status: "pending" }] }).startsWith("Счёт на эту часть уже отправлен"),
  true
);
check("истёкший не мешает новому", kaspiSendRefusal({ ...base, existing: [{ farm: "esentai", status: "expired" }] }), "");
check("открытый счёт другой компании не мешает", kaspiSendRefusal({ ...base, existing: [{ farm: "rose_farm", status: "pending" }] }), "");

// --- Проводка оплаты один раз -----------------------------------------------------------
check("pending → paid: провести", kaspiStatusPlan({ status: "pending", paymentId: "" }, { status: "paid" }), { changed: true, recordPayment: true });
check("повтор paid: не проводить", kaspiStatusPlan({ status: "paid", paymentId: "PAY-1" }, { status: "paid" }), { changed: false, recordPayment: false });
check("paid, но уже «занят»: не проводить", kaspiStatusPlan({ status: "pending", paymentId: "claim-1" }, { status: "paid" }), { changed: true, recordPayment: false });
check("expired: без платежа", kaspiStatusPlan({ status: "pending", paymentId: "" }, { status: "expired" }), { changed: true, recordPayment: false });
check("paid → частичный возврат: второй платёж не нужен", kaspiStatusPlan({ status: "paid", paymentId: "PAY-1" }, { status: "partially_refunded" }), { changed: true, recordPayment: false });

// --- Подпись вебхука ----------------------------------------------------------------------
const secret = "test-secret";
const raw = '{"event":"invoice.status_changed","invoice":{"id":42,"status":"paid","amount":"15000.00"}}';
const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
check("верная подпись", verifyWebhookSignature(raw, sig, secret), true);
check("подпись без префикса", verifyWebhookSignature(raw, sig.slice(7), secret), true);
check("чужой секрет", verifyWebhookSignature(raw, sig, "other"), false);
check("тело подменили", verifyWebhookSignature(raw.replace("15000", "99000"), sig, secret), false);
check("подписи нет", verifyWebhookSignature(raw, null, secret), false);
check("секрета нет — не верим", verifyWebhookSignature(raw, sig, ""), false);
check("мусор вместо подписи", verifyWebhookSignature(raw, "sha256=zz", secret), false);

// --- Разбор счёта из разных форм ответа ---------------------------------------------------
check("счёт в корне", unwrapInvoice({ id: 1, status: "processing" })?.id, 1);
check("счёт в invoice", unwrapInvoice({ event: "x", invoice: { id: 2, status: "paid" } })?.id, 2);
check("счёт в data.invoice", unwrapInvoice({ data: { invoice: { id: 3, status: "paid" } } })?.id, 3);
check("счёт в data", unwrapInvoice({ data: { id: 4, status: "paid" } })?.id, 4);
check("без id — нет счёта", unwrapInvoice({ event: "webhook.test" }), null);

// --- Отказ ApiPay 422 — по-русски, с полем ------------------------------------------------
check(
  "422 с полем",
  validationText({ message: "Validation failed", errors: { phone_number: ["The phone number field is required."] } }),
  "ApiPay не принял счёт: номер — The phone number field is required."
);
check("422 без списка полей — пусто", validationText({ message: "Validation failed" }), "");
check("пустой ответ — пусто", validationText(null), "");

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
