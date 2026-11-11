/** Проверка расчёта «План с ИИ» (`src/lib/aiPlan.ts`). Запуск: npx tsx scripts/check-ai-plan.ts */
import { buildAiPlan, clampFactor, historyPeriods, parseAiAdvice, planMonths, scaleQtyRow, splitWhole, weeklySplit, FACTOR_MAX, FACTOR_MIN, type AiPlanInput } from "../src/lib/aiPlan";
import type { Batch, OrderWithItems, Writeoff } from "../src/lib/types";

let failed = 0;
function check(name: string, ok: boolean, extra: unknown = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || extra === "" ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`}`);
}

let n = 0;
function order(day: string, email: string, items: [string, number, number][], extra: Partial<OrderWithItems> = {}): OrderWithItems {
  const id = `O${++n}`;
  return {
    orderId: id, createdAt: `${day}T05:00:00.000Z`, managerEmail: email, clientName: "К", clientPhone: "", deliveryDate: day, status: "confirmed",
    paidAmount: 0, clientId: "C1", retail: "", direction: "", kind: "", store: "", note: "",
    items: items.map(([flowerType, quantity, unitPrice], i) => ({ orderId: id, itemId: `${id}-${i}`, flowerType, variety: "V", grade: "60", quantity, unitPrice, shippedQuantity: 0 })),
    totalAmount: items.reduce((s, [, qn, p]) => s + qn * p, 0),
    ...extra,
  } as unknown as OrderWithItems;
}
const batch = (flowerType: string, harvestDate: string, quantityIn: number, quantityRemaining: number, store = ""): Batch =>
  ({ batchId: `B${++n}`, receivedAt: `${harvestDate}T03:00:00`, harvestDate, flowerType, variety: "V", grade: "60", quantityIn, quantityRemaining, location: "", receivedByEmail: "", store, sourceBatchId: "" }) as Batch;

const today = "2026-11-11";
const month = "2026-11";
const orders: OrderWithItems[] = [];
// Октябрь: Аня 3 000 роз по 300, Боря 1 000 роз; сентябрь — половина; ноябрь 1–10: Аня 1 200, Боря 300.
for (const d of ["2026-10-05", "2026-10-15", "2026-10-25"]) {
  orders.push(order(d, "anya@x.kz", [["rose", 1000, 300]]));
}
orders.push(order("2026-10-10", "borya@x.kz", [["rose", 1000, 300]]));
orders.push(order("2026-09-10", "anya@x.kz", [["rose", 1500, 300]]));
orders.push(order("2026-09-12", "borya@x.kz", [["rose", 500, 300]]));
orders.push(order("2026-11-03", "anya@x.kz", [["rose", 1200, 300]]));
orders.push(order("2026-11-05", "borya@x.kz", [["rose", 300, 300]]));
// Ушедший РОП продал в октябре 500 роз; отменённая заявка; объём на город в Астану; наш магазин.
orders.push(order("2026-10-12", "rop@x.kz", [["rose", 500, 300]]));
orders.push(order("2026-10-13", "anya@x.kz", [["rose", 9000, 300]], { status: "cancelled" } as Partial<OrderWithItems>));
orders.push(order("2026-10-20", "sklad@x.kz", [["rose", 2000, 0]], { kind: "region", direction: "Астана", clientId: "" } as Partial<OrderWithItems>));
orders.push(order("2026-10-21", "ruslan@x.kz", [["rose", 600, 150]], { retail: "almaty" } as Partial<OrderWithItems>));
// Клиентская заявка с направлением: идёт и менеджеру, и в срез «направления».
orders.push(order("2026-10-22", "anya@x.kz", [["rose", 400, 300]], { direction: "Киргизия" } as Partial<OrderWithItems>));

const batches: Batch[] = [batch("rose", "2026-11-09", 5000, 4000), batch("rose", "2026-10-25", 6000, 0), batch("rose", "2026-11-08", 0, 500, "office")];
const writeoffs: Writeoff[] = [{ writeoffId: "W1", createdAt: "2026-11-02T04:00:00.000Z", batchId: batches[1].batchId, quantity: 1100, reason: "брак", warehouseEmail: "" }];

const base: AiPlanInput = {
  month, today, scenario: "base", orders, batches, writeoffs,
  managers: [{ email: "anya@x.kz", name: "Аня" }, { email: "borya@x.kz", name: "Боря" }, { email: "novyi@x.kz", name: "Новый" }],
  names: { "rop@x.kz": "Нина" },
  forecast: { rose: { "2026-11-W2": 7000, "2026-11-W3": 7000, "2026-11-W4": 7000, "2026-11-W5": 2000 } },
  clientCount: { "anya@x.kz": 40, "borya@x.kz": 12 },
  currentPlans: {},
};

