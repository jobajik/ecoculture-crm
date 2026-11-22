/*
 * Регионы: директор города, заказ на фуру, приёмка (17.11.2026, владелец: «хотим подключить директоров региона
 * Караганда, Астана, Семей и Усть-Каменогорск, где будем отслеживать стоки, делать заказ на эти регионы»).
 *
 * Стережём обе стороны. Пропустим лишнее — менеджер без города откроет чужой склад и деньги, приёмка положит на склад
 * города больше, чем отгружено, или дважды одно и то же, старые отгрузки Астаны (уже лежащие на складе) придут второй
 * раз. Откажем зря — директор не подаст заказ и не примет фуру, а цветок так и останется «в пути».
 *
 * Запуск: npx tsx scripts/check-region-truck.ts
 */
import {
  REGION_ACCEPT_FROM,
  buildTruckOrders,
  cityClientOrders,
  cityMoney,
  nextTruckDay,
  pendingReceipt,
  planTruckReceipt,
  regionAccess,
  regionHome,
  regionSeat,
  retailCardsOf,
  setRegionDirector,
  splitTruckLines,
  truckCancelRefusal,
  truckKindOf,
  truckOrderRefusal,
  type ReceiptPlan,
} from "../src/lib/regionTruck";
import { REGION_STORES, isRegionStore, normalizeStore, regionStoreForCity, storeGenitive, storeLabel, shipStoreRefusal, storeOfRole } from "../src/lib/officeStore";
import { parseManagerProfiles } from "../src/lib/managerProfile";
import { regionTabsFor } from "../src/lib/regionTabs";
import { navLinksFor } from "../src/components/navLinks";
import { canOpen } from "../src/lib/access";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const has = (v: unknown, part: string) => typeof v === "string" && v.includes(part);
const plan = (p: ReceiptPlan | string): ReceiptPlan => {
  if (typeof p === "string") throw new Error(`ждали план, получили отказ: ${p}`);
  return p;
};

// --- Склады городов ---------------------------------------------------------------------
check("четыре склада регионов", REGION_STORES.map((r) => r.label), ["Астана", "Караганда", "Семей", "Усть-Каменогорск"]);
check("город → склад: написания", ["Караганда", "г. Караганды", "Қарағанды", "Семей", "Семипалатинск", "Усть-Каменогорск", "усть каменогорск", "Өскемен", "Оскемен", "Астана", "Нур-Султан"].map(regionStoreForCity), [
  "karaganda",
  "karaganda",
  "karaganda",
  "semey",
  "semey",
  "ust_kamenogorsk",
  "ust_kamenogorsk",
  "ust_kamenogorsk",
  "ust_kamenogorsk",
  "astana",
  "astana",
]);
check("похожий и чужой город — не склад", ["Алматы", "Каракол", "Семёновка", "Усть-Кут", "", "РФ", "Киргизия"].map(regionStoreForCity), ["", "", "", "", "", "", ""]);
check("направления «объёма на город» совпадают с подписями складов", REGION_STORES.map((r) => regionStoreForCity(r.label) === r.code), [true, true, true, true]);
check("код склада из таблицы: знакомый остаётся, чужой — основной", ["karaganda", "SEMEY ", "ust_kamenogorsk", "moscow", ""].map(normalizeStore), ["karaganda", "semey", "ust_kamenogorsk", "", ""]);
check("подпись и родительный падеж", [storeLabel("semey"), storeGenitive("semey"), storeGenitive("ust_kamenogorsk"), storeGenitive("")], ["Семей", "Семея", "Усть-Каменогорска", "Основной склад"]);
check("склад региона — региональный, офис и основной — нет", [isRegionStore("karaganda"), isRegionStore("office"), isRegionStore("")], [true, false, false]);
check("менеджер Караганды ведёт склад Караганды и отгружает только его заявки", [storeOfRole("manager", "karaganda"), shipStoreRefusal("manager", "karaganda", "karaganda"), has(shipStoreRefusal("manager", "astana", "karaganda"), "Астана")], [
  "karaganda",
  "",
  true,
]);

