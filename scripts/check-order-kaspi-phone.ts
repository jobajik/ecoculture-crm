/*
 * Номер Kaspi для счёта по заявке меняет менеджер (19.11.2026, владелец: «сделать возможность для менеджеров
 * изменять/добавлять номер для каспи, потому что часто сами клиенты просят на другие номера отправлять»).
 *
 * Стережём обе стороны. Пропустим лишнее — чужой менеджер или склад перевесит счёт на свой номер, два живых счёта на
 * одну сумму уйдут клиенту, новый счёт окажется больше остатка, карточка клиента потеряет прежний номер. Откажем зря —
 * менеджер снова звонит бухгалтеру, а счёт так и ждёт на номере, с которого клиент платить не будет.
 *
 * Запуск: npx tsx scripts/check-order-kaspi-phone.ts
 */
import { kaspiPhoneEditRefusal, kaspiPhoneOfOrder, planKaspiPhoneChange, type KaspiPhonePlan } from "../src/lib/orderKaspiPhone";
import { kaspiPhoneOptions, kaspiSendRefusal, suggestedKaspiPhone } from "../src/lib/kaspiInvoice";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const has = (v: unknown, part: string) => typeof v === "string" && v.includes(part);
const plan = (p: KaspiPhonePlan | string): KaspiPhonePlan => {
  if (typeof p === "string") throw new Error(`ждали план, получили отказ: ${p}`);
  return p;
};

const order = { status: "new", kind: "", retail: "", direction: "", clientName: "Улжан", managerEmail: "ilyas@x.kz", totalAmount: 48000, paidAmount: 0, kaspiPhone: "" };

// --- Кто может ------------------------------------------------------------------------
const who = (role: string, email: string, over: Record<string, unknown> = {}, card = "") => kaspiPhoneEditRefusal({ role, email, order: { ...order, ...over }, cardManagerEmail: card });
check("менеджер своей заявки — можно", who("manager", "Ilyas@x.kz"), "");
check("чужой менеджер — нельзя", has(who("manager", "emil@x.kz"), "другого менеджера"), true);
check("менеджер карточки клиента (заявку завёл бот или другой) — можно", who("manager", "emil@x.kz", {}, "emil@x.kz"), "");
check("РОП, админ, бухгалтер — любую", [who("sales_head", "n@x.kz"), who("admin", "o@x.kz"), who("accountant", "y@x.kz")], ["", "", ""]);
check("менеджер розницы, продавший клиенту, — свою", who("retail_almaty", "ilyas@x.kz"), "");
check("склад, маркетолог, Земфира, пустая роль — нельзя", ["warehouse", "marketer", "leadgen", "office", ""].map((r) => has(who(r, "ilyas@x.kz"), "меняет менеджер заявки")), [true, true, true, true, true]);
check("отменённая заявка", has(who("manager", "ilyas@x.kz", { status: "cancelled" }), "отменена"), true);
check("оплачена полностью — номер уже не нужен", has(who("admin", "o@x.kz", { paidAmount: 48000 }), "оплачена полностью"), true);
check("частично оплачена — можно", who("manager", "ilyas@x.kz", { paidAmount: 20000 }), "");
check("наш магазин, объём на город, точка — счёта нет", [{ retail: "almaty" }, { kind: "region", direction: "Астана" }, { clientName: "Пожарка" }].map((o) => has(who("admin", "o@x.kz", o), "нет счёта")), [true, true, true]);
check("без почты менеджер не «свой»", has(who("manager", ""), "другого менеджера"), true);

// --- Номер ----------------------------------------------------------------------------
const base = { order, remember: false, client: { kaspiPay1: "+7 701 111 11 11", kaspiPay2: "", paymentMethod: "Каспи" }, canEditCard: true, invoices: [], due: [{ farm: "esentai", due: 48000 }] };
check("номер в любом написании приводится к 8701…", [plan(planKaspiPhoneChange({ ...base, phone: "+7 (705) 222-33-44" })).phone, plan(planKaspiPhoneChange({ ...base, phone: "7052223344" })).phone], ["87052223344", "87052223344"]);
check("городской и битый номер — отказ", [has(planKaspiPhoneChange({ ...base, phone: "8 727 222 33 44" }), "мобильный номер"), has(planKaspiPhoneChange({ ...base, phone: "12345" }), "мобильный номер")], [true, true]);
check("тот же номер, что уже в заявке, — менять нечего", has(planKaspiPhoneChange({ ...base, order: { ...order, kaspiPhone: "8 705 222 33 44" }, phone: "87052223344" }), "уже указан"), true);
check("пусто — убрать номер заявки; когда его нет — нечего", [plan(planKaspiPhoneChange({ ...base, order: { ...order, kaspiPhone: "8 705 222 33 44" }, phone: "" })).phone, has(planKaspiPhoneChange({ ...base, phone: "" }), "убирать нечего")], ["", true]);
const simple = plan(planKaspiPhoneChange({ ...base, phone: "87052223344" }));
check("без счетов и без «запомнить»: только номер заявки", [simple.card, simple.reissue, simple.kept, simple.cardNote], [null, [], [], ""]);

