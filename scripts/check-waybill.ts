/*
 * Накладная клиенту в WhatsApp после отгрузки (19.11.2026, владелец: «чтобы клиенту бот отправлял накладную, которую ему
 * собрали, с номенклатурой, количеством и суммой»; решения: сразу после отгрузки, на то, что реально отгрузили;
 * частями — на каждую часть).
 *
 * Стережём обе стороны. Отправим лишнее — клиент получит накладную на каждое нажатие склада, вторую накладную на ту же
 * отгрузку, накладную на вчерашнее или на заявку в наш магазин; зав. складом одной компании уйдут цены другой. Не
 * отправим нужное — отгрузка с недостачей так и останется без документа, а частичная догрузка не попадёт ни в одну
 * накладную. И цифры: сумма в документе обязана сойтись с позициями до тиына.
 *
 * Запуск: npx tsx scripts/check-waybill.ts
 */
import {
  WAYBILL_IMAGE_MAX_LINES,
  buildWaybillDoc,
  nextWaybillNumber,
  parseWaybillStatus,
  planWaybill,
  sampleWaybillDoc,
  stuckWaybillAction,
  uncoveredShipments,
  waybillAuto,
  waybillCaption,
  waybillFileName,
  waybillHourOk,
  waybillItemName,
  waybillLineOrder,
  waybillOrderRefusal,
  waybillRecipient,
  waybillSections,
  waybillSendRefusal,
  waybillSentTrace,
} from "../src/lib/waybill";
import { jpegSize, jpegToPdf } from "../src/lib/jpegPdf";
import { trimBottom, waybillCanvasHeight } from "../src/lib/waybillImage";
import { publicWaybillUrl, waybillSignatureOk } from "../src/lib/waFileSign";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const has = (v: unknown, part: string) => typeof v === "string" && v.includes(part);