// --- Кто что может ----------------------------------------------------------------------
const director = { role: "manager", store: "karaganda", director: true };
const keeper = { role: "manager", store: "astana", director: false };
const plain = { role: "manager", store: "", director: false };
const A = (actor: { role: string; store?: string; director?: boolean }, store: string) => {
  const a = regionAccess(actor, store);
  return [a.view, a.keeper, a.order, a.accept, a.money, a.all].map((v) => (v ? 1 : 0)).join("");
};
check("директор в своём городе: склад, заказ, приёмка, деньги", A(director, "karaganda"), "111110");
check("директор в чужом городе — ничего", A(director, "semey"), "000000");
// С 22.11.2026 заказ на фуру подаёт любой менеджер города (владелец: «интерфейс, где они могут делать заказ на следующую фуру»).
check("менеджер города без флага главного: склад, заказ и приёмка, без денег", A(keeper, "astana"), "111100");
check("менеджер без города — ничего", A(plain, "astana"), "000000");
check("флаг директора без города ничего не даёт", A({ role: "manager", store: "", director: true }, "karaganda"), "000000");
check("администратор — всё, во всех городах", [A({ role: "admin" }, "astana"), A({ role: "admin" }, "ust_kamenogorsk")], ["111111", "111111"]);
check("РОП: смотрит, подаёт заказ, видит деньги; склад не ведёт и не принимает", A({ role: "sales_head" }, "semey"), "101011");
check("зав. складом: только смотрит, денег не видит", A({ role: "warehouse" }, "semey"), "100001");
check("бухгалтер, розница, маркетолог, пустая роль — ничего", ["accountant", "retail_regions", "marketer", "office", ""].map((role) => A({ role }, "astana")), ["000000", "000000", "000000", "000000", "000000"]);
check("не город — ничего даже администратору", [A({ role: "admin" }, "office"), A({ role: "admin" }, ""), A({ role: "admin" }, "moscow")], ["000000", "000000", "000000"]);
check("куда ведёт «Регионы»: директор — свой город, владелец — все", [regionHome(director), regionHome({ role: "admin" }), regionHome(plain)], [
  { all: false, own: "karaganda" },
  { all: true, own: "" },
  { all: false, own: "" },
]);

// --- Меню и вкладки ---------------------------------------------------------------------
const dirMenu = navLinksFor("manager", "", [], undefined, "karaganda", true);
const dirSection = dirMenu.find((l) => l.href === "/region/karaganda");
check("у директора в меню раздел города с пятью вкладками", [dirSection?.label, dirSection?.subs.map((s) => s.label)], ["Караганда", ["Остатки", "Фура", "Отгрузка клиентам", "Списание", "Оплаты и долги"]]);
check("у менеджера города без флага — без «Оплат и долгов»", navLinksFor("manager", "", [], undefined, "astana", false).find((l) => l.href === "/region/astana")?.subs.map((s) => s.label), [
  "Остатки",
  "Фура",
  "Отгрузка клиентам",
  "Списание",
]);
check("у обычного менеджера раздела города нет", navLinksFor("manager").some((l) => l.href.startsWith("/region")), false);
check("у владельца, РОПа и зав. складом «Регионы» — вкладкой «Склада»", ["admin", "sales_head", "warehouse"].map((role) => navLinksFor(role).some((l) => l.subs.some((s) => s.href === "/region"))), [true, true, true]);
check("вкладки города у зав. складом: без списания и денег", regionTabsFor("semey", regionAccess({ role: "warehouse" }, "semey")).map((t) => t.label), ["Остатки", "Фура", "Отгрузка клиентам"]);
check("адрес /region открывается менеджеру, РОПу, админу и складу; бухгалтеру и маркетологу — нет", ["manager", "sales_head", "admin", "warehouse", "accountant", "marketer", "leadgen"].map((role) => canOpen(role, "/region/karaganda/truck")), [
  true,
  true,
  true,
  true,
  false,
  false,
  false,
]);

