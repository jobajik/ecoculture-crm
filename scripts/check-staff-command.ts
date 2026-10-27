/**
 * Поручения сотрудников основному номеру (`staffCommand.ts`): разбор ответа модели, поиск клиента по имени,
 * ответ цифрой, выбор фото. Живой случай 20.10.2026: «Отправь фотографии хризантемы всех категорий и эустому
 * белого и розового цвета, клиенту Маргарита Пожарка».
 *
 *   npx tsx scripts/check-staff-command.ts
 */
import { isSelfTarget, wantsForSelf, matchTargets, parseStaffCommand, pickedNumber, pickStaffPhotos, quoteLines, quotePack, staffAskText, staffDoneText, staffQuoteText, STAFF_MAX_PHOTOS, type StaffItem, type StaffTarget } from "../src/lib/staffCommand";
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

console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
