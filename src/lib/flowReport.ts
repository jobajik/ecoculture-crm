import { localDayKey } from "./timezone";
import { isRegionOrder } from "./orderKind";
import { currentPrices, priceFor, type PriceRow } from "./priceList";
import { isRegionStore, normalizeStore } from "./officeStore";
import { avgPrice, channelOf, m0, madd, CHANNEL_LABELS, type Channel, type Money } from "./monthReport";
import { compareGrades, FARM_LABELS, flowerTypesForFarm, formatGrade, FLOWER_TYPE_LABELS, getFarmFor, ORDER_STATUSES, weeksOfMonth } from "./constants";
import type { Batch, OrderWithItems, Shipment, StaffTakeout, Writeoff } from "./types";
import type { StockMove } from "./repo/stockMoves";
import type { HarvestForecastRow } from "./repo/harvestForecast";

// ---------------------------------------------------------------------------
// «Срез · продажи · списания» (10.11.2026, владелец: «аналитика по срезали, продали, списали по каждому цветку, по
// компаниям, по категориям, с возможностью выбора периода и прочее; подумай, что можно туда включить»). Страница
// `/analytics/flow`, выгрузка в Excel — тот же расчёт. Чистая функция: ничего не читает.
//
// Правила счёта (те же, что в «Итогах месяца», где они совпадают):
// - СРЕЗАНО — приёмка основного склада (`quantityIn` > 0, склад — основной; офисные и региональные партии — отрезки
//   основных, приход ноль); день — день срезки, нет — приёмки;
// - ПРОДАНО — позиции заявок периода по дню ОФОРМЛЕНИЯ, без отменённых; цена позиции, нет — клиентский прайс на день
//   заявки. Заявки СО СКЛАДА АСТАНЫ не считаются: этот цветок уже ушёл с основного склада «объёмом на город», второй
//   раз он не продаётся — иначе один стебель считался бы дважды;
// - ОТГРУЖЕНО — журнал отгрузок с основного и офисного складов (в том числе объём в регион — он покидает хозяйство);
// - СПИСАНО — журнал списаний по дню списания, любой склад (потеря цветка есть потеря);
// - ВЫДАНО — выдачи сотрудникам и на нужды компании;
// - ОСТАТОК — основной и офисный склады; склад Астаны — отдельной строкой. Остаток на начало и конец периода
//   восстанавливается от сегодняшнего: сегодня + всё, что ушло после конца периода − всё, что пришло после;
// - ПРОШЛЫЙ ПЕРИОД — такой же длины, впритык перед выбранным.
// ---------------------------------------------------------------------------

export interface FlowInput {
  from: string; // ГГГГ-ММ-ДД, включительно
  to: string;
  farm: string; // "" — всё хозяйство
  flower: string; // "" — все цветы
  today: string;
  batches: Batch[];
  orders: OrderWithItems[];
  shipments: Shipment[];
  writeoffs: Writeoff[];
  takeouts: StaffTakeout[];
  moves: StockMove[];
  forecast: HarvestForecastRow[];
  priceRows: PriceRow[];
  names: Map<string, string>;
}

export interface FlowRow {
  key: string;
  label: string;
  flowerType: string;
  cut: number;
  sold: Money;
  shipped: number;
  writeoff: number;
  takeouts: number;
  remaining: number;
  prev: { cut: number; sold: Money; writeoff: number };
}

export interface FlowPoint {
  label: string;
  from: string;
  to: string;
  cut: number;
  sold: number;
  shipped: number;
  writeoff: number;
}

export const AGE_BUCKETS = ["0–3 дн.", "4–7 дн.", "8–14 дн.", "15+ дн."];

