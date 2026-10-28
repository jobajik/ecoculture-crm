/**
 * Поручения сотрудников основному номеру (`staffCommand.ts`): разбор ответа модели, поиск клиента по имени,
 * ответ цифрой, выбор фото. Живой случай 20.10.2026: «Отправь фотографии хризантемы всех категорий и эустому
 * белого и розового цвета, клиенту Маргарита Пожарка».
 *
 *   npx tsx scripts/check-staff-command.ts
 */
import {
  dropRecipients,
  dueReminders,
  exclusionNames,
  exclusionReplyText,
  isSelfTarget,
  latestClientOrder,
  matchTargets,
  muteDoneText,
  parseReminders,
  parseStaffCommand,
  pickedNumber,
  pickStaffPhotos,
  quoteLines,
  quotePack,
  reminderConfirmText,
  reminderTime,
  reminderWhen,
  staffAskText,
  staffDoneText,
  staffOrderText,
  staffQuoteText,
  STAFF_MAX_PHOTOS,
  STAFF_OTHER_TEXT,
  wantsForSelf,
  type StaffItem,
  type StaffOrderView,
  type StaffTarget,
} from "../src/lib/staffCommand";
import { priceKey, type PriceRow } from "../src/lib/priceList";
import { broadcastCount, isNoText, isYesText, parseStaffBroadcastPlan, pickBroadcastContacts, staffBroadcastText, STAFF_BROADCAST_MAX, type ContactCandidate } from "../src/lib/staffBroadcast";
import { focusOffers } from "../src/lib/staffBroadcastRunner";
import type { BotPhoto } from "../src/lib/botPhotos";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    ждали: ${JSON.stringify(expected)}\n    вышло: ${JSON.stringify(actual)}`}`);
}

// --- Разбор ответа модели
const cmd = parseStaffCommand({
  intent: "send",
  client: "Маргарита Пожарка",
  phone: "",
  items: [
    { flowerType: "chrysanthemum", variety: "", grade: "", many: true, quantity: 0, kind: "" },
    { flowerType: "eustoma", variety: "Alissa White", grade: "", many: false, quantity: 0, kind: "" },
    { flowerType: "eustoma", variety: "Alissa Pink", grade: "", many: false, quantity: 0, kind: "" },
    { flowerType: "tulip", variety: "X", grade: "", many: false, quantity: 0, kind: "" },
  ],
  text: "",
});
check("поручение: отправить", cmd.intent, "send");
check("незнакомый цветок отброшен", cmd.items.length, 3);
check("непонятный intent → none", parseStaffCommand({ intent: "hack" }).intent, "none");
check("номер — только цифры", parseStaffCommand({ intent: "send", phone: "+7 (708) 665-71-72" }).phone, "77086657172");

// --- Кому
const t = (phone: string, name: string, kind: string, managerEmail = "", lastAt = ""): StaffTarget => ({ phone, name, kind, managerEmail, lastAt });
const cands = [
  { text: "Маргарита Алматы", target: t("77023535517", "Маргарита", "клиент", "ilyas@x") },
  { text: "Маргарита Турксиб Алматы", target: t("77474270064", "Маргарита Турксиб", "клиент", "emil@x") },
  { text: "Пожарка Алматы", target: t("77078490419", "Пожарка", "клиент", "sayat@x") },
  { text: "Маргарита", target: t("77086657172", "Маргарита", "лид", "emil@x", "2026-10-20T15:40:00Z") },
  { text: "Маргарита Пожарка", target: t("77086657172", "Маргарита Пожарка", "лид", "emil@x", "2026-10-21T04:35:00Z") },
  { text: "Маргарита Пожарка", target: t("77086657172", "Маргарита Пожарка", "WhatsApp", "", "2026-10-21T04:35:00Z") },
  { text: "Евгения Пожарка", target: t("77026121425", "Евгения Пожарка", "лид") },
];
const found = matchTargets("Маргарита Пожарка", cands, "emil@x");
check("«Маргарита Пожарка» — один номер", found.map((x) => x.phone), ["77086657172"]);
check("имя — из карточки, а не из WhatsApp", found[0].kind, "лид");
check("падеж: «Маргарите Пожарке» тоже находит", matchTargets("Маргарите Пожарке", cands).map((x) => x.phone), ["77086657172"]);
const many = matchTargets("Маргарита", cands, "emil@x");
check("«Маргарита» — несколько, свои выше", many.map((x) => x.phone).slice(0, 2), ["77086657172", "77474270064"]);
check("пустой запрос — никого", matchTargets("", cands), []);
check("список для выбора — цифрами", staffAskText("Маргарита", many).split("\n")[2], "1. Маргарита Пожарка · …7172 (лид)");