// --- Карточка клиента -----------------------------------------------------------------
const rem = (client: Record<string, string> | null, over: Record<string, unknown> = {}) => plan(planKaspiPhoneChange({ ...base, client, remember: true, phone: "87052223344", ...over }));
check("запомнить: новый номер — №1, прежний №1 — №2", rem({ kaspiPay1: "+7 701 111 11 11", kaspiPay2: "8 702 999 99 99", paymentMethod: "Каспи" }).card, { kaspiPay1: "87052223344", kaspiPay2: "+7 701 111 11 11" });
check("запомнить: №1 был пуст — №2 остаётся", rem({ kaspiPay1: "", kaspiPay2: "8 702 999 99 99", paymentMethod: "Каспи" }).card, { kaspiPay1: "87052223344", kaspiPay2: "8 702 999 99 99" });
check("запомнить: номер был вторым — поднимается в №1, без повтора", rem({ kaspiPay1: "", kaspiPay2: "8 705 222 33 44", paymentMethod: "Каспи" }).card, { kaspiPay1: "87052223344", kaspiPay2: "" });
check("запомнить: способ оплаты не выбран — ставится «Каспи»", rem({ kaspiPay1: "", kaspiPay2: "", paymentMethod: "" }).card, { kaspiPay1: "87052223344", kaspiPay2: "", paymentMethod: "Каспи" });
check("номер уже основной в карточке — карточку не трогаем", rem({ kaspiPay1: "8 705 222 33 44", kaspiPay2: "", paymentMethod: "Каспи" }).card, null);
const cash = rem({ kaspiPay1: "", kaspiPay2: "", paymentMethod: "Наличные" });
check("в карточке «Наличные» — карточку не трогаем и говорим почему", [cash.card, has(cash.cardNote, "Наличные")], [null, true]);
const foreign = rem({ kaspiPay1: "", kaspiPay2: "", paymentMethod: "Каспи" }, { canEditCard: false });
check("чужая карточка — не трогаем и говорим почему", [foreign.card, has(foreign.cardNote, "правит его менеджер")], [null, true]);
check("без карточки клиента", [rem(null).card, has(rem(null).cardNote, "нет карточки")], [null, true]);
check("без галочки карточка не меняется", plan(planKaspiPhoneChange({ ...base, phone: "87052223344", client: { kaspiPay1: "", kaspiPay2: "", paymentMethod: "" } })).card, null);