export interface FlowReport {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
  farm: string;
  flower: string;
  total: FlowRow;
  balance: { start: number; end: number; now: number; region: number };
  toOffice: number;
  toRegion: number;
  regionSold: number;
  byFarm: FlowRow[];
  byFlower: FlowRow[];
  byGrade: FlowRow[];
  byVariety: FlowRow[];
  timeline: { unit: "day" | "week"; points: FlowPoint[] };
  channels: { channel: Channel; label: string; money: Money; byList: number; orders: number }[];
  writeoffReasons: { reason: string; qty: number }[];
  writeoffPeople: { name: string; qty: number }[];
  writeoffAge: { bucket: string; qty: number }[];
  writeoffAgeMedian: number | null;
  shipAge: { flowerType: string; label: string; median: number | null; over7: number; qty: number }[];
  stockAge: { flowerType: string; label: string; buckets: number[]; total: number }[];
  forecast: { flowerType: string; label: string; plan: number; fact: number }[];
  forecastVarieties: { label: string; plan: number; fact: number }[];
  insights: { level: "good" | "warn" | "bad" | "info"; text: string }[];
}

const dayOf = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : iso ? localDayKey(new Date(iso)) : "");
const ms = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const dayFromMs = (t: number) => new Date(t).toISOString().slice(0, 10);
export const shiftDay = (day: string, by: number) => dayFromMs(ms(day) + by * 86_400_000);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86_400_000);
const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/**
 * Причина списания для группировки: зав. складом дописывает к выбранной причине даты и кавычки («Порча / истёк срок
 * хранения · С 17.10 по 24.10», «„Порча / истёк срок хранения“.») — всё это одна причина. Берётся часть до « · »,
 * кавычки и точки по краям снимаются.
 */
export function cleanReason(raw: string | null | undefined): string {
  const first = String(raw ?? "").split(" · ")[0].split("·")[0];
  const v = first.replace(/[«»"„“”']/g, "").replace(/^[\s.,;:!-]+|[\s.,;:!-]+$/g, "").replace(/\s+/g, " ").trim();
  return v || "—";
}
const ageBucket = (days: number) => (days <= 3 ? 0 : days <= 7 ? 1 : days <= 14 ? 2 : 3);

/** Готовые периоды для страницы. */
export function presetRange(preset: string, today: string): { from: string; to: string } {
  const ym = today.slice(0, 7);
  const dow = (new Date(ms(today)).getUTCDay() + 6) % 7; // 0 — понедельник
  switch (preset) {
    case "week":
      return { from: shiftDay(today, -dow), to: today };
    case "7":
      return { from: shiftDay(today, -6), to: today };
    case "month":
      return { from: `${ym}-01`, to: today };
    case "prev-month": {
      const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1));
      const pm = d.toISOString().slice(0, 7);
      return { from: `${pm}-01`, to: shiftDay(`${ym}-01`, -1) };
    }
    case "90":
      return { from: shiftDay(today, -89), to: today };
    case "30":
    default:
      return { from: shiftDay(today, -29), to: today };
  }
}

/** Проверенные границы периода из адреса: мусор — последние 30 дней; конец не позже сегодня; не длиннее года. */
export function cleanRange(from: string | null | undefined, to: string | null | undefined, today: string): { from: string; to: string } {
  const ok = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(ms(String(v)));
  if (!ok(from) || !ok(to)) return presetRange("30", today);
  let f = String(from);
  let t = String(to);
  if (t > today) t = today;
  if (f > t) [f, t] = [t, f];
  if (daysBetween(f, t) > 366) f = shiftDay(t, -366);
  return { from: f, to: t };
}