check("ответ «2»", pickedNumber("2"), 2);
check("ответ «2.»", pickedNumber(" 2. "), 2);
check("ответ «номер 3»", pickedNumber("номер 3"), 3);
check("текст — не цифра", pickedNumber("2 сорт есть?"), 0);

// --- Фото
const ph = (id: string, patch: Partial<BotPhoto>): BotPhoto =>
  ({ photoId: id, fileId: `F-${id}`, fileName: `${id}.jpg`, flowerType: "chrysanthemum", variety: "", grade: "", caption: `подпись ${id}`, active: true, sentCount: 0, lastSentAt: "", createdAt: "", kind: "", ...patch }) as BotPhoto;
const photos = [
  ph("altaj", { variety: "Altaj" }),
  ph("bacardy", { variety: "Bacardy" }),
  ph("chik", { variety: "Chik" }),
  ph("yellow", { variety: "Altay yellow" }),
  ph("generic", {}),
  ph("info", { variety: "Altaj", kind: "info" }),
  ph("w1", { flowerType: "eustoma", variety: "Alissa White" }),
  ph("w2", { flowerType: "eustoma", variety: "Alissa White" }),
  ph("w3", { flowerType: "eustoma", variety: "Alissa White" }),
  ph("p1", { flowerType: "eustoma", variety: "Alissa Pink" }),
  ph("off", { flowerType: "eustoma", variety: "Alissa Pink", active: false }),
];
const pick = pickStaffPhotos(photos, cmd.items);
const ids = pick.picked.map((p) => p.photoId);
check("хризантема «все категории» — 3 живых разных сорта и инфографика категорий", ids.slice(0, 4), ["altaj", "bacardy", "chik", "info"]);
check("белая эустома — 2 фото", ids.filter((i) => i.startsWith("w")).length, 2);
check("розовая — одно (второе выключено)", ids.filter((i) => i.startsWith("p")), ["p1"]);
check("ничего не пропало", pick.missing, []);
check("инфографика — только при «все категории», и последней в своём пункте",
  pickStaffPhotos([ph("info", { variety: "Altaj", kind: "info" }), ph("altaj", { variety: "Altaj" })], [{ flowerType: "chrysanthemum", variety: "", grade: "", many: true, quantity: 0, kind: "" }]).picked.map((p) => p.photoId),
  ["altaj", "info"]);
check("о сорте без «всех» — инфографика не идёт", pickStaffPhotos(photos, [{ flowerType: "chrysanthemum", variety: "Bacardy", grade: "", many: false, quantity: 0, kind: "" }]).picked.map((p) => p.photoId), ["bacardy"]);
check("нет фото — в «нет в CRM»", pickStaffPhotos(photos, [{ flowerType: "rose", variety: "", grade: "Мини-микс", many: false, quantity: 0, kind: "" }]).missing, ["Роза, Мини-микс"]);
const lots = Array.from({ length: 30 }, (_, i) => ph(`r${i}`, { flowerType: "rose", variety: `V${i}` }));
check("не больше предела за поручение", pickStaffPhotos(lots, Array.from({ length: 8 }, () => ({ flowerType: "rose", variety: "", grade: "", many: true, quantity: 0, kind: "" }))).picked.length, STAFF_MAX_PHOTOS);

check(
  "отчёт сотруднику",
  staffDoneText({ name: "Маргарита Пожарка", phone: "77086657172", via: "номера Эмиля", sent: ["Хризантема Altaj"], missing: [], text: false }),
  "Отправил Маргарита Пожарка (…7172) с номера Эмиля:\n• Хризантема Altaj"
);