// --- Кто сидит в городе -----------------------------------------------------------------
const profiles = parseManagerProfiles(
  JSON.stringify({
    "saltanat@x.kz": { city: "Астана", shipWeekday: 1, female: true },
    "arman@x.kz": { city: "Караганда", shipWeekday: 2, director: true },
    "ilgar@x.kz": { closer: true },
  })
);
check("профиль читает флаг директора", [profiles["arman@x.kz"].director, profiles["saltanat@x.kz"].director, profiles["ilgar@x.kz"].director], [true, false, false]);
check("Караганда: директор и день фуры — вторник", regionSeat(profiles, "karaganda"), { store: "karaganda", directors: ["arman@x.kz"], managers: [], truckWeekday: 2 });
check("Астана: менеджер города без директора, понедельник", regionSeat(profiles, "astana"), { store: "astana", directors: [], managers: ["saltanat@x.kz"], truckWeekday: 1 });
check("Семей: никого — понедельник по умолчанию", regionSeat(profiles, "semey"), { store: "semey", directors: [], managers: [], truckWeekday: 1 });
check("ближайшая фура: во вторник до 12 — сегодня, после — через неделю, в среду — следующий вторник", [nextTruckDay("2026-11-17", 2, 9), nextTruckDay("2026-11-17", 2, 13), nextTruckDay("2026-11-18", 2, 9)], [
  "2026-11-17",
  "2026-11-24",
  "2026-11-24",
]);

// Назначение директора — правка сырой настройки, чужие поля не теряются.
const raw = { "saltanat@x.kz": { city: "Астана", shipWeekday: 1, female: true, future: "x" }, "ilgar@x.kz": { closer: true }, "arman@x.kz": { city: "Караганда", shipWeekday: 2, director: true } };
const set1 = setRegionDirector(raw, { store: "semey", email: "Bolat@x.kz", weekday: 2 });
check("новый директор Семея", set1["bolat@x.kz"], { female: false, closer: false, city: "Семей", shipWeekday: 2, director: true });
check("остальные профили не тронуты, незнакомое поле цело", [set1["saltanat@x.kz"], set1["ilgar@x.kz"], set1["arman@x.kz"]], [raw["saltanat@x.kz"], raw["ilgar@x.kz"], raw["arman@x.kz"]]);
const set2 = setRegionDirector(raw, { store: "astana", email: "ilgar@x.kz", weekday: 1 });
check("напористый продавец стал директором Астаны — стиль сохранён", set2["ilgar@x.kz"], { female: false, closer: true, city: "Астана", shipWeekday: 1, director: true });
check("менеджер города остаётся при складе", set2["saltanat@x.kz"], { city: "Астана", shipWeekday: 1, female: true, future: "x" });
const set3 = setRegionDirector(raw, { store: "karaganda", email: "ilgar@x.kz", weekday: 1 });
check("смена директора: прежний снят с города, новый посажен", [set3["arman@x.kz"], set3["ilgar@x.kz"].director, set3["ilgar@x.kz"].city], [{ city: "", shipWeekday: null, director: false }, true, "Караганда"]);
const set4 = setRegionDirector(raw, { store: "karaganda", email: "", weekday: 1 });
check("снять директора", [set4["arman@x.kz"].director, set4["arman@x.kz"].city, regionSeat(parseManagerProfiles(JSON.stringify(set4)), "karaganda").directors], [false, "", []]);
const set5 = setRegionDirector(raw, { store: "astana", email: "", weekday: 2 });
check("сменить только день фуры у города с менеджером", [set5["saltanat@x.kz"].shipWeekday, set5["saltanat@x.kz"].city], [2, "Астана"]);
const set6 = setRegionDirector(raw, { store: "astana", email: "arman@x.kz", weekday: 1 });
check("директора одного города перевели в другой — в прежнем его нет", [regionSeat(parseManagerProfiles(JSON.stringify(set6)), "karaganda").directors, regionSeat(parseManagerProfiles(JSON.stringify(set6)), "astana").directors], [[], ["arman@x.kz"]]);
let threw = "";
try {
  setRegionDirector(raw, { store: "semey", email: "", weekday: 2 });
} catch (e) {
  threw = e instanceof Error ? e.message : "";
}
check("день фуры без директора и менеджера города хранить негде — отказ", has(threw, "Сначала выберите менеджера города"), true);
threw = "";
try {
  setRegionDirector(raw, { store: "office" as never, email: "a@x.kz", weekday: 1 });
} catch (e) {
  threw = e instanceof Error ? e.message : "";
}
check("офис — не регион", has(threw, "не из списка"), true);