// --- Счета, которые ждут оплаты -------------------------------------------------------
const inv = (invoiceId: string, farm: string, amount: number, phone: string, status = "pending") => ({ invoiceId, farm, amount, phone, status });
const move = (invoices: ReturnType<typeof inv>[], due: { farm: string; due: number }[], phone = "87052223344") => plan(planKaspiPhoneChange({ ...base, invoices, due, phone }));
check("счёт ждёт на прежнем номере — отменить и выставить на ту же сумму", move([inv("1", "esentai", 48000, "87011111111")], [{ farm: "esentai", due: 48000 }]).reissue, [{ farm: "esentai", cancel: ["1"], amount: 48000 }]);
check("счёт «отправляется» — тоже переносится", move([inv("1", "esentai", 48000, "87011111111", "processing")], [{ farm: "esentai", due: 48000 }]).reissue.length, 1);
check("оплаченный, истёкший, отменённый и уже отменяемый — не трогаются", move([inv("1", "esentai", 48000, "87011111111", "paid"), inv("2", "esentai", 48000, "87011111111", "expired"), inv("3", "esentai", 48000, "87011111111", "cancelled"), inv("4", "esentai", 48000, "87011111111", "cancelling")], [{ farm: "esentai", due: 48000 }]).reissue, []);
check("смешанная заявка: по каждой компании свой счёт", move([inv("1", "esentai", 27000, "87011111111"), inv("2", "rose_farm", 40000, "87011111111")], [{ farm: "esentai", due: 27000 }, { farm: "rose_farm", due: 40000 }]).reissue, [
  { farm: "esentai", cancel: ["1"], amount: 27000 },
  { farm: "rose_farm", cancel: ["2"], amount: 40000 },
]);
check("два счёта одной компании на разных номерах — один новый на сумму обоих", move([inv("1", "esentai", 20000, "87011111111"), inv("2", "esentai", 28000, "87029999999")], [{ farm: "esentai", due: 48000 }]).reissue, [{ farm: "esentai", cancel: ["1", "2"], amount: 48000 }]);
check("часть уже оплатили — новый счёт не больше остатка", move([inv("1", "esentai", 48000, "87011111111")], [{ farm: "esentai", due: 30000 }]).reissue, [{ farm: "esentai", cancel: ["1"], amount: 30000 }]);
const keep = move([inv("1", "esentai", 20000, "87011111111"), inv("2", "esentai", 28000, "8 705 222 33 44")], [{ farm: "esentai", due: 48000 }]);
check("на новом номере счёт уже ждёт — ничего не перевыставляем (второй счёт на тот же номер нельзя)", [keep.reissue, keep.kept], [[], ["esentai"]]);
check("счёт уже на этом номере и номер тот же — отказ словами", has(planKaspiPhoneChange({ ...base, order: { ...order, kaspiPhone: "87052223344" }, phone: "87052223344", invoices: [inv("1", "esentai", 20000, "87011111111"), inv("2", "esentai", 28000, "87052223344")] }), "уже выставлен"), true);
check("номер в заявке тот же, но счёт висит на другом — перенос всё равно нужен", move([inv("1", "esentai", 48000, "87011111111")], [{ farm: "esentai", due: 48000 }]).reissue.length === 1 && typeof planKaspiPhoneChange({ ...base, order: { ...order, kaspiPhone: "87052223344" }, phone: "87052223344", invoices: [inv("1", "esentai", 48000, "87011111111")], due: [{ farm: "esentai", due: 48000 }] }) === "object", true);
check("убираем номер заявки — счета не трогаем", plan(planKaspiPhoneChange({ ...base, order: { ...order, kaspiPhone: "87052223344" }, phone: "", invoices: [inv("1", "esentai", 48000, "87052223344")] })).reissue, []);

// Новый счёт взамен отменяемого проходит правило «не больше остатка»: отменяемый из расчёта исключается.
const farms = [{ farm: "esentai", amount: 48000, paidAmount: 0 }];
const sendOk = (existing: { invoiceId: string; farm: string; amount: number; phone: string; status: string }[]) =>
  kaspiSendRefusal({ role: "admin", farmConfigured: true, farm: "esentai", invoiceFarms: farms as never, orderStatus: "new", noInvoice: false, phone: "87052223344", amount: 48000, existing: existing as never });
check("пока старый счёт «отменяется», новый на всю сумму упирается в правило", has(sendOk([inv("1", "esentai", 48000, "87011111111", "cancelling")]), "уже отправлены"), true);
check("без отменяемого — проходит (так делает `issueKaspiInvoice` с `replacing`)", sendOk([]), "");

// --- Какой номер получит счёт ---------------------------------------------------------
check("свой номер заявки — первым", kaspiPhoneOfOrder({ kaspiPhone: "8 705 222 33 44", clientPhone: "+77010000000" }, { kaspiPay1: "87011111111" }), { phone: "87052223344", source: "order" });
check("нет своего — карточка, потом телефон", [kaspiPhoneOfOrder({ clientPhone: "+77010000000" }, { kaspiPay1: "", kaspiPay2: "87029999999" }), kaspiPhoneOfOrder({ clientPhone: "+7 701 000 00 00" }, null), kaspiPhoneOfOrder({ clientPhone: "8 727 111 22 33" }, null)], [
  { phone: "87029999999", source: "card" },
  { phone: "87010000000", source: "phone" },
  { phone: "", source: "" },
]);
check("бухгалтер видит номер из заявки первым в списке", kaspiPhoneOptions([["8 705 222 33 44", "номер из заявки"], ["87011111111", "Kaspi №1"], ["87052223344", "телефон заявки"]]).map((o) => [o.phone, o.label]), [
  ["87052223344", "номер из заявки, телефон заявки"],
  ["87011111111", "Kaspi №1"],
]);
check("напоминание о долге берёт номер заявки раньше карточки", suggestedKaspiPhone(["8 705 222 33 44", "87011111111"]), "87052223344");

if (fails > 0) {
  console.error(`\nНе прошло проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки пройдены");