// --- Себе (22.10.2026, владелец: «Скинь фото джумилии» → «Не нашёл клиента «без имени»», «Мне скинь.» — тишина)
check("«Мне скинь.» — себе", isSelfTarget("Мне скинь."), true);
check("«скиньте мне» — себе", isSelfTarget("скиньте мне"), true);
check("«мне» — себе", isSelfTarget("мне"), true);
check("«маған» — себе", isSelfTarget("маған"), true);
check("«Маргарите» — не себе", isSelfTarget("Маргарите"), false);
check("«Почему не отправляешь фотки?» — не себе", isSelfTarget("Почему не отправляешь фотки?"), false);
check("«Скинь фото джумилии» без адресата — себе", wantsForSelf({ client: "", phone: "" }, "Скинь фото джумилии"), true);
check("модель сказала «мне» — себе", wantsForSelf({ client: "мне", phone: "" }, "Скинь мне Altaj"), true);
check("«отправь клиенту фото» без имени — переспросить", wantsForSelf({ client: "", phone: "" }, "Отправь клиенту фото Altaj"), false);
check("назван клиент — не себе", wantsForSelf({ client: "Маргарита Пожарка", phone: "" }, "Отправь Маргарите Пожарка"), false);
check("назван номер — не себе", wantsForSelf({ client: "", phone: "77011234567" }, "скинь на 77011234567"), false);

// --- Посчитать стоимость (23.10.2026, Ильгар: кустовые 60 см 40 шт (20 ярко-розовых, 20 нежных), Алтай 3 кат 15,
// эустома классическая 30 (15 белых, 15 розовых), одноголовые 1 сорт 60 см 30 — «можешь посчитать сколько выйдет»)
const q = parseStaffCommand({
  intent: "quote",
  client: "",
  phone: "",
  text: "",
  items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "3 кат", many: false, quantity: 15.4, kind: "" }, { flowerType: "rose", variety: "", grade: "60", many: false, quantity: 30, kind: "boom" }],
});
check("quote разбирается", q.intent, "quote");
check("количество — целое, вид — из списка", q.items.map((i) => [i.quantity, i.kind, i.color]), [[15, "", ""], [30, "", ""]]);