// --- Заказ на фуру ----------------------------------------------------------------------
const dirAccess = regionAccess(director, "karaganda");
const L = (wholesale: number, retail = 0, over: Record<string, unknown> = {}) => ({ flowerType: "rose", variety: "Jana", grade: "60", wholesale, retail, ...over });
const order = (lines: ReturnType<typeof L>[], over: Record<string, unknown> = {}) => truckOrderRefusal({ access: dirAccess, deliveryDate: "2026-11-24", today: "2026-11-17", lines, hasRetailCard: true, ...over });
check("обычный заказ — можно", order([L(300, 150), L(0, 0), { flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", wholesale: 500, retail: 0 }]), "");
check("заказ на сегодня — можно, на вчера — нет", [order([L(100)], { deliveryDate: "2026-11-17" }), has(order([L(100)], { deliveryDate: "2026-11-16" }), "прошёл")], ["", true]);
check("кривая дата", [has(order([L(100)], { deliveryDate: "24.11.2026" }), "день"), has(order([L(100)], { deliveryDate: "2026-13-45" }), "день")], [true, true]);
check("пустой заказ", has(order([L(0, 0)]), "хотя бы по одной"), true);
check("минус, дробь, слишком много", [has(order([L(-5)]), "меньше нуля"), has(order([L(10.5)]), "целым числом"), has(order([L(600000)]), "слишком большое")], [true, true, true]);
check("выдуманный цветок и длина не из списка", [has(order([L(10, 0, { flowerType: "tulip" })]), "цветок"), has(order([L(10, 0, { grade: "65" })]), "длину или категорию")], [true, true]);
check("в магазины, когда карточки розницы в городе нет", has(order([L(100, 50)], { hasRetailCard: false }), "нет карточки"), true);
check("только опт без карточки розницы — можно", order([L(100, 0)], { hasRetailCard: false }), "");
check("менеджер города без флага главного заказ подаёт", truckOrderRefusal({ access: regionAccess(keeper, "astana"), deliveryDate: "2026-11-24", today: "2026-11-17", lines: [L(100)], hasRetailCard: true }), "");
check("менеджер без города заказ не подаёт", has(truckOrderRefusal({ access: regionAccess(plain, "astana"), deliveryDate: "2026-11-24", today: "2026-11-17", lines: [L(100)], hasRetailCard: true }), "менеджер города"), true);
check("зав. складом через эту форму заказ не подаёт", has(truckOrderRefusal({ access: regionAccess({ role: "warehouse" }, "astana"), deliveryDate: "2026-11-24", today: "2026-11-17", lines: [L(100)], hasRetailCard: true }), "менеджер города"), true);
const split = splitTruckLines([L(300, 150), L(200, 0), { flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", wholesale: 0, retail: 400 }, L(0, 0, { variety: "Lola" })]);
check("строки → две заявки, одинаковые позиции сложены", split, {
  wholesale: [{ flowerType: "rose", variety: "Jana", grade: "60", quantity: 500 }],
  retail: [
    { flowerType: "rose", variety: "Jana", grade: "60", quantity: 150 },
    { flowerType: "chrysanthemum", variety: "Altaj", grade: "Третья", quantity: 400 },
  ],
});

// Какие заявки — заказы на фуру этого города.
const cards = retailCardsOf(
  [
    { clientId: "C-SEM", retail: "regions", city: "Семей", active: true },
    { clientId: "C-AST", retail: "regions", city: "Астана", active: true },
    { clientId: "C-ALM", retail: "almaty", city: "Алматы", active: true },
    { clientId: "C-X", retail: "", city: "Семей", active: true },
  ],
  "semey"
);
check("карточка розницы города — наш магазин регионов с этим городом", cards.map((c) => c.clientId), ["C-SEM"]);
const semCards = new Set(["C-SEM"]);
const O = (over: Record<string, unknown>) => ({ orderId: "ORD-1", status: "new", kind: "", retail: "", direction: "", clientId: "", deliveryDate: "2026-11-24", ...over });
check("объём на Семей — опт Семея, на Астану — нет", [truckKindOf(O({ kind: "region", direction: "Семей" }), "semey", semCards), truckKindOf(O({ kind: "region", direction: "Астана" }), "semey", semCards)], ["wholesale", null]);
check("отгрузка в РФ — не заказ на фуру", truckKindOf(O({ kind: "region", direction: "РФ" }), "semey", semCards), null);
check("заявка в карточку розницы Семея — магазины Семея; в чужую — нет", [truckKindOf(O({ retail: "regions", clientId: "C-SEM" }), "semey", semCards), truckKindOf(O({ retail: "regions", clientId: "C-AST" }), "semey", semCards)], [
  "retail",
  null,
]);
check("клиентская заявка в Семей — не заказ на фуру", truckKindOf(O({ direction: "Семей", clientId: "C-X" }), "semey", semCards), null);

const cancelOk = { status: "new", items: [{ shippedQuantity: 0 }, { shippedQuantity: 0 }] };
check("отмена: пока не грузили — можно", truckCancelRefusal({ access: dirAccess, order: cancelOk, kind: "wholesale" }), "");
check("отмена: уже грузят — нельзя", has(truckCancelRefusal({ access: dirAccess, order: { status: "in_progress", items: [{ shippedQuantity: 10 }] }, kind: "wholesale" }), "начал грузить"), true);
check("отмена: не заказ на фуру этого города, уже отменён, не менеджер города", [
  has(truckCancelRefusal({ access: dirAccess, order: cancelOk, kind: null }), "не заказ на фуру"),
  has(truckCancelRefusal({ access: dirAccess, order: { ...cancelOk, status: "cancelled" }, kind: "retail" }), "уже отменён"),
  has(truckCancelRefusal({ access: regionAccess({ role: "warehouse" }, "astana"), order: cancelOk, kind: "wholesale" }), "менеджер города"),
], [true, true, true]);

// --- Приёмка ----------------------------------------------------------------------------
const ord = { orderId: "ORD-K1", status: "shipped", deliveryDate: "2026-11-16" };
const T = "2026-11-16T04:00:00.000Z";
const ship = (itemId: string, batchId: string, quantity: number, createdAt = T, orderId = "ORD-K1") => ({ orderId, itemId, batchId, quantity, createdAt });
const ships = [ship("I1", "B1", 300), ship("I1", "B2", 200), ship("I2", "B3", 400)];
const pend = pendingReceipt({ order: ord, shipments: ships, moves: [], receipts: [] });
check("отгружено и не принято — ждёт приёмки по позициям и партиям", pend, [
  { itemId: "I1", quantity: 500, parts: [{ batchId: "B1", quantity: 300 }, { batchId: "B2", quantity: 200 }] },
  { itemId: "I2", quantity: 400, parts: [{ batchId: "B3", quantity: 400 }] },
]);
check(`фура раньше ${REGION_ACCEPT_FROM} приёмки не ждёт`, pendingReceipt({ order: { ...ord, deliveryDate: "2026-11-10" }, shipments: ships, moves: [], receipts: [] }), []);
check("отменённый заказ приёмки не ждёт", pendingReceipt({ order: { ...ord, status: "cancelled" }, shipments: ships, moves: [], receipts: [] }), []);
check("чужие отгрузки не считаются", pendingReceipt({ order: ord, shipments: [ship("I9", "B9", 100, T, "ORD-OTHER")], moves: [], receipts: [] }), []);
// Астана до 17.11: цветок лёг на склад в момент отгрузки — в журнале перемещений приход с номером заявки.
const autoMove = (fromBatchId: string, quantity: number, createdAt = T) => ({ direction: "to_region", fromBatchId, quantity, note: "Объём на город: Астана · заявка ORD-K1", createdAt });
const autoAll = [autoMove("B1", 300), autoMove("B2", 200), autoMove("B3", 400)];
check("старая отгрузка Астаны уже на складе — приёмки не ждёт", pendingReceipt({ order: ord, shipments: ships, moves: autoAll, receipts: [] }), []);
check("то же, когда время в журнале перемещений вернулось в другом виде (сверка по количеству, не по времени)", pendingReceipt({ order: ord, shipments: ships, moves: autoAll.map((m) => ({ ...m, createdAt: "16.11.2026 9:00:00" })), receipts: [] }), []);
check("часть легла сразу, а поздняя догрузка из той же партии — ждёт", pendingReceipt({ order: ord, shipments: [...ships, ship("I2", "B3", 100, "2026-11-17T09:00:00.000Z")], moves: autoAll, receipts: [] }), [
  { itemId: "I2", quantity: 100, parts: [{ batchId: "B3", quantity: 100 }] },
]);
check("легло сразу, потом догрузка, приёмка, ещё догрузка — ждёт только последняя", pendingReceipt({ order: ord, shipments: [...ships, ship("I2", "B3", 100, "2026-11-17T09:00:00.000Z"), ship("I2", "B3", 60, "2026-11-18T09:00:00.000Z")], moves: autoAll, receipts: [{ orderId: "ORD-K1", itemId: "I2", shipped: 100, accepted: 100, createdAt: "2026-11-17T12:00:00.000Z" }] }), [
  { itemId: "I2", quantity: 60, parts: [{ batchId: "B3", quantity: 60 }] },
]);
check("приход по ЧУЖОЙ заявке из той же партии не закрывает эту", pendingReceipt({ order: ord, shipments: [ship("I1", "B1", 300)], moves: [{ direction: "to_region", fromBatchId: "B1", quantity: 300, note: "Объём на город: Астана · заявка ORD-ZZ", createdAt: T }], receipts: [] }).length, 1);
check("запись самой приёмки в журнале перемещений не считается «легло сразу»", pendingReceipt({ order: ord, shipments: [ship("I1", "B1", 300)], moves: [{ direction: "to_region", fromBatchId: "B1", quantity: 300, note: "Приёмка фуры: Астана · заявка ORD-K1", createdAt: T }], receipts: [] }).length, 1);
const rcpt = (itemId: string, shipped: number, accepted: number, createdAt: string) => ({ orderId: "ORD-K1", itemId, shipped, accepted, createdAt });
check("после приёмки ждать нечего", pendingReceipt({ order: ord, shipments: ships, moves: [], receipts: [rcpt("I1", 500, 480, "2026-11-17T06:00:00.000Z"), rcpt("I2", 400, 400, "2026-11-17T06:00:00.000Z")] }), []);
check("догрузка после приёмки ждёт новой приёмки — только она", pendingReceipt({ order: ord, shipments: [...ships, ship("I1", "B4", 50, "2026-11-17T08:00:00.000Z")], moves: [], receipts: [rcpt("I1", 500, 480, "2026-11-17T06:00:00.000Z"), rcpt("I2", 400, 400, "2026-11-17T06:00:00.000Z")] }), [
  { itemId: "I1", quantity: 50, parts: [{ batchId: "B4", quantity: 50 }] },
]);
check("возврат (строка с минусом) уменьшает ожидаемое", pendingReceipt({ order: ord, shipments: [ship("I1", "B1", 300), ship("I1", "B2", 200), ship("I1", "B2", -50, "2026-11-16T05:00:00.000Z")], moves: [], receipts: [] }), [
  { itemId: "I1", quantity: 450, parts: [{ batchId: "B1", quantity: 300 }, { batchId: "B2", quantity: 150 }] },
]);
check("вернули всё — ждать нечего", pendingReceipt({ order: ord, shipments: [ship("I1", "B1", 300), ship("I1", "B1", -300, "2026-11-16T05:00:00.000Z")], moves: [], receipts: [] }), []);

const accAccess = regionAccess(director, "karaganda");
const rec = (lines: { itemId: string; shipped: number; accepted: number }[], note = "", over: Record<string, unknown> = {}) => planTruckReceipt({ access: accAccess, kind: "wholesale", pending: pend, lines, note, ...over });
const full = plan(rec([{ itemId: "I1", shipped: 500, accepted: 500 }, { itemId: "I2", shipped: 400, accepted: 400 }]));
check("приёмка целиком: всё ложится на склад города по партиям", [full.accepted, full.shortage, full.landing], [900, 0, [{ batchId: "B1", quantity: 300 }, { batchId: "B2", quantity: 200 }, { batchId: "B3", quantity: 400 }]]);
const part = plan(rec([{ itemId: "I1", shipped: 500, accepted: 320 }, { itemId: "I2", shipped: 400, accepted: 0 }], "не доложили коробку"));
check("недостача: ложится только принятое, с первых партий", [part.accepted, part.shortage, part.landing, part.note], [320, 580, [{ batchId: "B1", quantity: 300 }, { batchId: "B2", quantity: 20 }], "не доложили коробку"]);
check("сумма «легло» всегда равна принятому", part.landing.reduce((s, p) => s + p.quantity, 0), part.accepted);
check("недостача без причины — отказ", has(rec([{ itemId: "I1", shipped: 500, accepted: 499 }, { itemId: "I2", shipped: 400, accepted: 400 }]), "что случилось"), true);
check("принять больше отгруженного нельзя", has(rec([{ itemId: "I1", shipped: 500, accepted: 501 }, { itemId: "I2", shipped: 400, accepted: 400 }]), "не больше отгруженного"), true);
check("минус и дробь", [has(rec([{ itemId: "I1", shipped: 500, accepted: -1 }, { itemId: "I2", shipped: 400, accepted: 400 }], "x x"), "целое число"), has(rec([{ itemId: "I1", shipped: 500, accepted: 1.5 }, { itemId: "I2", shipped: 400, accepted: 400 }], "x x"), "целое число")], [true, true]);
check("форма отстала от склада (другое «отгружено») — отказ с просьбой обновить", has(rec([{ itemId: "I1", shipped: 450, accepted: 450 }, { itemId: "I2", shipped: 400, accepted: 400 }]), "обновите"), true);
check("позиция пропущена — отказ", has(rec([{ itemId: "I1", shipped: 500, accepted: 500 }]), "обновите"), true);
check("лишняя позиция — отказ", has(rec([{ itemId: "I1", shipped: 500, accepted: 500 }, { itemId: "I2", shipped: 400, accepted: 400 }, { itemId: "I7", shipped: 10, accepted: 10 }]), "нет в заказе"), true);
check("нечего принимать", has(planTruckReceipt({ access: accAccess, kind: "wholesale", pending: [], lines: [], note: "" }), "нечего принимать"), true);
check("не заказ на фуру этого города", has(rec([], "", { kind: null }), "не заказ на фуру"), true);
check("зав. складом и РОП приёмку не подтверждают", [has(rec([], "", { access: regionAccess({ role: "warehouse" }, "karaganda") }), "ведёт склад"), has(rec([], "", { access: regionAccess({ role: "sales_head" }, "karaganda") }), "ведёт склад")], [true, true]);
check("менеджер города без флага директора приёмку подтверждает", typeof planTruckReceipt({ access: regionAccess(keeper, "astana"), kind: "wholesale", pending: pend, lines: [{ itemId: "I1", shipped: 500, accepted: 500 }, { itemId: "I2", shipped: 400, accepted: 400 }], note: "" }), "object");
const shop = plan(rec([{ itemId: "I1", shipped: 500, accepted: 500 }, { itemId: "I2", shipped: 400, accepted: 390 }], "бой 10 шт.", { kind: "retail" }));
check("заказ в магазины: приёмка записывается, на склад города не ложится", [shop.accepted, shop.shortage, shop.landing], [890, 10, []]);

// --- Список заказов на фуру -------------------------------------------------------------
const item = (itemId: string, quantity: number, shippedQuantity: number) => ({ itemId, flowerType: "rose", variety: "Jana", grade: "60", quantity, shippedQuantity });
const TO = (orderId: string, over: Record<string, unknown>, items: ReturnType<typeof item>[]) => ({ orderId, status: "new", kind: "region", retail: "", direction: "Караганда", clientId: "", deliveryDate: "2026-11-24", createdAt: "2026-11-17T05:00:00.000Z", managerEmail: "arman@x.kz", items, ...over });
const views = buildTruckOrders({
  store: "karaganda",
  orders: [
    TO("ORD-W", {}, [item("W1", 500, 0)]),
    TO("ORD-L", { status: "in_progress", deliveryDate: "2026-11-23" }, [item("L1", 500, 0), item("L2", 200, 0)]),
    TO("ORD-K1", { status: "shipped", deliveryDate: "2026-11-16" }, [item("I1", 500, 500), item("I2", 400, 400)]),
    TO("ORD-R", { status: "shipped", deliveryDate: "2026-11-17" }, [item("R1", 100, 100)]),
    TO("ORD-OLD", { status: "shipped", deliveryDate: "2026-11-10" }, [item("O1", 300, 300)]),
    TO("ORD-C", { status: "cancelled" }, [item("C1", 300, 0)]),
    TO("ORD-AST", { direction: "Астана" }, [item("A1", 300, 0)]),
    TO("ORD-ANCIENT", { status: "shipped", deliveryDate: "2026-10-01" }, [item("X1", 300, 300)]),
  ],
  retailCardIds: new Set<string>(),
  shipments: [...ships, ship("R1", "B5", 100, "2026-11-17T03:00:00.000Z", "ORD-R"), ship("O1", "B6", 300, "2026-11-10T03:00:00.000Z", "ORD-OLD")],
  moves: [],
  receipts: [{ orderId: "ORD-R", itemId: "R1", shipped: 100, accepted: 90, createdAt: "2026-11-17T08:00:00.000Z", note: "бой" }],
  from: "2026-11-02",
});
check("заказы города: свежая фура первой, чужой город и древние — нет", views.map((v) => v.orderId), ["ORD-W", "ORD-C", "ORD-L", "ORD-R", "ORD-K1", "ORD-OLD"]);
check("стадии", Object.fromEntries(views.map((v) => [v.orderId, v.stage])), { "ORD-W": "waiting", "ORD-C": "cancelled", "ORD-L": "waiting", "ORD-R": "received", "ORD-K1": "transit", "ORD-OLD": "old" });
const r1 = views.find((v) => v.orderId === "ORD-R")!;
check("принятый заказ: принято, недостача и причина", [r1.accepted, r1.shortage, r1.shortageNote, r1.pending, r1.items[0].accepted], [90, 10, "бой", 0, 90]);
const k1 = views.find((v) => v.orderId === "ORD-K1")!;
check("в пути: ждёт приёмки по позициям", [k1.pending, k1.items.map((i) => i.pending), k1.items.map((i) => i.accepted)], [900, [500, 400], [null, null]]);

// --- Деньги города ----------------------------------------------------------------------
const cityOf = (id: string) => ({ C1: "Караганда", C2: "Алматы", C3: "г. Караганды" } as Record<string, string>)[id];
const M = (orderId: string, over: Record<string, unknown>) => ({ orderId, status: "new", kind: "", retail: "", direction: "", clientName: "Клиент", clientId: "C2", store: "", createdAt: "2026-11-05", deliveryDate: "2026-11-06", totalAmount: 100000, paidAmount: 0, ...over });
const cityOrders = cityClientOrders(
  [
    M("A", { clientId: "C1" }),
    M("B", { store: "karaganda" }),
    M("C", { direction: "Караганда" }),
    M("D", { clientId: "C3" }),
    M("E", {}),
    M("F", { kind: "region", direction: "Караганда" }),
    M("G", { retail: "regions", clientId: "C1" }),
    M("H", { clientId: "C1", clientName: "Пожарка" }),
    M("I", { store: "astana", clientId: "C2" }),
  ],
  "karaganda",
  cityOf
);
check("заявки города: клиент города, склад города или направление; объём, магазины, точка и чужие — нет", cityOrders.map((o) => o.orderId), ["A", "B", "C", "D"]);
const money = cityMoney({
  month: "2026-11",
  orders: [
    { ...M("A", { paidAmount: 100000 }), debt: 0, late: false },
    { ...M("B", { paidAmount: 30000 }), debt: 70000, late: true },
    { ...M("C", { createdAt: "2026-10-20", paidAmount: 0 }), debt: 100000, late: true },
    { ...M("D", { paidAmount: 150000 }), debt: 0, late: false },
    { ...M("Z", { status: "cancelled" }), debt: 0, late: false },
    { ...M("Y", { paidAmount: 0 }), debt: 100000, late: false },
  ],
});
check("деньги города: месяц — по дню оформления, переплата не в счёт, отменённые не считаются, долг — по всем", money, {
  monthSales: 400000,
  monthOrders: 4,
  monthPaid: 230000,
  debt: 270000,
  debtOrders: 3,
  late: 170000,
  lateOrders: 2,
});

if (fails > 0) {
  console.error(`\nНе прошло проверок: ${fails}`);
  process.exit(1);
}
console.log("\nВсе проверки пройдены");
