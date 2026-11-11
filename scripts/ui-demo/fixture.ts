/**
 * ВЫДУМАННЫЕ данные для локальной проверки интерфейса (`scripts/ui-demo/run.sh`). На сайт и в таблицу не попадают:
 * демо-копия читает их из файла вместо Google-таблицы. Имена, телефоны и цифры придуманы.
 * Пишет JSON { вкладка: [[заголовки], [строка], …] }: `npx tsx scripts/ui-demo/fixture.ts <файл.json> [ГГГГ-ММ-ДД]`.
 */
import { writeFileSync } from "fs";
import { SHEET_HEADERS, DEFAULT_VARIETIES } from "../../src/lib/constants";

const TODAY = process.argv[3] || new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const day = (off: number) => new Date(Date.parse(TODAY + "T00:00:00Z") + off * 86400_000).toISOString().slice(0, 10);
const at = (off: number, h = int(4, 12), m = int(0, 59)) => `${day(off)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const id = (n = 5) => Array.from({ length: n }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[int(0, 33)]).join("");

const out: Record<string, string[][]> = {};
const tab = (name: string, records: Record<string, unknown>[]) => {
  const h = (SHEET_HEADERS as Record<string, string[]>)[name];
  if (!h) throw new Error("нет вкладки " + name);
  out[name] = [h, ...records.map((r) => h.map((k) => (r[k] === undefined || r[k] === null ? "" : String(r[k]))))];
};

// --- Сотрудники ---
const U = [
  ["owner@demo.kz", "Ержан Садакбаев", "admin", ""],
  ["ilyas@demo.kz", "Ильяс Ахметов", "manager", ""],
  ["emil@demo.kz", "Эмиль Каримов", "manager", ""],
  ["ilgar@demo.kz", "Ильгар Гасанов", "manager", ""],
  ["nina@demo.kz", "Нина Ким", "sales_head", ""],
  ["yulia@demo.kz", "Юлия Петрова", "accountant", ""],
  ["raziya@demo.kz", "Разия Омарова", "warehouse", "rose_farm"],
  ["diana@demo.kz", "Диана Сейткали", "warehouse", "esentai"],
  ["ruslan@demo.kz", "Руслан Байжанов", "office_retail", ""],
  ["agro@demo.kz", "Бауржан Нурланов", "agronomist", "rose_farm"],
  ["zemfira@demo.kz", "Земфира Алиева", "leadgen", ""],
];
tab("Users", U.map(([Email, Name, Role, Farm]) => ({ Email, Name, Role, Active: "TRUE", Farm })));
const managers = ["ilyas@demo.kz", "emil@demo.kz", "ilgar@demo.kz"];

// --- Сорта и прайс ---
const varieties: Record<string, unknown>[] = [];
for (const [f, list] of Object.entries(DEFAULT_VARIETIES)) for (const v of list as string[]) varieties.push({ FlowerType: f, Variety: v, Active: "TRUE" });
tab("Varieties", varieties);
const PRICE: Record<string, Record<string, number>> = {
  rose: { "40": 170, "50": 200, "60": 245, "70": 265, "80": 300, "Мини-микс": 235 },
  chrysanthemum: { Высшая: 560, Первая: 480, Вторая: 380, Третья: 250, Четвёртая: 170, "Мини-микс": 150 },
  eustoma: { Стандарт: 395, "50": 155, "Мини-микс": 120 },
};
const prices: Record<string, unknown>[] = [];
for (const [f, g] of Object.entries(PRICE)) for (const [grade, p] of Object.entries(g)) {
  prices.push({ Date: day(-60), FlowerType: f, Variety: "", Grade: grade, Price: Math.round(p * 0.93), Kind: "" });
  prices.push({ Date: day(-12), FlowerType: f, Variety: "", Grade: grade, Price: p, Kind: "" });
}
tab("PriceHistory", prices);

// --- Клиенты ---
const SHOPS = ["Цветы 24", "Магнолия", "Флора Люкс", "Роза Ветров", "Букет Алматы", "Тюльпан", "Гүлдер әлемі", "Орхидея", "Цветочный дворик", "Лаванда", "Флористика А", "Камелия", "Гүл базар", "Пион", "Бутон", "Роза Мира", "Ирис", "Fleur Studio", "Лепесток", "Ромашка", "Центр цветов Романтик", "Мимоза", "Green House", "Азалия", "Эдельвейс", "Цветочная лавка", "Жасмин", "Bloom Bar", "Флора Маркет", "Нарцисс", "Гортензия", "Сад роз", "Оранж", "Виола", "Мята", "Sky Group", "Ландыш", "Фиалка", "Пожарка", "Белая лилия", "Гүлзар", "Флорист KZ", "Астра", "Георгин", "Цветы у Айгуль"];
const CITIES = ["Алматы", "Алматы", "Алматы", "Алматы", "Алматы", "Астана", "Караганда", "Шымкент", "Талдыкорган", "Бишкек", "Каскелен"];
const TYPES = ["Розничный магазин", "Сеть магазинов", "Оптовик", "Флористический салон", "Свадебное агентство"];
const TERMS = ["Предоплата", "Предоплата", "По факту", "Отсрочка 3 дня", "Отсрочка 7 дней", "Отсрочка 14 дней"];
const PEOPLE = ["Айгуль", "Сабина", "Наталья", "Елена", "Гульнара", "Мария", "Асель", "Динара", "Жанна", "Фарида", "Светлана", "Мадина", "Камила", "Алия", "Оксана", "Баглан", "Сергали", "Тимур", "Ерлан", "Даурен"];
const phone = () => `+7 7${int(0, 7)}${int(0, 9)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`;
const clients = SHOPS.map((name, i) => ({
  ClientID: "C" + id(6),
  CreatedAt: at(-int(20, 300)),
  Name: name,
  City: name === "Пожарка" ? "Алматы" : pick(CITIES),
  ShopName: "",
  ClientType: pick(TYPES),
  ContactPerson: pick(PEOPLE),
  Phone: phone(),
  Messenger: "",
  Address: rnd() < 0.6 ? `ул. ${pick(["Абая", "Сатпаева", "Толе би", "Жибек жолы", "Розыбакиева", "Тимирязева"])}, ${int(1, 180)}` : "",
  PaymentTerms: pick(TERMS),
  Source: pick(["Рекомендация", "Instagram", "Написали в WhatsApp", "Холодный звонок", ""]),
  Note: rnd() < 0.25 ? "Берёт по вторникам и пятницам, доставка до 10:00" : "",
  ManagerEmail: managers[i % 3],
  Active: "TRUE",
  PaymentMethod: pick(["Каспи", "Каспи", "Наличные", "Оплата по реквизитам"]),
  KaspiPay1: "",
  KaspiPay2: "",
  Retail: "",
}));
tab("Clients", clients);

// --- Партии ---
const batches: Record<string, unknown>[] = [];
const roseV = (DEFAULT_VARIETIES.rose as string[]).filter((v) => !/мини/i.test(v)).slice(0, 12);
const chrV = (DEFAULT_VARIETIES.chrysanthemum as string[]).filter((v) => !/мини/i.test(v)).slice(0, 6);
const eusV = (DEFAULT_VARIETIES.eustoma as string[]).filter((v) => !/мини/i.test(v)).slice(0, 4);
const mkBatch = (off: number, f: string, v: string, g: string, qin: number, leftShare: number, store = "", src = "") => {
  const b = { BatchID: "B" + id(6), ReceivedAt: at(off, 3), HarvestDate: day(off), FlowerType: f, Variety: v, Grade: g, QuantityIn: qin, QuantityRemaining: Math.round((qin * leftShare) / 5) * 5, Location: "", ReceivedByEmail: f === "chrysanthemum" ? "diana@demo.kz" : "raziya@demo.kz", Store: store, SourceBatchID: src };
  batches.push(b);
  return b;
};
for (let off = -45; off <= 0; off++) {
  const fresh = off >= -4 ? 0.2 + rnd() * 0.7 : off >= -9 ? rnd() * 0.15 : 0;
  for (let k = 0; k < 4; k++) mkBatch(off, "rose", pick(roseV), pick(["40", "50", "50", "60", "60", "70"]), int(8, 60) * 50, fresh);
  for (let k = 0; k < 3; k++) mkBatch(off, "chrysanthemum", pick(chrV), pick(["Высшая", "Первая", "Вторая", "Третья", "Третья", "Четвёртая"]), int(6, 40) * 50, off >= -8 ? 0.15 + rnd() * 0.6 : 0);
  if (off % 2 === 0) mkBatch(off, "eustoma", pick(eusV), pick(["Стандарт", "Стандарт", "50"]), int(4, 20) * 50, off >= -6 ? 0.3 + rnd() * 0.5 : 0);
}
const live = batches.filter((b) => Number(b.QuantityRemaining) > 0);
for (const b of live.slice(0, 8)) batches.push({ ...b, BatchID: "B" + id(6), QuantityIn: 0, QuantityRemaining: int(1, 6) * 50, Store: "office", SourceBatchID: b.BatchID });
tab("Batches", batches);

// --- Заявки ---
const orders: Record<string, unknown>[] = [];
const items: Record<string, unknown>[] = [];
const shipments: Record<string, unknown>[] = [];
const payments: Record<string, unknown>[] = [];
const mkItems = (orderId: string, n: number, shipped: boolean) => {
  let sum = 0;
  let rose = 0;
  let es = 0;
  for (let k = 0; k < n; k++) {
    const f = pick(["rose", "rose", "chrysanthemum", "chrysanthemum", "eustoma"]);
    const g = pick(Object.keys(PRICE[f]).filter((x) => x !== "Мини-микс"));
    const v = f === "rose" ? pick(roseV) : f === "chrysanthemum" ? pick(chrV) : pick(eusV);
    const q = pick([50, 100, 100, 150, 200, 300, 500]);
    const p = PRICE[f][g];
    const it = { OrderID: orderId, ItemID: "I" + id(7), FlowerType: f, Variety: v, Grade: g, Quantity: q, UnitPrice: p, ShippedQuantity: shipped ? q : 0 };
    items.push(it);
    sum += q * p;
    if (f === "chrysanthemum") es += q * p;
    else rose += q * p;
    if (shipped) {
      const b = batches.find((x) => x.FlowerType === f && x.Grade === g) ?? batches[0];
      shipments.push({ ShipmentID: "S" + id(7), CreatedAt: at(0), OrderID: orderId, ItemID: it.ItemID, BatchID: b.BatchID, Quantity: q, WarehouseEmail: b.ReceivedByEmail, Notes: "" });
    }
  }
  return { sum, rose, es };
};
for (let off = -40; off <= 0; off++) {
  const n = off === 0 ? 9 : int(4, 9);
  for (let k = 0; k < n; k++) {
    const c = pick(clients);
    const orderId = id(5);
    const status = off < -1 ? (rnd() < 0.05 ? "cancelled" : "shipped") : off === -1 ? pick(["shipped", "shipped", "ready"]) : pick(["new", "new", "in_progress", "ready", "shipped"]);
    const shipped = status === "shipped";
    const { sum, rose, es } = mkItems(orderId, int(1, 4), shipped);
    const deferred = /Отсрочка|По факту/.test(c.PaymentTerms);
    let paidShare = status === "cancelled" ? 0 : off < -14 ? (rnd() < 0.9 ? 1 : 0) : off < -3 ? (rnd() < 0.7 ? 1 : rnd() < 0.5 ? 0.5 : 0) : deferred ? 0 : rnd() < 0.6 ? 1 : 0;
    const paid = Math.round(sum * paidShare);
    orders.push({
      OrderID: orderId, CreatedAt: at(off), ManagerEmail: c.ManagerEmail, ClientName: c.Name, ClientPhone: c.Phone, DeliveryDate: day(Math.min(off + int(0, 1), 1)), Status: status,
      Notes: rnd() < 0.2 ? pick(["Доставка до 9:00", "Самовывоз", "Позвонить за час", "Упаковать в коробки по 200"]) : "",
      ManagerConfirmed: "TRUE", ManagerConfirmedAt: at(off), Paid: paidShare === 1 ? "TRUE" : "", PaidAt: paidShare > 0 ? at(off + 1) : "", PaymentMethod: c.PaymentMethod, AccountantEmail: paidShare > 0 ? "yulia@demo.kz" : "",
      PaidAmount: paid || "", PromisedAt: !paid && off < -3 && rnd() < 0.5 ? day(int(-2, 5)) : "", CollectionNote: "", ClientID: c.ClientID,
      PaidRoseFarm: paid ? Math.round(rose * paidShare) : "", PaidEsentai: paid ? Math.round(es * paidShare) : "", Retail: "", Direction: c.City === "Бишкек" ? "Киргизия" : "", Kind: "", InvoiceSentAt: "", InvoiceNote: "", Realization1C: shipped && rnd() < 0.7 ? "TRUE" : "", Store: "",
    });
    if (paid) payments.push({ PaymentID: "P" + id(7), CreatedAt: at(off + 1), OrderID: orderId, Date: day(Math.min(off + 1, 0)), Amount: paid, Farm: "", Method: c.PaymentMethod, AccountantEmail: "yulia@demo.kz", Note: "", Flower: "" });
  }
}
tab("Orders", orders);
tab("OrderItems", items);
tab("Shipments", shipments);
tab("Payments", payments);

// --- Списания ---
const wo: Record<string, unknown>[] = [];
for (let k = 0; k < 60; k++) {
  const b = pick(batches.filter((x) => Number(x.QuantityIn) > 0));
  wo.push({ WriteoffID: "W" + id(7), CreatedAt: at(-int(0, 30)), BatchID: b.BatchID, Quantity: int(1, 12) * 25, Reason: pick(["Порча / истёк срок хранения", "Порча / истёк срок хранения", "Брак", "Сломан при сборке"]), WarehouseEmail: b.ReceivedByEmail });
}
tab("Writeoffs", wo);

// --- Планы ---
const ym = TODAY.slice(0, 7);
tab("Plans", managers.flatMap((m, i) => [{ Period: ym, ManagerEmail: m, TargetAmount: [18_000_000, 22_000_000, 9_000_000][i], TargetStems: [80_000, 95_000, 40_000][i], FlowerType: "" }]));

// --- Лиды ---
const leads: Record<string, unknown>[] = [];
const touches: Record<string, unknown>[] = [];
const STAGES = ["new", "new", "new", "contact", "contact", "need", "offer", "offer", "trial", "lost"];
for (let k = 0; k < 70; k++) {
  const stage = pick(STAGES);
  const leadId = "L" + id(6);
  const mgr = k % 5 === 0 ? "" : k % 4 === 0 ? "zemfira@demo.kz" : pick(managers);
  leads.push({
    LeadID: leadId, CreatedAt: at(-int(1, 40)), CreatedByEmail: mgr || "nina@demo.kz", Name: `${pick(["Салон", "Цветы", "Флора", "Букет", "Студия"])} ${pick(PEOPLE)}`, City: pick(CITIES), ContactPerson: pick(PEOPLE), Phone: phone(),
    ClientType: pick(TYPES), Source: pick(["Instagram", "Написали в WhatsApp", "Холодный звонок", "Рекомендация"]), Address: "", Note: rnd() < 0.3 ? "Интересуется розой 60 см, берёт 2 раза в неделю" : "",
    ManagerEmail: mgr, Stage: stage, StageChangedAt: at(-int(0, 10)), NextTouchAt: stage === "lost" ? "" : stage === "new" ? "" : day(int(-3, 4)), LostReason: stage === "lost" ? pick(["Дорого", "Есть поставщик", "Не выходит на связь"]) : "",
    ClientID: "", Campaign: "", Segment: "", History: "", FirstSeenAt: "", PastOrders: "", Origin: mgr === "zemfira@demo.kz" ? "ads" : "", HandedOverAt: "", HandedOverBy: "",
  });
  if (stage !== "new") for (let t = 0; t < int(1, 3); t++) touches.push({ TouchID: "T" + id(7), LeadID: leadId, CreatedAt: at(-int(0, 12)), ManagerEmail: mgr || "nina@demo.kz", Channel: pick(["Звонок", "WhatsApp", "WhatsApp"]), Comment: pick(["Отправил прайс и фото, думают", "Не взяли трубку, написал в WhatsApp", "Берут у другого поставщика, но готовы попробовать 100 шт.", "Попросили перезвонить в пятницу"]), StageFrom: "contact", StageTo: stage, NextTouchAt: day(int(0, 4)), Outcome: "" });
}
tab("Leads", leads);
tab("LeadTouches", touches);

// --- Переписка (немного) ---
const wa: Record<string, unknown>[] = [];
for (const c of clients.slice(0, 14)) {
  const p = c.Phone.replace(/\D/g, "");
  const texts = [["in", "Здравствуйте, что есть на завтра?"], ["out", "Добрый день! В наличии роза 50 и 60 см, хризантема 3 категории"], ["in", "Роза 60 см почём?"], ["out", "245 тг, от 300 шт. — 235"], ["in", "Давайте 200 штук"]];
  texts.slice(0, int(2, 5)).forEach(([d, t], i) => wa.push({ MessageID: "M" + id(10), At: at(-int(0, 2), 4 + i, i * 7), ChatID: p + "@c.us", Phone: p, Direction: d, Type: "text", Text: t, MediaURL: "", SenderName: c.ContactPerson, Source: d === "out" ? "phone" : "", CreatedAt: at(0), Line: "" }));
}
tab("WaMessages", wa);

// --- Прогноз срезки ---
const fc: Record<string, unknown>[] = [];
for (let w = 1; w <= 5; w++) {
  for (const v of roseV.slice(0, 6)) fc.push({ Period: `${ym}-W${w}`, FlowerType: "rose", Variety: v, Grade: "", TargetStems: int(20, 60) * 250, UpdatedAt: at(-10), UpdatedByEmail: "agro@demo.kz" });
  for (const v of chrV.slice(0, 3)) fc.push({ Period: `${ym}-W${w}`, FlowerType: "chrysanthemum", Variety: v, Grade: "", TargetStems: int(20, 50) * 250, UpdatedAt: at(-10), UpdatedByEmail: "agro@demo.kz" });
}
tab("HarvestForecast", fc);

tab("Settings", [{ Key: "BotEnabled", Value: "true" }]);
for (const t of Object.keys(SHEET_HEADERS)) if (!out[t]) out[t] = [(SHEET_HEADERS as Record<string, string[]>)[t]];

writeFileSync(process.argv[2], JSON.stringify(out));
console.log("вкладок", Object.keys(out).length, "заявок", orders.length, "позиций", items.length, "партий", batches.length, "клиентов", clients.length, "лидов", leads.length);