const NOW = new Date("2026-11-19T10:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();
const SINCE = ago(24 * 60);

const item = (itemId: string, flowerType: string, variety: string, grade: string, quantity: number, unitPrice: number, shippedQuantity: number) => ({ itemId, flowerType, variety, grade, quantity, unitPrice, shippedQuantity });
const order = (items: ReturnType<typeof item>[], over: Record<string, unknown> = {}) => ({
  orderId: "ORD-17579CRN6Y",
  status: "shipped",
  retail: "",
  kind: "",
  direction: "",
  clientName: "Улжан",
  clientPhone: "+7 701 555 20 30",
  managerEmail: "ilyas@x.kz",
  deliveryDate: "2026-11-20",
  items,
  ...over,
});
const ship = (shipmentId: string, itemId: string, quantity: number, minutesAgo: number) => ({ shipmentId, itemId, quantity, createdAt: ago(minutesAgo) });

// --- Включено ли ----------------------------------------------------------------------
check("включено и есть дата начала", waybillAuto({ WaybillAuto: "on", WaybillSince: SINCE }), { on: true, since: SINCE });
check("включено без даты начала — выключено (слать «всё, что было» нельзя)", waybillAuto({ WaybillAuto: "on" }).on, false);
check("дата — мусор", waybillAuto({ WaybillAuto: "on", WaybillSince: "вчера" }), { on: false, since: "" });
check("выключено, пусто", [waybillAuto({ WaybillAuto: "off", WaybillSince: SINCE }).on, waybillAuto({}).on], [false, false]);

// --- Каким заявкам накладная не нужна -------------------------------------------------
check("обычная продажа — нужна", waybillOrderRefusal(order([])), "");
check("отменённая", has(waybillOrderRefusal(order([], { status: "cancelled" })), "отменена"), true);
check("наш магазин, объём на город, точка — не продажа", [{ retail: "almaty" }, { kind: "region", direction: "Астана" }, { clientName: "Пожарка" }].map((o) => has(waybillOrderRefusal(order([], o)), "не продажа")), [true, true, true]);

// --- Что отправлять сейчас ------------------------------------------------------------
const rose = item("i1", "rose", "Jana", "60", 150, 410, 150);
const eust = item("i2", "eustoma", "Alissa Pink", "70", 50, 450, 50);
const chrys = item("i3", "chrysanthemum", "Altaj", "Вторая", 200, 400, 200);
const full = order([rose, eust, chrys]);
const plan = (o: ReturnType<typeof order>, shipments: ReturnType<typeof ship>[], waybills: { shipmentIds: string[]; status: "sent" | "failed" | "skipped" | "duplicate" | "sending" }[] = [], mode: "auto" | "manual" = "auto", since = SINCE) =>
  planWaybill({ order: o, shipments, waybills, mode, since, now: NOW });

check("всё отгружено минуту назад — сразу, одной накладной", plan(full, [ship("s1", "i1", 150, 1), ship("s2", "i2", 50, 1), ship("s3", "i3", 200, 1)]), { send: ["s1", "s2", "s3"], why: "complete" });
check("отгрузок нет", plan(full, []), null);
const partRose = order([{ ...rose, shippedQuantity: 150 }, { ...eust, shippedQuantity: 0 }, { ...chrys, shippedQuantity: 0 }]);
const waitPlan = plan(partRose, [ship("s1", "i1", 150, 2)]);
check("склад отгружает по позиции: Rose Farm ещё не закончил — ждём", "wait" in (waitPlan ?? {}) && has((waitPlan as { wait: string }).wait, "18 мин"), true);
const roseDone = order([rose, eust, { ...chrys, shippedQuantity: 0 }]);
check("Rose Farm закончил, Есентай ещё нет — накладная на часть Rose Farm сразу", plan(roseDone, [ship("s1", "i1", 150, 5), ship("s2", "i2", 50, 1)]), { send: ["s1", "s2"], why: "complete" });
check("…потом Есентай — вторая накладная только на его строки", plan(full, [ship("s1", "i1", 150, 90), ship("s2", "i2", 50, 85), ship("s3", "i3", 200, 1)], [{ shipmentIds: ["s1", "s2"], status: "sent" }]), { send: ["s3"], why: "complete" });
const short = order([{ ...rose, shippedQuantity: 100 }, eust, chrys]);
check("недостача: 100 из 150, прошло 5 минут — ждём догрузки", "wait" in (plan(short, [ship("s1", "i1", 100, 5), ship("s2", "i2", 50, 5)]) ?? {}), true);
check("недостача, 20 минут тишины — накладная на то, что отгрузили", plan(short, [ship("s1", "i1", 100, 21), ship("s2", "i2", 50, 20)]), { send: ["s1", "s2"], why: "quiet" });
check("недостача по Rose Farm не держит накладную Есентая", plan(short, [ship("s1", "i1", 100, 5), ship("s3", "i3", 200, 1)]), { send: ["s3"], why: "complete" });
check("догрузили через день — накладная только на догруженное", plan(full, [ship("s1", "i1", 100, 600), ship("s4", "i1", 50, 1)], [{ shipmentIds: ["s1"], status: "sent" }]), { send: ["s4"], why: "complete" });
check("отгрузка уже в накладной — второй не будет", plan(full, [ship("s1", "i1", 150, 30)], [{ shipmentIds: ["s1"], status: "sent" }]), null);
check("…даже если та не отправилась (её повторяют кнопкой)", [plan(full, [ship("s1", "i1", 150, 30)], [{ shipmentIds: ["s1"], status: "failed" }]), plan(full, [ship("s1", "i1", 150, 30)], [{ shipmentIds: ["s1"], status: "skipped" }]), plan(full, [ship("s1", "i1", 150, 30)], [{ shipmentIds: ["s1"], status: "sending" }])], [null, null, null]);
check("«повтор» отгрузку не занимает", plan(full, [ship("s1", "i1", 150, 30)], [{ shipmentIds: ["s1"], status: "duplicate" }]), { send: ["s1"], why: "quiet" });
check("отгружено ДО включения — автомат не шлёт никогда", plan(full, [ship("s1", "i1", 150, 25 * 60)]), null);
check("старше двух суток — автомат не шлёт", plan(full, [ship("s1", "i1", 150, 49 * 60)], [], "auto", ago(100 * 60)), null);
check("без даты начала автомат не шлёт", plan(full, [ship("s1", "i1", 150, 1)], [], "auto", ""), null);
check("возврат (строка с минусом) в накладную не идёт", plan(full, [ship("s1", "i1", -50, 30)]), null);
check("строка по позиции, которой в заявке уже нет", plan(full, [ship("s9", "gone", 50, 30)]), null);
check("кнопка: всё без накладной, без оглядки на время и дату включения", plan(short, [ship("s1", "i1", 100, 25 * 60), ship("s2", "i2", 50, 1)], [], "manual"), { send: ["s1", "s2"], why: "manual" });
check("кнопка: нечего", plan(full, [ship("s1", "i1", 150, 30)], [{ shipmentIds: ["s1"], status: "sent" }], "manual"), null);
check("не продажа — ни автомат, ни кнопка", [plan(order([rose], { retail: "almaty" }), [ship("s1", "i1", 150, 1)]), plan(order([rose], { kind: "region", direction: "Семей" }), [ship("s1", "i1", 150, 1)], [], "manual")], [null, null]);
check("не вошедшие в накладные", uncoveredShipments([ship("s1", "i1", 100, 1), ship("s2", "i1", 50, 1), ship("s3", "i1", -10, 1)], [{ shipmentIds: ["s1"], status: "sent" }]).map((s) => s.shipmentId), ["s2"]);

// --- Номер ----------------------------------------------------------------------------
check("первая накладная — номер заявки", nextWaybillNumber("ORD-17579CRN6Y", []), "CRN6Y");
check("вторая и третья", [nextWaybillNumber("ORD-17579CRN6Y", [{ status: "sent" }]), nextWaybillNumber("ORD-17579CRN6Y", [{ status: "sent" }, { status: "failed" }])], ["CRN6Y-2", "CRN6Y-3"]);
check("«повтор» в счёт не идёт", nextWaybillNumber("ORD-17579CRN6Y", [{ status: "sent" }, { status: "duplicate" }]), "CRN6Y-2");

// --- Документ -------------------------------------------------------------------------
const doc = buildWaybillDoc({ order: order([chrys, rose, { ...eust, shippedQuantity: 30 }]), shipments: [ship("s3", "i3", 200, 1), ship("s1", "i1", 100, 1), ship("s1b", "i1", 50, 1), ship("s2", "i2", 30, 1), ship("x", "i2", 999, 1)], shipmentIds: ["s1", "s1b", "s2", "s3"], number: "CRN6Y", date: "2026-11-19", city: " Алматы ", manager: "Ильяс", shippedBy: "Разия" });
check("строка на позицию; две партии одного сорта складываются; Rose Farm первым", doc.lines.map((l) => [l.farm, l.name, l.quantity, l.price, l.amount]), [
  ["rose_farm", "Роза Jana, 60 см", 150, 410, 61500],
  ["rose_farm", "Эустома Alissa Pink, 70 см", 30, 450, 13500],
  ["esentai", "Хризантема Altaj, Вторая", 200, 400, 80000],
]);
check("итоги сходятся с позициями", [doc.stems, doc.amount, doc.lines.reduce((s, l) => s + l.amount, 0)], [380, 155000, 155000]);
check("осталось отгрузить — по заявке, а не по накладной", doc.restStems, 20);
check("шапка", [doc.number, doc.orderCode, doc.client, doc.city, doc.manager, doc.shippedBy, doc.deliveryDate], ["CRN6Y", "CRN6Y", "Улжан", "Алматы", "Ильяс", "Разия", "2026-11-20"]);
check("разделы по компаниям с подытогами", waybillSections(doc).map((s) => [s.label, s.lines.length, s.stems, s.amount]), [
  ["Rose Farm", 2, 180, 75000],
  ["Есентай Агро Хим", 1, 200, 80000],
]);
const frac = buildWaybillDoc({ order: order([item("i1", "rose", "Jana", "60", 15, 154.5, 15), item("i2", "rose", "Anna", "50", 7, 33.33, 7)]), shipments: [ship("s1", "i1", 15, 1), ship("s2", "i2", 7, 1)], shipmentIds: ["s1", "s2"], number: "A", date: "2026-11-19", city: "", manager: "", shippedBy: "" });
check("дробная цена: сумма до тиына, без хвостов", [frac.lines.map((l) => l.amount), frac.amount], [[2317.5, 233.31], 2550.81]);
check("хризантема Rose Farm названа просто хризантемой (компания — в заголовке раздела)", [waybillItemName({ flowerType: "chrysanthemum_rf", variety: "Zembla", grade: "Третья" }), buildWaybillDoc({ order: order([item("i1", "chrysanthemum_rf", "Zembla", "Третья", 10, 300, 10)]), shipments: [ship("s1", "i1", 10, 1)], shipmentIds: ["s1"], number: "A", date: "", city: "", manager: "", shippedBy: "" }).lines[0].farm], ["Хризантема Zembla, Третья", "rose_farm"]);
check("позиция без отгрузки в накладную не идёт", buildWaybillDoc({ order: full, shipments: [ship("s1", "i1", 150, 1)], shipmentIds: ["s1"], number: "A", date: "", city: "", manager: "", shippedBy: "" }).lines.length, 1);

// --- Подпись и файл -------------------------------------------------------------------
check("подпись: заказ отгружен", waybillCaption({ ...doc, restStems: 0 }), "Здравствуйте! Заказ № CRN6Y отгружен: 380 шт. на 155 000 ₸. Накладная на картинке.");
check("подпись: часть заказа и сколько осталось — без обещаний", waybillCaption(doc), "Здравствуйте! Отгрузили часть заказа № CRN6Y: 380 шт. на 155 000 ₸. Накладная на картинке. По заказу осталось отгрузить 20 шт.");
const long = { ...doc, lines: Array.from({ length: WAYBILL_IMAGE_MAX_LINES + 1 }, () => doc.lines[0]) };
check("короткая — картинкой, длинная — файлом PDF", [waybillFileName(doc), waybillFileName({ ...doc, number: "CRN6Y-2" }), waybillFileName(long), has(waybillCaption(long), "Накладная в файле")], ["Nakladnaya-CRN6Y.jpg", "Nakladnaya-CRN6Y-2.jpg", "Nakladnaya-CRN6Y.pdf", true]);
check("образец подписан как образец", [sampleWaybillDoc("2026-11-19").sample, has(sampleWaybillDoc("2026-11-19").client, "Образец"), sampleWaybillDoc("2026-11-19").amount], [true, true, 194000]);

// --- Кому -----------------------------------------------------------------------------
const none = new Set<string>();
const to = (o: { clientPhone?: string }, client: { phone?: string; messenger?: string } | null, over: { staff?: string[]; opted?: string[]; mode?: "auto" | "manual" } = {}) =>
  waybillRecipient({ order: o, client, staffKeys: new Set(over.staff ?? []), optedOut: new Set(over.opted ?? []), mode: over.mode ?? "auto" });
check("телефон заявки", to({ clientPhone: "+7 701 555 20 30" }, null), { phone: "77015552030" });
check("в заявке пусто — карточка клиента", to({ clientPhone: "" }, { phone: "8 705 222 33 44" }), { phone: "77052223344" });
check("городской номер и пусто — отправлять некуда", ["skip" in to({ clientPhone: "8 727 222 33 44" }, null), "skip" in to({}, null)], [true, true]);
check("номер нашего сотрудника", has((to({ clientPhone: "+7 701 555 20 30" }, null, { staff: ["7015552030"] }) as { skip: string }).skip, "сотрудника"), true);
check("просил не писать: автомат молчит, кнопка отправляет", ["skip" in to({ clientPhone: "+7 701 555 20 30" }, null, { opted: ["7015552030"] }), to({ clientPhone: "+7 701 555 20 30" }, null, { opted: ["7015552030"], mode: "manual" })], [true, { phone: "77015552030" }]);
check("часы: с 7 до 22", [6, 7, 12, 21, 22, 23, 0].map(waybillHourOk), [false, true, true, true, false, false, false]);
void none;

// --- Кто отправляет кнопкой -----------------------------------------------------------
const who = (role: string, email: string, over: Record<string, unknown> = {}, card = "") => waybillSendRefusal({ role, email, order: order([], over), cardManagerEmail: card });
check("админ, РОП, бухгалтер — любую", [who("admin", "o@x.kz"), who("sales_head", "n@x.kz"), who("accountant", "y@x.kz")], ["", "", ""]);
check("менеджер заявки и менеджер карточки — да, чужой — нет", [who("manager", "ilyas@x.kz"), who("manager", "emil@x.kz", {}, "Emil@x.kz"), has(who("manager", "emil@x.kz"), "другого менеджера")], ["", "", true]);
check("склад и офис — да", [who("warehouse", "r@x.kz"), who("office", "o@x.kz"), who("office_retail", "r@x.kz")], ["", "", ""]);
check("маркетолог, агроном, Земфира, пустая роль — нет", ["marketer", "agronomist", "leadgen", ""].map((r) => who(r, "ilyas@x.kz") !== ""), [true, true, true, true]);
check("не продажа и отменённая — никому", [who("admin", "o@x.kz", { retail: "almaty" }) !== "", who("admin", "o@x.kz", { status: "cancelled" }) !== ""], [true, true]);

// --- С какого номера ------------------------------------------------------------------
check("где переписывался последним → номер менеджера → основной", waybillLineOrder({ chatLines: ["m-emil", ""], managerLine: "m-ilyas" }), ["m-emil", "", "m-ilyas"]);
check("переписки не было — номер менеджера, потом основной", waybillLineOrder({ chatLines: [], managerLine: "m-ilyas" }), ["m-ilyas", ""]);
check("у менеджера нет номера — основной", waybillLineOrder({ chatLines: [], managerLine: "" }), [""]);
check("статус из таблицы: незнакомое — «отправляется», а не «отправлена»", [parseWaybillStatus("sent"), parseWaybillStatus(" Failed "), parseWaybillStatus(""), parseWaybillStatus("готово")], ["sent", "failed", "sending", "sending"]);

// --- Застряла в «отправляется» (19.11.2026, первый день: № YOMGH ушла клиенту, а отметка не записалась) --------------
const wb = { number: "YOMGH", orderCode: "YOMGH", phone: "77015551550", createdAt: ago(120) };
const msg = (over: Record<string, unknown>) => ({ messageId: "M1", at: ago(119), phone: "77015551550", direction: "out", type: "image", text: "", line: "m-emil", ...over });
check("след: наша запись с пометкой накладной", waybillSentTrace(wb, [msg({ text: "[накладная № YOMGH] Здравствуйте! Отгрузили часть заказа № YOMGH: 40 шт." })]), { messageId: "M1", line: "m-emil", at: ago(119) });
check("след: эхо WhatsApp без пометки — файл с подписью накладной по этой заявке", waybillSentTrace(wb, [msg({ messageId: "E1", line: "", text: "Здравствуйте! Заказ № YOMGH отгружен: 40 шт. на 12 775 ₸. Накладная на картинке." })])?.messageId, "E1");
check("наша запись главнее эха: номер сообщения и линия — из неё", waybillSentTrace(wb, [msg({ messageId: "E1", at: ago(118), text: "Здравствуйте! Заказ № YOMGH отгружен: 40 шт. Накладная на картинке." }), msg({ text: "[накладная № YOMGH] Здравствуйте!" })])?.messageId, "M1");
check("номер с «8» и номер с «7» — один и тот же клиент", waybillSentTrace({ ...wb, phone: "87015551550" }, [msg({ text: "[накладная № YOMGH] …" })])?.messageId, "M1");
check("не след: другой клиент, входящее, сообщение ДО накладной, чужая накладная, обычный текст про заказ", [
  waybillSentTrace(wb, [msg({ phone: "77015550000", text: "[накладная № YOMGH] …" })]),
  waybillSentTrace(wb, [msg({ direction: "in", text: "[накладная № YOMGH] …" })]),
  waybillSentTrace(wb, [msg({ at: ago(200), text: "[накладная № YOMGH] …" })]),
  waybillSentTrace(wb, [msg({ text: "[накладная № YOMGH-2] …" })]),
  waybillSentTrace(wb, [msg({ type: "text", text: "По заказу № YOMGH всё отгрузили, накладную пришлём" })]),
], [null, null, null, null, null]);
check("вторая накладная заявки своим следом не считает первую", waybillSentTrace({ ...wb, number: "YOMGH-2" }, [msg({ text: "[накладная № YOMGH] …" })]), null);
const st = (status: string, minutes: number, note = "") => ({ status: status as "sending", createdAt: ago(minutes), note });
check("моложе трёх минут — ещё отправляется, не трогаем", [stuckWaybillAction(st("sending", 2), false, NOW), stuckWaybillAction(st("sending", 2), true, NOW)], [null, null]);
check("застряла, след есть — отметить отправленной (второй раз не слать)", stuckWaybillAction(st("sending", 10), true, NOW), "sent");
check("застряла, следа нет — одна повторная отправка", stuckWaybillAction(st("sending", 10), false, NOW), "retry");
check("уже повторяли — больше не шлём, дальше человек", stuckWaybillAction(st("sending", 10, "повтор после обрыва"), false, NOW), "fail");
check("уже повторяли, но след появился — отправлена", stuckWaybillAction(st("sending", 10, "повтор после обрыва"), true, NOW), "sent");
check("старше суток — сама не шлёт", stuckWaybillAction(st("sending", 25 * 60), false, NOW), "fail");
check("отправленную, неотправленную и пропущенную не трогаем", [stuckWaybillAction(st("sent", 10), false, NOW), stuckWaybillAction(st("failed", 10), false, NOW), stuckWaybillAction(st("skipped", 10), true, NOW)], [null, null, null]);

// --- Ссылка, картинка, PDF ------------------------------------------------------------
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "check-secret";
const url = publicWaybillUrl("https://site.kz/", "WB-261119-ABCDE", "Nakladnaya-CRN6Y.jpg");
const sig = new URL(url).searchParams.get("t");
check("ссылка на файл подписана", [url.startsWith("https://site.kz/api/waybill/WB-261119-ABCDE/Nakladnaya-CRN6Y.jpg?t="), waybillSignatureOk("WB-261119-ABCDE", sig)], [true, true]);
check("подпись чужой накладной и пустая — не подходят", [waybillSignatureOk("WB-261119-OTHER", sig), waybillSignatureOk("WB-261119-ABCDE", ""), waybillSignatureOk("WB-261119-ABCDE", null)], [false, false, false]);
check("холст с запасом растёт от числа строк", waybillCanvasHeight(long) > waybillCanvasHeight(doc), true);
// Картинка 4×10: верхние 3 строки тёмные, остальное фон.
const px = new Uint8Array(4 * 10 * 4).fill(255);
for (let i = 0; i < 4 * 3 * 4; i += 4) px[i] = px[i + 1] = px[i + 2] = 20;
check("пустой низ срезается, поле остаётся", [trimBottom(px, 4, 10, 2), trimBottom(px, 4, 10, 100), trimBottom(new Uint8Array(4 * 10 * 4).fill(255), 4, 10, 2)], [5, 10, 3]);
// Минимальный JPEG-заголовок с размером 1080×1448 (SOI, APP0, SOF0).
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0xa8, 0x04, 0x38, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
check("размер JPEG из заголовка", [jpegSize(jpg), jpegSize(Buffer.from("не картинка"))], [{ height: 1448, width: 1080 }, null]);
const pdf = jpegToPdf(jpg, 1080, 1448).toString("latin1");
const xrefAt = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
check("PDF: заголовок, одна страница по пропорциям картинки, таблица ссылок на месте", [pdf.startsWith("%PDF-1.4"), pdf.includes("/MediaBox [0 0 595.28 798.12]"), pdf.includes("/Filter /DCTDecode"), pdf.slice(xrefAt, xrefAt + 4), pdf.trimEnd().endsWith("%%EOF")], [true, true, true, "xref", true]);
const off4 = Number(pdf.slice(xrefAt).split("\n")[6].slice(0, 10));
check("PDF: смещение объекта картинки верное", pdf.slice(off4, off4 + 7), "4 0 obj");

if (fails > 0) {
  console.error(`\nНе прошло проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки пройдены");