check("план ставится на текущий и следующий месяц", planMonths(today).join() === "2026-11,2026-12");
const hp = historyPeriods(month, today);
check("история: ноябрь по вчера, октябрь, сентябрь, август", hp.length === 4 && hp[0].days === 10 && hp[0].to === "2026-11-10" && hp[1].from === "2026-10-01", hp.map((p) => p.label));
check("в первую неделю месяца текущий месяц в историю не идёт", historyPeriods("2026-11", "2026-11-05")[0].from === "2026-10-01");

const p = buildAiPlan(base);
check("осталось дней: с сегодня по конец месяца", p.daysLeft === 20 && p.from === today && p.to === "2026-11-30", [p.daysLeft, p.from, p.to]);
check("в историю взяты три периода с продажами, веса 50/30/20", p.periods.length === 3 && Math.abs(p.periods[0].weight - 0.5) < 1e-9 && Math.abs(p.periods[2].weight - 0.2) < 1e-9, p.periods);
const rose = p.flowers.find((f) => f.flowerType === "rose")!;
check("склад — все склады вместе", rose.stock === 4500, rose.stock);
// Недели — календарные: 9–15 (осталось 5 дней из 7 → 5 000), 16–22 (7 000), 23–29 (2 000), 30-е — ноль.
check("срезка до конца месяца — из прогноза агронома, неделя режется по дням", rose.forecastSource === "agronomist" && rose.forecastLeft === 14000, rose.forecastLeft);
check("доля списаний за 30 дней", Math.abs(rose.writeoffShare - 1100 / 11000) < 1e-9, rose.writeoffShare);
check("факт месяца — по вчера, без отменённых", rose.fact.stems === 1500 && p.clientsFact === 450000, [rose.fact, p.clientsFact]);
check("базовый сценарий: по темпу продаж (цветка хватает)", rose.targetLeft === rose.demandLeft && rose.sellable > rose.targetLeft, rose);
check("излишек показан", rose.gap === rose.sellable - rose.targetLeft && rose.gap > 0);

const sumCh = p.channels.reduce((s, c) => s + (c.byFlower.rose?.stems ?? 0), 0);
check("каналы в сумме дают план цветка стебель в стебель", sumCh === rose.targetLeft, [sumCh, rose.targetLeft]);
const clients = p.channels.find((c) => c.channel === "clients")!;
const sumMgr = p.managers.reduce((s, m) => s + (m.byFlower.rose?.stems ?? 0), 0);
check("менеджеры в сумме дают клиентский канал", sumMgr === clients.byFlower.rose.stems, [sumMgr, clients.byFlower.rose.stems]);
check("объём на город и наш магазин — отдельными каналами", p.channels.find((c) => c.channel === "region")!.target.stems > 0 && p.channels.find((c) => c.channel === "shops")!.target.stems > 0);
const anya = p.managers.find((m) => m.email === "anya@x.kz")!;
const borya = p.managers.find((m) => m.email === "borya@x.kz")!;
const nov = p.managers.find((m) => m.email === "novyi@x.kz")!;
check("кто продаёт больше — тому больше план", anya.target.sum > borya.target.sum && borya.target.sum > 0);
check("новый менеджер: не ноль и меньше остальных", nov.isNew && nov.target.sum > 0 && nov.target.sum < borya.target.sum, nov.target);
check("план на месяц = уже сделано + остаток", anya.month.sum === anya.fact.sum + anya.target.sum && anya.fact.sum === 360000);
check("не-менеджер (ушедший РОП) в менеджерах не стоит, о нём сказано", !p.managers.some((m) => m.email === "rop@x.kz") && p.departed[0]?.name === "Нина" && p.notes.some((x) => x.includes("Нина")));
check("отменённая заявка в историю не попала", anya.history[1] === 3400 * 300, anya.history);
const astana = p.directions.find((d) => d.direction === "Астана");
const kg = p.directions.find((d) => d.direction === "Киргизия");
check("направления: объём на город и клиентская заявка с направлением", !!astana && astana.target.stems > 0 && !!kg && kg.target.stems > 0, p.directions.map((d) => d.direction));

const careful = buildAiPlan({ ...base, scenario: "careful" });
const amb = buildAiPlan({ ...base, scenario: "ambitious" });
const r1 = careful.flowers[0], r3 = amb.flowers[0];
check("осторожный ≤ базовый ≤ амбициозный", r1.targetLeft <= rose.targetLeft && rose.targetLeft <= r3.targetLeft, [r1.targetLeft, rose.targetLeft, r3.targetLeft]);
check("амбициозный — на 20% быстрее темпа, но не больше наличия", r3.targetLeft === Math.min(r3.sellable, Math.round(r3.demandLeft * 1.2)));
// Всплеск в первой декаде: осторожный берёт темп прошлого полного месяца, базовый — темп с весами.
const spike = [...orders, order("2026-11-08", "anya@x.kz", [["rose", 9000, 300]])];
const calmPlan = buildAiPlan({ ...base, orders: spike, scenario: "careful" }).flowers[0];
const basePlan = buildAiPlan({ ...base, orders: spike }).flowers[0];
check("осторожный не верит всплеску: темп прошлого полного месяца", calmPlan.targetLeft < basePlan.targetLeft && calmPlan.targetLeft === Math.round((7500 / 31) * 20), [calmPlan.targetLeft, basePlan.targetLeft]);
const scarce = buildAiPlan({ ...base, batches: [batch("rose", "2026-11-09", 300, 300)], forecast: { rose: { "2026-11-W3": 700 } }, writeoffs: [] });
check("цветка меньше обычных продаж — в план идёт только то, что есть", scarce.flowers[0].targetLeft === scarce.flowers[0].sellable && scarce.flowers[0].sellable < scarce.flowers[0].demandLeft && scarce.flowers[0].gap === 0, scarce.flowers[0]);