export function buildFlowReport(input: FlowInput): FlowReport {
  const { from, to, farm, flower, today } = input;
  const days = daysBetween(from, to) + 1;
  const prevTo = shiftDay(from, -1);
  const prevFrom = shiftDay(prevTo, -(days - 1));
  const inCur = (day: string) => day >= from && day <= to;
  const inPrev = (day: string) => day >= prevFrom && day <= prevTo;
  const after = (day: string) => day > to;

  const flowerSet = new Set((farm ? flowerTypesForFarm(farm) : flowerTypesForFarm(null)).filter((f) => !flower || f === flower));
  const mine = (f: string | undefined) => !!f && flowerSet.has(f);
  const batchById = new Map(input.batches.map((b) => [b.batchId, b]));
  const rootOf = (b: Batch | undefined): Batch | undefined => (b && b.sourceBatchId ? batchById.get(b.sourceBatchId) ?? b : b);
  const cutDay = (b: Batch) => dayOf(b.harvestDate || b.receivedAt);
  const farmStore = (b: Batch | undefined) => !!b && !isRegionStore(b.store); // основной или офис
  const flowerLabel = (f: string) => FLOWER_TYPE_LABELS[f] ?? f;

  // --- Накопители по разрезам ---
  const mkRow = (key: string, label: string, flowerType: string): FlowRow => ({ key, label, flowerType, cut: 0, sold: m0(), shipped: 0, writeoff: 0, takeouts: 0, remaining: 0, prev: { cut: 0, sold: m0(), writeoff: 0 } });
  const total = mkRow("total", "Итого", "");
  const dims = { farm: new Map<string, FlowRow>(), flower: new Map<string, FlowRow>(), grade: new Map<string, FlowRow>(), variety: new Map<string, FlowRow>() };
  const rowsFor = (f: string, grade: string, variety: string): FlowRow[] => {
    const fm = getFarmFor(f) ?? "";
    const get = (m: Map<string, FlowRow>, key: string, label: string) => {
      if (!m.has(key)) m.set(key, mkRow(key, label, f));
      return m.get(key)!;
    };
    return [
      total,
      get(dims.farm, fm, FARM_LABELS[fm] ?? fm ?? "—"),
      get(dims.flower, f, flowerLabel(f)),
      get(dims.grade, `${f}|${grade}`, `${flowerLabel(f)} · ${formatGrade(grade)}`),
      get(dims.variety, `${f}|${variety || "—"}`, `${flowerLabel(f)} · ${variety || "—"}`),
    ];
  };

  // --- Срезано ---
  const mainCut = input.batches.filter((b) => mine(b.flowerType) && normalizeStore(b.store) === "" && b.quantityIn > 0);
  let cutAfter = 0;
  for (const b of mainCut) {
    const d = cutDay(b);
    if (inCur(d)) for (const r of rowsFor(b.flowerType, b.grade, b.variety)) r.cut += b.quantityIn;
    else if (inPrev(d)) for (const r of rowsFor(b.flowerType, b.grade, b.variety)) r.prev.cut += b.quantityIn;
    if (after(d)) cutAfter += b.quantityIn;
  }

  // --- Продано (заявки) ---
  const priceOnDay = new Map<string, Map<string, PriceRow>>();
  const listPrice = (day: string, f: string, v: string, g: string) => {
    if (!priceOnDay.has(day)) priceOnDay.set(day, currentPrices(input.priceRows, day));
    return priceFor(priceOnDay.get(day)!, f, v, g);
  };
  const channels = new Map<Channel, { money: Money; byList: number; orders: Set<string> }>();
  let regionSold = 0;
  for (const o of input.orders) {
    if (o.status === ORDER_STATUSES.CANCELLED) continue;
    const day = dayOf(o.createdAt);
    const items = o.items.filter((i) => mine(i.flowerType));
    if (!items.length) continue;
    if (isRegionStore(o.store)) {
      if (inCur(day)) regionSold += items.reduce((s, i) => s + i.quantity, 0);
      continue;
    }
    const cur = inCur(day);
    const prev = inPrev(day);
    if (!cur && !prev) continue;
    const ch = channelOf(o);
    if (cur && !channels.has(ch)) channels.set(ch, { money: m0(), byList: 0, orders: new Set() });
    const chAcc = cur ? channels.get(ch)! : null;
    if (chAcc) chAcc.orders.add(o.orderId);
    for (const i of items) {
      let price = i.unitPrice;
      let byList = false;
      if (!(price > 0)) {
        price = listPrice(day, i.flowerType, i.variety, i.grade);
        byList = price > 0;
      }
      for (const r of rowsFor(i.flowerType, i.grade, i.variety)) {
        if (cur) madd(r.sold, i.quantity, price);
        else madd(r.prev.sold, i.quantity, price);
      }
      if (chAcc) {
        madd(chAcc.money, i.quantity, price);
        if (byList) chAcc.byList += i.quantity;
      }
    }
  }

  // --- Отгружено, возраст при отгрузке ---
  let shippedAfter = 0;
  const shipAges = new Map<string, number[]>();
  const shipOver7 = new Map<string, number>();
  const shipQty = new Map<string, number>();
  let toRegion = 0;
  const orderById = new Map(input.orders.map((o) => [o.orderId, o]));
  for (const s of input.shipments) {
    const b = batchById.get(s.batchId);
    if (!b || !mine(b.flowerType) || !farmStore(b)) continue;
    const d = dayOf(s.createdAt);
    if (after(d)) shippedAfter += s.quantity;
    if (!inCur(d)) continue;
    for (const r of rowsFor(b.flowerType, b.grade, b.variety)) r.shipped += s.quantity;
    if (isRegionOrder(orderById.get(s.orderId))) toRegion += s.quantity;
    const root = rootOf(b);
    const cd = root ? cutDay(root) : "";
    if (cd) {
      const age = Math.max(0, daysBetween(cd, d));
      if (!shipAges.has(b.flowerType)) shipAges.set(b.flowerType, []);
      for (let k = 0; k < Math.min(s.quantity, 50); k++) shipAges.get(b.flowerType)!.push(age); // взвешенно, но без миллионов элементов
      if (age > 7) shipOver7.set(b.flowerType, (shipOver7.get(b.flowerType) ?? 0) + s.quantity);
      shipQty.set(b.flowerType, (shipQty.get(b.flowerType) ?? 0) + s.quantity);
    }
  }

  // --- Списано ---
  let writeoffAfter = 0;
  const reasons = new Map<string, number>();
  const people = new Map<string, number>();
  const woAge = [0, 0, 0, 0];
  const woAges: number[] = [];
  for (const w of input.writeoffs) {
    const b = batchById.get(w.batchId);
    if (!b || !mine(b.flowerType)) continue;
    const d = dayOf(w.createdAt);
    if (after(d) && farmStore(b)) writeoffAfter += w.quantity;
    if (inPrev(d)) for (const r of rowsFor(b.flowerType, b.grade, b.variety)) r.prev.writeoff += w.quantity;
    if (!inCur(d)) continue;
    for (const r of rowsFor(b.flowerType, b.grade, b.variety)) r.writeoff += w.quantity;
    const reason = cleanReason(w.reason);
    reasons.set(reason, (reasons.get(reason) ?? 0) + w.quantity);
    const who = input.names.get((w.warehouseEmail || "").toLowerCase()) || w.warehouseEmail || "—";
    people.set(who, (people.get(who) ?? 0) + w.quantity);
    const root = rootOf(b);
    const cd = root ? cutDay(root) : "";
    if (cd) {
      const age = Math.max(0, daysBetween(cd, d));
      woAge[ageBucket(age)] += w.quantity;
      for (let k = 0; k < Math.min(w.quantity, 50); k++) woAges.push(age);
    }
  }

  // --- Выдано, перемещено ---
  let takeoutAfter = 0;
  for (const t of input.takeouts) {
    if (!mine(t.flowerType)) continue;
    const d = dayOf(t.date || t.createdAt);
    const b = batchById.get(t.batchId);
    if (after(d) && (!b || farmStore(b))) takeoutAfter += t.quantity;
    if (!inCur(d)) continue;
    for (const r of rowsFor(t.flowerType, t.grade, t.variety)) r.takeouts += t.quantity;
  }
  const toOffice = input.moves.filter((m) => m.direction === "to_office" && mine(m.flowerType) && inCur(dayOf(m.createdAt))).reduce((s, m) => s + m.quantity, 0);

  // --- Остатки и свежесть ---
  let now = 0;
  let region = 0;
  const stockAge = new Map<string, number[]>();
  for (const b of input.batches) {
    if (!mine(b.flowerType) || b.quantityRemaining <= 0) continue;
    if (isRegionStore(b.store)) {
      region += b.quantityRemaining;
      continue;
    }
    now += b.quantityRemaining;
    for (const r of rowsFor(b.flowerType, b.grade, b.variety)) r.remaining += b.quantityRemaining;
    const root = rootOf(b);
    const cd = root ? cutDay(root) : "";
    if (cd) {
      if (!stockAge.has(b.flowerType)) stockAge.set(b.flowerType, [0, 0, 0, 0]);
      stockAge.get(b.flowerType)![ageBucket(Math.max(0, daysBetween(cd, today)))] += b.quantityRemaining;
    }
  }
  const end = to >= today ? now : now + shippedAfter + writeoffAfter + takeoutAfter - cutAfter;
  const start = end - total.cut + total.shipped + total.writeoff + total.takeouts;

  // --- Динамика: по дням (до 35 дней) или по неделям ---
  const unit: "day" | "week" = days <= 35 ? "day" : "week";
  const points: FlowPoint[] = [];
  if (unit === "day") {
    for (let d = from; d <= to; d = shiftDay(d, 1)) points.push({ label: `${d.slice(8, 10)}.${d.slice(5, 7)}`, from: d, to: d, cut: 0, sold: 0, shipped: 0, writeoff: 0 });
  } else {
    let s = from;
    while (s <= to) {
      const dow = (new Date(ms(s)).getUTCDay() + 6) % 7;
      const e0 = shiftDay(s, 6 - dow);
      const e = e0 > to ? to : e0;
      points.push({ label: `${s.slice(8, 10)}.${s.slice(5, 7)}`, from: s, to: e, cut: 0, sold: 0, shipped: 0, writeoff: 0 });
      s = shiftDay(e, 1);
    }
  }
  const pointOf = (day: string) => points.find((p) => day >= p.from && day <= p.to);
  for (const b of mainCut) {
    const p = inCur(cutDay(b)) ? pointOf(cutDay(b)) : undefined;
    if (p) p.cut += b.quantityIn;
  }
  for (const o of input.orders) {
    if (o.status === ORDER_STATUSES.CANCELLED || isRegionStore(o.store)) continue;
    const p = pointOf(dayOf(o.createdAt));
    if (p) p.sold += o.items.filter((i) => mine(i.flowerType)).reduce((s, i) => s + i.quantity, 0);
  }
  for (const s of input.shipments) {
    const b = batchById.get(s.batchId);
    if (!b || !mine(b.flowerType) || !farmStore(b)) continue;
    const p = pointOf(dayOf(s.createdAt));
    if (p) p.shipped += s.quantity;
  }
  for (const w of input.writeoffs) {
    const b = batchById.get(w.batchId);
    if (!b || !mine(b.flowerType)) continue;
    const p = pointOf(dayOf(w.createdAt));
    if (p) p.writeoff += w.quantity;
  }

  // --- План срезки агронома против факта (недели месяца, обрезанные периодом) ---
  const planByFlower = new Map<string, number>();
  const planByVariety = new Map<string, { label: string; plan: number; fact: number }>();
  const months = new Set<string>();
  for (let d = from.slice(0, 7); d <= to.slice(0, 7); ) {
    months.add(d);
    const [y, m] = d.split("-").map(Number);
    d = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  }
  const weekSpan = new Map<string, { from: string; to: string; days: number }>();
  for (const mo of Array.from(months)) for (const w of weeksOfMonth(mo)) weekSpan.set(w.code, { from: w.from, to: w.to, days: w.days });
  for (const f of input.forecast) {
    if (!mine(f.flowerType) || f.targetStems <= 0) continue;
    const w = weekSpan.get(f.period);
    if (!w) continue;
    const oFrom = w.from > from ? w.from : from;
    const oTo = w.to < to ? w.to : to;
    if (oFrom > oTo) continue;
    const share = (daysBetween(oFrom, oTo) + 1) / w.days;
    const plan = f.targetStems * share;
    planByFlower.set(f.flowerType, (planByFlower.get(f.flowerType) ?? 0) + plan);
    const vk = `${f.flowerType}|${f.variety}`;
    if (!planByVariety.has(vk)) planByVariety.set(vk, { label: `${flowerLabel(f.flowerType)} · ${f.variety}`, plan: 0, fact: 0 });
    planByVariety.get(vk)!.plan += plan;
  }
  for (const [vk, v] of Array.from(planByVariety.entries())) v.fact = dims.variety.get(vk)?.cut ?? 0;
  const forecast = Array.from(planByFlower.entries()).map(([f, plan]) => ({ flowerType: f, label: flowerLabel(f), plan: Math.round(plan), fact: dims.flower.get(f)?.cut ?? 0 }));

  // --- Сборка строк ---
  const live = (r: FlowRow) => r.cut || r.sold.qty || r.shipped || r.writeoff || r.takeouts || r.remaining || r.prev.cut || r.prev.sold.qty;
  const flowerOrder = (a: FlowRow, b: FlowRow) => (b.cut + b.sold.qty) - (a.cut + a.sold.qty);
  const byGrade = Array.from(dims.grade.values())
    .filter(live)
    .sort((a, b) => a.flowerType.localeCompare(b.flowerType) || compareGrades(a.flowerType, a.key.split("|")[1], b.key.split("|")[1]));

  // --- Выводы ---
  const insights: FlowReport["insights"] = [];
  const t = total;
  if (t.cut > 0) insights.push({ level: "info", text: `Срезано ${nf(t.cut)} шт., продано по заявкам ${nf(t.sold.qty)} (${pct(t.sold.qty, t.cut)}%), отгружено со склада ${nf(t.shipped)}, списано ${nf(t.writeoff)} (${pct(t.writeoff, t.cut)}% от срезанного).` });
  if (t.prev.cut > 0 && t.cut > 0) {
    const d = pct(t.cut - t.prev.cut, t.prev.cut);
    insights.push({ level: d >= 0 ? "good" : "warn", text: `Срезка ${d >= 0 ? "+" : ""}${d}% к прошлому периоду (${nf(t.prev.cut)} шт.), продажи ${t.prev.sold.qty ? `${pct(t.sold.qty - t.prev.sold.qty, t.prev.sold.qty) >= 0 ? "+" : ""}${pct(t.sold.qty - t.prev.sold.qty, t.prev.sold.qty)}%` : "—"} в штуках${t.prev.sold.sum ? `, ${pct(t.sold.sum - t.prev.sold.sum, t.prev.sold.sum) >= 0 ? "+" : ""}${pct(t.sold.sum - t.prev.sold.sum, t.prev.sold.sum)}% в деньгах` : ""}.` });
  }
  if (t.cut > 0 && t.writeoff > t.cut * 0.15) insights.push({ level: "bad", text: `Списания ${pct(t.writeoff, t.cut)}% от срезки — выше 15 %. Главная причина: ${Array.from(reasons.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"}.` });
  for (const r of Array.from(dims.flower.values()).sort(flowerOrder)) {
    if (r.cut >= 1000 && r.writeoff > r.cut * 0.2) insights.push({ level: "bad", text: `${r.label}: списано ${nf(r.writeoff)} из ${nf(r.cut)} срезанных (${pct(r.writeoff, r.cut)}%).` });
    if (r.cut >= 2000 && r.sold.qty < r.cut * 0.5) insights.push({ level: "warn", text: `${r.label}: продано ${pct(r.sold.qty, r.cut)}% от срезанного — ${nf(r.cut - r.sold.qty)} шт. не нашли покупателя в периоде.` });
    const av = avgPrice(r.sold);
    const pv = avgPrice(r.prev.sold);
    if (av && pv && Math.abs(av - pv) / pv >= 0.1) insights.push({ level: av > pv ? "good" : "warn", text: `${r.label}: средняя цена ${nf(av)} ₸ против ${nf(pv)} ₸ в прошлом периоде (${av > pv ? "+" : ""}${pct(av - pv, pv)}%).` });
  }
  for (const g of byGrade) {
    if (g.cut >= 1500 && g.sold.qty < g.cut * 0.3) insights.push({ level: "warn", text: `${g.label}: срезано ${nf(g.cut)}, продано ${nf(g.sold.qty)} (${pct(g.sold.qty, g.cut)}%)${g.writeoff ? `, списано ${nf(g.writeoff)}` : ""}.` });
  }
  const woMed = median(woAges);
  if (woMed !== null && woMed <= 3 && t.writeoff >= 300) insights.push({ level: "bad", text: `Половина списанного не пролежала и ${Math.max(1, Math.round(woMed))} дн. — это не старение, а брак при срезке или приёмке.` });
  for (const f of forecast) {
    if (f.plan >= 500 && f.fact < f.plan * 0.8) insights.push({ level: "warn", text: `${f.label}: по плану срезки агронома ${nf(f.plan)} шт., принято ${nf(f.fact)} (${pct(f.fact, f.plan)}%).` });
  }
  const old = Array.from(stockAge.entries()).map(([f, b]) => ({ f, old: b[2] + b[3], all: b.reduce((s, x) => s + x, 0) })).filter((x) => x.all >= 500 && x.old > x.all * 0.3);
  for (const x of old) insights.push({ level: "warn", text: `${flowerLabel(x.f)}: на складе сейчас ${nf(x.old)} из ${nf(x.all)} стеблей старше недели — продавать в первую очередь или списывать.` });

  return {
    from,
    to,
    prevFrom,
    prevTo,
    days,
    farm,
    flower,
    total,
    balance: { start, end, now, region },
    toOffice,
    toRegion,
    regionSold,
    byFarm: Array.from(dims.farm.values()).filter(live).sort((a, b) => a.key.localeCompare(b.key)),
    byFlower: Array.from(dims.flower.values()).filter(live).sort(flowerOrder),
    byGrade,
    byVariety: Array.from(dims.variety.values()).filter(live).sort(flowerOrder).slice(0, 40),
    timeline: { unit, points },
    channels: (["clients", "region", "point", "shops"] as Channel[])
      .filter((c) => channels.has(c))
      .map((c) => ({ channel: c, label: CHANNEL_LABELS[c], money: channels.get(c)!.money, byList: channels.get(c)!.byList, orders: channels.get(c)!.orders.size })),
    writeoffReasons: Array.from(reasons.entries()).map(([reason, qty]) => ({ reason, qty })).sort((a, b) => b.qty - a.qty),
    writeoffPeople: Array.from(people.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
    writeoffAge: AGE_BUCKETS.map((bucket, i) => ({ bucket, qty: woAge[i] })),
    writeoffAgeMedian: woMed,
    shipAge: Array.from(shipQty.entries()).map(([f, qty]) => ({ flowerType: f, label: flowerLabel(f), median: median(shipAges.get(f) ?? []), over7: shipOver7.get(f) ?? 0, qty })).sort((a, b) => b.qty - a.qty),
    stockAge: Array.from(stockAge.entries()).map(([f, buckets]) => ({ flowerType: f, label: flowerLabel(f), buckets, total: buckets.reduce((s, x) => s + x, 0) })).sort((a, b) => b.total - a.total),
    forecast: forecast.sort((a, b) => b.plan - a.plan),
    forecastVarieties: Array.from(planByVariety.values()).sort((a, b) => b.plan - a.plan).slice(0, 15),
    insights,
  };
}