const priceRows: PriceRow[] = [
  { date: "2026-10-01", flowerType: "rose", variety: "", grade: "60", price: 250 },
  { date: "2026-10-01", flowerType: "rose", variety: "Jana", grade: "60", price: 300 },
  { date: "2026-10-01", flowerType: "rose", variety: "Red Naomi", grade: "60", price: 280 },
  { date: "2026-10-01", flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", price: 160 },
  { date: "2026-10-01", flowerType: "eustoma", variety: "", grade: "Стандарт", price: 500 },
];
const priceMap = new Map(priceRows.map((r) => [priceKey(r.flowerType, r.variety, r.grade), r]));
const stockRows = [
  { flower: "rose", variety: "Jana", grade: "60", qty: 300 },
  { flower: "rose", variety: "Jumilia", grade: "60", qty: 900 },
  { flower: "chrysanthemum", variety: "Altaj", grade: "Третья", qty: 5000 },
  { flower: "eustoma", variety: "Alissa White", grade: "Стандарт", qty: 12 },
  { flower: "eustoma", variety: "Alissa Pink", grade: "Стандарт", qty: 200 },
];
const it = (p: Partial<StaffItem>): StaffItem => ({ flowerType: "rose", variety: "", grade: "", many: false, quantity: 0, kind: "", ...p });
const ilgar = quoteLines(
  [
    it({ kind: "spray", grade: "60 см", quantity: 40 }),
    it({ flowerType: "chrysanthemum", variety: "altaj", grade: "3 категория", quantity: 15 }),
    it({ flowerType: "eustoma", variety: "Alissa White", grade: "Стандарт", quantity: 15 }),
    it({ flowerType: "eustoma", variety: "Alissa Pink", grade: "Стандарт", quantity: 15 }),
    it({ kind: "single", grade: "60", quantity: 30 }),
  ],
  priceMap,
  stockRows
);
check("кустовая без сорта — цена кустового сорта со склада", [ilgar[0].price, ilgar[0].pack, ilgar[0].stock], [300, 15, 300]);
check("Алтай 3 кат — Третья, сорт как на складе", [ilgar[1].label, ilgar[1].price], ["Хризантема Altaj, Третья", 160]);
check("эустома — общая цена, пачка 10", [ilgar[2].price, ilgar[2].pack, ilgar[2].stock], [500, 10, 12]);
check("одноголовая без сорта — кустовые не в счёт, общая цена", [ilgar[4].price, ilgar[4].others], [250, []]);
const quote = staffQuoteText(ilgar);
check("строка позиции", quote.includes("• Роза кустовая, 60 см — 40 шт. × 300 ₸ = 12 000 ₸\n   пачками по 15: 45 шт. — 13 500 ₸"), true);
check("итого", quote.includes("Итого: *36 900 ₸*"), true);
check("целыми пачками", quote.includes("Целыми пачками: *43 400 ₸*"), true);
check("склад меньше — сказано", quote.includes("• Эустома Alissa White, Стандарт — свободно ~12 шт."), true);
check("клиенту — без склада", staffQuoteText(ilgar, true).includes("складе"), false);

const naomi = quoteLines([it({ grade: "60", quantity: 30 })], priceMap, [...stockRows, { flower: "rose", variety: "Red Naomi", grade: "60", qty: 100 }]);
check("сорт не назван, цены разные — основная по складу, остальные с сортами", [naomi[0].price, naomi[0].others], [250, [{ price: 280, varieties: ["Red Naomi"] }, { price: 300, varieties: ["Jana"] }]]);
check("другие сорта — строкой", staffQuoteText(naomi).includes("   это основная цена; другие сорта: Red Naomi — 280 ₸; Jana — 300 ₸"), true);
check("итог — по основной", staffQuoteText(naomi).includes("Итого: *7 500 ₸*"), true);
check("цвет без сорта — в строке", quoteLines([it({ kind: "spray", grade: "60", quantity: 15, color: "ярко-розовые" })], priceMap, stockRows)[0].label, "Роза кустовая (ярко-розовые), 60 см");
check("нет количества — в «не посчитал»", staffQuoteText(quoteLines([it({ grade: "60" })], priceMap, stockRows)).includes("не понял, сколько штук"), true);
check("нет цены — так и сказано", staffQuoteText(quoteLines([it({ flowerType: "chrysanthemum", variety: "Chik", grade: "Первая", quantity: 10 })], priceMap, stockRows)).includes("нет цены в прайсе"), true);
check("кустовые: пионовидные спрей тоже в счёт, пачка — по сортам основной цены",
  quoteLines([it({ kind: "spray", grade: "60", quantity: 20 })], priceMap, [...stockRows, { flower: "rose", variety: "Misty Bubbles", grade: "60", qty: 50 }]).map((l) => [l.price, l.pack, l.others.length]),
  [[300, 15, 1]]);
check("одноголовые: Love Lydia (спрей) не в счёт", quoteLines([it({ kind: "single", grade: "60", quantity: 30 })], priceMap, [...stockRows, { flower: "rose", variety: "Love Lydia", grade: "60", qty: 5000 }])[0].others, []);
check("пачка: известная важнее вида", [quotePack({ flowerType: "rose", kind: "spray" }, 80), quotePack({ flowerType: "rose", kind: "peony" }, null), quotePack({ flowerType: "chrysanthemum", kind: "" }, null)], [80, 10, null]);

// --- Рассылка по просьбе менеджера (27.10.2026: «Сделай сегодня рассылку 20-ти клиентам из контактов, с упором на продажи
// хризантемы 3 категории. С прикладыванием фото»)
const bc = parseStaffCommand({ intent: "broadcast", client: "", phone: "", text: "", count: 20.4, photo: true, items: [{ flowerType: "chrysanthemum", variety: "", grade: "Третья", many: false, quantity: 0, kind: "", color: "" }] });
check("broadcast разбирается: сколько, фото, позиция", [bc.intent, bc.count, bc.photo, bc.items[0].grade], ["broadcast", 20, true, "Третья"]);
check("«без фото» — false, остальное — с фото", [parseStaffCommand({ intent: "broadcast", photo: false }).photo, parseStaffCommand({ intent: "broadcast" }).photo], [false, true]);
check("сколько: не назвал — 20, много — предел", [broadcastCount(0), broadcastCount(15), broadcastCount(200)], [20, 15, STAFF_BROADCAST_MAX]);
check("«ДА» и «НЕТ»", [isYesText("Да"), isYesText("да, запускай!"), isYesText("иә"), isYesText("да нет наверное подумаю ещё"), isNoText("Нет"), isNoText("не надо"), isNoText("нет цены?")], [true, true, true, false, true, true, false]);
check("план старше 3 часов — забыт", [!!parseStaffBroadcastPlan(JSON.stringify({ at: new Date().toISOString(), recipients: [] })), parseStaffBroadcastPlan(JSON.stringify({ at: new Date(Date.now() - 4 * 3600000).toISOString(), recipients: [] }))], [true, null]);

const nowB = new Date("2026-10-27T05:00:00Z");
const cand = (key: string, p: Partial<ContactCandidate>): ContactCandidate => ({ key, phone: `7701${key}`, name: key, kind: "client", refId: key, managerEmail: "m@x", lastInAt: "2026-10-20T10:00:00Z", boughtFocus: false, closed: "", ...p });
const exCtx = {
  now: nowB,
  staff: new Set(["staff1"]),
  optedOut: new Set(["stop1"]),
  facts: new Map([["talk1", { lastAt: "2026-10-27T03:00:00Z", lastDirection: "in" as const, line: "", lastInAt: "2026-10-27T03:00:00Z", lastInText: "" }]]),
  sent: new Map([["bc1", { lastSentAt: "2026-10-24T08:00:00Z", leadReminders: [] }]]),
};
const picked = pickBroadcastContacts(
  [
    cand("old", { lastInAt: "2026-10-01T10:00:00Z" }),
    cand("buyer", { boughtFocus: true, lastInAt: "2026-09-01T10:00:00Z" }),
    cand("fresh", { lastInAt: "2026-10-25T10:00:00Z" }),
    cand("never", { lastInAt: "" }),
    cand("closed", { closed: "лид закрыт" }),
    cand("staff1", {}),
    cand("stop1", {}),
    cand("talk1", {}),
    cand("bc1", {}),
  ],
  exCtx,
  2
);
check("тёплые: брал позицию — первым, потом недавние; предел", picked.take.map((c) => c.key), ["buyer", "fresh"]);
check("не берём: не писал, закрыт, сотрудник, отписался, говорили меньше суток, рассылка за неделю", Object.keys(picked.skipped).length, 6);

const offersB = focusOffers(
  [{ flowerType: "chrysanthemum", variety: "", grade: "3 кат", many: false, quantity: 0, kind: "" }],
  [
    { flower: "chrysanthemum", variety: "Altaj", grade: "Третья", qty: 3000 },
    { flower: "chrysanthemum", variety: "Chik", grade: "Третья", qty: 800 },
    { flower: "chrysanthemum", variety: "Bacardy", grade: "Третья", qty: 40 },
    { flower: "chrysanthemum", variety: "Altaj", grade: "Первая", qty: 900 },
  ],
  (f, v) => (v === "Chik" ? 250 : 270)
);
check("упор на 3 категорию — два самых больших сорта со склада, мелкие остатки нет", offersB.map((o) => `${o.variety} ${o.grade} ${o.price}`), ["Altaj Третья 270", "Chik Третья 250"]);
const btext = staffBroadcastText({ manager: "Ильяс", offers: offersB, label: (o) => `Хризантема ${o.variety}, ${o.grade}` });
check("текст: от менеджера, цены, один вопрос", [btext.startsWith("Здравствуйте, {имя}! Это Ильяс, Ecoculture."), btext.includes("• Хризантема Altaj, Третья — *270 ₸*"), (btext.match(/\?/g) || []).length], [true, true, 1]);
check("регион — фура, не «завтра»", staffBroadcastText({ manager: "Салтанат", offers: offersB, label: (o) => o.variety, shipDay: "понедельник, 02.11" }).includes("ближайшей фурой — понедельник, 02.11"), true);

// --- Новые поручения (28.10.2026, владелец со снимками чата: «Напиши клиенту Сабина Междуречинск заказ который она
// заказала», «Напомни мне утром внести заявку Баглана», «Не пиши сообщения клиенту Лешка Оранж» — бот отвечал
// «пока умею…»; «Вот эти просьбы помощника ты должен научиться выполнять»)
console.log("\n— Заказ клиента");
check("intent send_order", parseStaffCommand({ intent: "send_order", client: "Сабина Междуреченск" }).intent, "send_order");
check("intent remind с временем и текстом", parseStaffCommand({ intent: "remind", remindAt: "2026-10-29T09:00", remindText: "внести заявку Баглана" }), {
  intent: "remind", client: "", phone: "", items: [], text: "", count: 0, photo: true, remindAt: "2026-10-29T09:00", remindText: "внести заявку Баглана",
});
check("intent mute / unmute", [parseStaffCommand({ intent: "mute", client: "Лешка Оранж" }).intent, parseStaffCommand({ intent: "unmute" }).intent], ["mute", "unmute"]);
check("подсказка «пока умею» называет новые поручения", [STAFF_OTHER_TEXT.includes("его заказ"), STAFF_OTHER_TEXT.includes("напомнить"), STAFF_OTHER_TEXT.includes("не писать")], [true, true, true]);

const ord = (id: string, createdAt: string, extra: Partial<StaffOrderView> = {}): StaffOrderView => ({
  orderId: id, createdAt, clientId: "c1", clientPhone: "+77015550001", deliveryDate: "2026-10-29", status: "new", totalAmount: 29000, paidAmount: 0,
  items: [{ flowerType: "chrysanthemum", variety: "Altaj", grade: "Первая", quantity: 50, unitPrice: 580 }], ...extra,
});
const now = new Date("2026-10-28T12:00:00Z");
const orders = [
  ord("ORD-1", "2026-10-20T08:00:00Z"),
  ord("ORD-2", "2026-10-27T08:00:00Z"),
  ord("ORD-3", "2026-10-28T08:00:00Z", { status: "cancelled" }),
  ord("ORD-old", "2026-08-01T08:00:00Z"),
  ord("ORD-other", "2026-10-28T09:00:00Z", { clientId: "c2", clientPhone: "+77015550002" }),
  ord("ORD-phone", "2026-10-26T08:00:00Z", { clientId: "", clientPhone: "+77015550001" }),
];
check("последняя живая заявка клиента по карточке (отменённая и чужая — нет)", latestClientOrder(orders, { phone: "77015550001", clientId: "c1" }, now)?.orderId, "ORD-2");
check("по телефону — заявка без карточки тоже находится", latestClientOrder(orders, { phone: "87015550001" }, now)?.orderId, "ORD-2");
check("старше 60 дней — нет", latestClientOrder([ord("ORD-old", "2026-08-01T08:00:00Z")], { phone: "77015550001", clientId: "c1" }, now), null);
const otext = staffOrderText({ code: "800XU", order: ord("ORD-2", "2026-10-27T08:00:00Z", { paidAmount: 10000 }), itemName: (i) => `Хризантема ${i.variety}, ${i.grade}` });
check("текст заказа: номер, позиция, итог, доставка, остаток", [otext.includes("*№800XU* от 27.10"), otext.includes("• Хризантема Altaj, Первая — 50 шт. × 580 ₸"), otext.includes("Итого: *29 000 ₸*"), otext.includes("Доставка: 29.10"), otext.includes("Получено 10 000 ₸, остаток 19 000 ₸")], [true, true, true, true, true]);
check("оплачено целиком — так и пишем", staffOrderText({ code: "X", order: ord("ORD-2", "2026-10-27T08:00:00Z", { paidAmount: 29000 }), itemName: () => "x" }).includes("Оплата получена"), true);

console.log("\n— Напоминания");
check("время модели в будущем — как есть", reminderTime("2026-10-29T09:00", "2026-10-28T22:56"), "2026-10-29T09:00");
check("названное время сегодня уже прошло — завтра в то же время", reminderTime("2026-10-28T15:00", "2026-10-28T22:56"), "2026-10-29T15:00");
check("время не понято (пусто) вечером — завтра 09:00", reminderTime("", "2026-10-28T22:56"), "2026-10-29T09:00");
check("время не понято ночью до 9 — сегодня 09:00", reminderTime("мусор", "2026-10-29T06:10"), "2026-10-29T09:00");
check("«завтра / сегодня в …» словами", [reminderWhen("2026-10-29T09:00", "2026-10-28T22:56"), reminderWhen("2026-10-28T23:30", "2026-10-28T22:56"), reminderWhen("2026-11-02T09:00", "2026-10-28T22:56")], ["завтра в 09:00", "сегодня в 23:30", "02.11 в 09:00"]);
const rem = { id: "r1", phone: "77015550009", email: "e@x", name: "Эмиль", at: "2026-10-29T09:00", text: "внести заявку Баглана", createdAt: "" };
check("подтверждение сотруднику", reminderConfirmText(rem, "2026-10-28T22:56"), "Напомню завтра в 09:00: внести заявку Баглана.");
check("список: мусор не ломает, без телефона — вон", parseReminders(JSON.stringify([rem, { at: "x" }, 5])).length, 1);
check("список: не JSON — пусто", parseReminders("{"), []);
check("чей час настал — до минуты включительно", dueReminders([rem, { ...rem, id: "r2", at: "2026-10-29T09:30" }], "2026-10-29T09:05").map((r) => r.id), ["r1"]);

console.log("\n— Не пиши клиенту");
check("ответ сотруднику: что именно выключено и как снять", muteDoneText("Лешка Оранж", "77015550003", true).includes("Снять: «можно снова писать Лешка Оранж»"), true);
check("снять запрет", muteDoneText("Лешка Оранж", "77015550003", false), "Хорошо, Лешка Оранж (…0003) снова пишу как обычно.");

console.log("\n— Ответ на план рассылки списком имён");
const exLive = exclusionNames("Нет, Наталья, Жамал, Акмарал, Бота, Нурдос, Дана Романтик, Фарид, Светлана на Правде и ещё 1. Этим клиентам нет");
check("живой ответ: имена из строки плана и «ещё 1»", exLive, { names: ["Наталья", "Жамал", "Акмарал", "Бота", "Нурдос", "Дана Романтик", "Фарид", "Светлана на Правде"], more: 1 });
check("«да, кроме Фарида и Боты»", exclusionNames("Да, кроме Фарида и Боты"), { names: ["Фарида", "Боты"], more: 0 });
check("«без Натальи.»", exclusionNames("без Натальи."), { names: ["Натальи"], more: 0 });
check("просто «нет» — не правка списка", exclusionNames("Нет"), { names: [], more: 0 });
check("не ответ на план вовсе", exclusionNames("Скинь фото Altaj Маргарите"), { names: [], more: 0 });
const recs = ["Наталья", "Жамал", "Акмарал", "Бота", "Нурдос", "Дана", "Фарид", "Светлана", "Айгерим"].map((name, i) => ({ name, phone: `7701555000${i}` }));
const live = dropRecipients(recs, exLive.names, exLive.more);
check("живой ответ: убраны все девять — и «ещё 1» тоже", [live.kept.length, live.removed.length], [0, 9]);
check("«Дана Романтик» нашла «Дана», «Светлана на Правде» — «Светлана»", live.removed.some((r) => r.name === "Дана") && live.removed.some((r) => r.name === "Светлана"), true);
const part = dropRecipients(recs, ["Фарида", "Боты"]);
check("падеж: «Фарида», «Боты» → Фарид и Бота, остальные остались", [part.removed.map((r) => r.name), part.kept.length], [["Бота", "Фарид"], 7]);
check("никого не нашёл — ничего не убрал", dropRecipients(recs, ["Зульфия"]).removed.length, 0);
check("ответ: убрал, не нашёл, осталось, ждёт ДА", exclusionReplyText({ removed: ["Фарид"], notFound: ["Зульфия"], left: 8, run: false }), "Убрал 1: Фарид.\nНе нашёл в списке: Зульфия.\nОсталось *8*. Ответьте *ДА* — запущу, *НЕТ* — не запускаю.");
check("ответ: никого не осталось", exclusionReplyText({ removed: ["Фарид"], notFound: [], left: 0, run: false }), "Убрал 1: Фарид.\nНикого не осталось — рассылку не запускаю.");

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