// Советы ИИ: множители двигают доли, суммы сходятся; чужие строки и дикие множители отбрасываются.
const advice = parseAiAdvice(
  { summary: "  Итог  ", managers: [{ email: "ANYA@x.kz", factor: 9, reason: "растёт" }, { email: "chuzhoy@x.kz", factor: 1.2, reason: "" }, { email: "borya@x.kz", factor: 0.1, reason: "падает" }],
    channels: [{ channel: "region", factor: 1.5, reason: "излишек" }, { channel: "moon", factor: 2, reason: "" }], directions: [{ direction: "Астана", factor: 1.3, reason: "фура" }], risks: ["р1"], actions: ["д1"] },
  p,
);
check("множители зажаты в границы", advice.managers[0].factor === FACTOR_MAX && advice.managers[1].factor === FACTOR_MIN && clampFactor("x") === 1);
check("чужой менеджер и выдуманный канал отброшены", advice.managers.length === 2 && advice.channels.length === 1);
const adv = buildAiPlan({ ...base, advice });
const a2 = adv.managers.find((m) => m.email === "anya@x.kz")!;
const b2 = adv.managers.find((m) => m.email === "borya@x.kz")!;
check("совет прибавил Ане и убавил Боре", a2.target.stems > anya.target.stems && b2.target.stems < borya.target.stems);
check("общий план цветка от советов не изменился", adv.flowers[0].targetLeft === rose.targetLeft && adv.channels.reduce((s, c) => s + (c.byFlower.rose?.stems ?? 0), 0) === rose.targetLeft);
check("канал «регионы» вырос, клиентский — уменьшился", adv.channels.find((c) => c.channel === "region")!.target.stems > p.channels.find((c) => c.channel === "region")!.target.stems && adv.channels.find((c) => c.channel === "clients")!.target.stems < clients.target.stems);
check("менеджеры снова сходятся с клиентским каналом", adv.managers.reduce((s, m) => s + (m.byFlower.rose?.stems ?? 0), 0) === adv.channels.find((c) => c.channel === "clients")!.byFlower.rose.stems);
check("причина ИИ стоит у строки", a2.reason === "растёт" && adv.directions.find((d) => d.direction === "Астана")!.reason === "фура");
check("направление с множителем выросло", adv.directions.find((d) => d.direction === "Астана")!.target.stems > astana!.target.stems);

// Следующий месяц: склада и факта нет, дни — весь месяц.
const next = buildAiPlan({ ...base, month: "2026-12", forecast: {} });
check("следующий месяц: весь месяц, без факта и склада", next.daysLeft === 31 && !next.isCurrent && next.flowers[0].stock === 0 && next.flowers[0].fact.stems === 0);
check("прогноза нет — срезка как средняя за 4 недели, и об этом сказано", next.flowers[0].forecastSource === "average" && next.notes.some((x) => x.includes("средняя")));

check("деление целого сходится", splitWhole(10, [1, 1, 1]).reduce((a, b) => a + b, 0) === 10 && splitWhole(7, [0, 0]).join() === "0,0");
const scaled = scaleQtyRow({ rose: { stems: 100, sum: 30000 }, eustoma: { stems: 50, sum: 10000 } }, "sum", 80000);
check("правка суммы масштабирует цветки", scaled.rose.sum === 60000 && scaled.rose.stems === 200 && scaled.eustoma.sum === 20000);
check("правка пустой строки кладёт всё в известный цветок", scaleQtyRow({}, "sum", 30000, { rose: 300 }).rose.stems === 100);
const wk = weeklySplit("2026-11", today, 20, 2000, 600000);
check("недели: только не закончившиеся, по дневному темпу", wk.length > 0 && wk[0].week === "2026-11-W3" && wk[0].stems === Math.round((2000 / 20) * 7), wk);
check("пустая база не роняет расчёт", buildAiPlan({ ...base, orders: [], batches: [], writeoffs: [], forecast: {} }).managers.length === 3);

console.log(failed ? `\nПровалено: ${failed}` : "\nВсё сходится.");
process.exit(failed ? 1 : 0);
