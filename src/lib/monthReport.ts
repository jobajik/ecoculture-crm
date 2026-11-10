import { localDayKey } from "./timezone";
import { isConsignment, isRegionOrder } from "./orderKind";
import { currentPrices, priceFor, type PriceRow } from "./priceList";
import { normalizeStore, storeLabel } from "./officeStore";
import { flowerTypesForFarm, formatGrade, compareGrades, FLOWER_TYPE_LABELS, ORDER_STATUSES } from "./constants";
import type { Batch, OrderWithItems, Payment, Shipment, StaffTakeout, Writeoff } from "./types";
import type { PointDay } from "./point";

// ---------------------------------------------------------------------------
// «Итоги месяца» (02.11.2026, владелец: «сделай мощную аналитику по продажам, срезу и другим показателям за месяц, чтобы
// можно было зайти и увидеть всё — я не смог получить глубокую аналитику за октябрь»). Один расчёт на страницу
// `/analytics/month` и выгрузку в Excel. Правила — те же, что в разборе октября 02.11 (`scripts/diag-farm-month.ts`):
//
// - СРЕЗАНО — приёмка основного склада (партии офиса и регионов — отрезки основных, приход ноль, не считаются);
//   день — день срезки, нет — день приёмки;
// - ПРОДАНО — позиции заявок месяца по дню ОФОРМЛЕНИЯ, без отменённых, по каналам: клиенты, объём на город (регион),
//   Пожарка, наши магазины. Где в заявке нет цены (регион, магазин), сумма — по клиентскому прайсу на день заявки;
// - отдельно «другие способы счёта»: по дню доставки, по факту отгрузки, отчёты Пожарки, деньги пришедшие в месяце.
// Чистая функция: ничего не читает — всё приходит готовым (страница читает таблицу одним `prefetchTables`).
// ---------------------------------------------------------------------------

export type Channel = "clients" | "region" | "point" | "shops";
export const CHANNEL_LABELS: Record<Channel, string> = {
  clients: "Клиенты",
  region: "Регионы (объём на город)",
  point: "Пожарка",
  shops: "Наши магазины",
};

export interface Money {
  qty: number;
  sum: number;
  /** Штук с ценой (у которых считается средняя). */
  priced: number;
}
export const m0 = (): Money => ({ qty: 0, sum: 0, priced: 0 });
export const madd = (a: Money, qty: number, price: number) => {
  a.qty += qty;
  if (price > 0) {
    a.sum += qty * price;
    a.priced += qty;
  }
};
export const avgPrice = (a: Money | undefined) => (a && a.priced ? a.sum / a.priced : 0);

export interface MonthReportInput {
  month: string; // ГГГГ-ММ
  farm: string; // "" — всё хозяйство
  batches: Batch[];
  orders: OrderWithItems[];
  shipments: Shipment[];
  writeoffs: Writeoff[];
  takeouts: StaffTakeout[];
  pointDays: PointDay[];
  payments: Payment[];
  priceRows: PriceRow[];
  names: Map<string, string>;
}

export interface GradeRow {
  flowerType: string;
  grade: string;
  label: string;
  cut: number;
  sold: Money;
  clients: Money;
  clientsPrevAvg: number;
  writeoff: number;
}

export interface MonthReport {
  month: string;
  prevMonth: string;
  farm: string;
  days: number;
  cut: { total: number; batches: number; receiveDays: number; prevTotal: number };
  channels: { channel: Channel; money: Money; byList: number }[];
  sold: Money;
  soldPrev: Money;
  clients: Money & { orders: number; clientCount: number; newClients: number };
  clientsPrev: Money & { orders: number };
  shipped: number;
  writeoff: { total: number; prevTotal: number; fromMonthCut: number; byReason: { reason: string; qty: number }[] };
  takeouts: { qty: number; sum: number };
  leftFromCut: number;
  grades: GradeRow[];
  varieties: { flowerType: string; variety: string; cut: number; sold: Money; writeoff: number }[];
  weeks: { label: string; from: string; to: string; cut: number; sold: number; clients: number; writeoff: number }[];
  managers: { name: string; money: Money; orders: number; clients: number }[];
  directions: { name: string; money: Money }[];
  stores: { name: string; money: Money }[];
  topClients: { name: string; money: Money; orders: number; prevQty: number }[];
  priceBands: { label: string; price: number; qty: number }[];
  views: { label: string; detail: string; qty: number; sum: number }[];
  insights: { level: "good" | "warn" | "bad" | "info"; text: string }[];
}

const dayOf = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : iso ? localDayKey(new Date(iso)) : "");

export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Месяц для открытия по умолчанию: первые 5 дней месяца — прошлый (итоги смотрят в начале месяца), потом — текущий. */
export function defaultMonth(today: string): string {
  const ym = today.slice(0, 7);
  return Number(today.slice(8, 10)) <= 5 ? shiftMonth(ym, -1) : ym;
}

export function cleanMonth(raw: string | null | undefined, today: string): string {
  const v = String(raw ?? "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && v <= today.slice(0, 7) ? v : defaultMonth(today);
}

export const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export const monthTitle = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

export function channelOf(o: OrderWithItems): Channel {
  if ((o.retail || "").trim()) return "shops";
  if (isRegionOrder(o)) return "region";
  if (isConsignment(o)) return "point";
  return "clients";
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

export function buildMonthReport(input: MonthReportInput): MonthReport {
  const { month, farm } = input;
  const prevMonth = shiftMonth(month, -1);
  const flowers = new Set(farm ? flowerTypesForFarm(farm) : flowerTypesForFarm(null));
  const inM = (iso: string, ym = month) => dayOf(iso).startsWith(ym);
  const batchById = new Map(input.batches.map((b) => [b.batchId, b]));
  const mine = (b: Batch | undefined) => !!b && flowers.has(b.flowerType);
  const gkey = (f: string, g: string) => `${f}|${g}`;
  const vkey = (f: string, v: string) => `${f}|${v}`;

  // --- Срезано ---
  const cutDay = (b: Batch) => dayOf(b.harvestDate || b.receivedAt);
  const mainOurs = input.batches.filter((b) => mine(b) && normalizeStore(b.store) === "" && b.quantityIn > 0);
  const cutBatches = mainOurs.filter((b) => cutDay(b).startsWith(month));
  const cutTotal = cutBatches.reduce((s, b) => s + b.quantityIn, 0);
  const cutPrev = mainOurs.filter((b) => cutDay(b).startsWith(prevMonth)).reduce((s, b) => s + b.quantityIn, 0);
  const receiveDays = new Set(cutBatches.map(cutDay)).size;
  const grades = new Map<string, GradeRow>();
  const grade = (f: string, g: string) => {
    const k = gkey(f, g);
    if (!grades.has(k))
      grades.set(k, { flowerType: f, grade: g, label: `${FLOWER_TYPE_LABELS[f] ?? f} · ${formatGrade(g)}`, cut: 0, sold: m0(), clients: m0(), clientsPrevAvg: 0, writeoff: 0 });
    return grades.get(k)!;
  };
  const varieties = new Map<string, { flowerType: string; variety: string; cut: number; sold: Money; writeoff: number }>();
  const variety = (f: string, v: string) => {
    const k = vkey(f, v || "—");
    if (!varieties.has(k)) varieties.set(k, { flowerType: f, variety: v || "—", cut: 0, sold: m0(), writeoff: 0 });
    return varieties.get(k)!;
  };
  for (const b of cutBatches) {
    grade(b.flowerType, b.grade).cut += b.quantityIn;
    variety(b.flowerType, b.variety).cut += b.quantityIn;
  }

  // --- Недели месяца (понедельник — воскресенье, обрезаны границами месяца) ---
  const days = daysInMonth(month);
  const weeks: MonthReport["weeks"] = [];
  {
    let start = 1;
    while (start <= days) {
      const dow = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, start)).getUTCDay(); // 0 — вс
      const end = Math.min(days, start + ((7 - dow) % 7));
      const from = `${month}-${String(start).padStart(2, "0")}`;
      const to = `${month}-${String(end).padStart(2, "0")}`;
      weeks.push({ label: `${String(start).padStart(2, "0")}–${String(end).padStart(2, "0")}`, from, to, cut: 0, sold: 0, clients: 0, writeoff: 0 });
      start = end + 1;
    }
  }
  const weekOf = (day: string) => weeks.find((w) => day >= w.from && day <= w.to);
  for (const b of cutBatches) {
    const w = weekOf(cutDay(b));
    if (w) w.cut += b.quantityIn;
  }

  // --- Продажи ---
  const priceOnDay = new Map<string, Map<string, PriceRow>>();
  const listPrice = (day: string, f: string, v: string, g: string) => {
    if (!priceOnDay.has(day)) priceOnDay.set(day, currentPrices(input.priceRows, day));
    return priceFor(priceOnDay.get(day)!, f, v, g);
  };
  const channels = new Map<Channel, { money: Money; byList: number }>();
  const sold = m0();
  const soldPrev = m0();
  const clients = { ...m0(), orders: 0, clientCount: 0, newClients: 0 };
  const clientsPrev = { ...m0(), orders: 0 };
  const clientSet = new Set<string>();
  const managers = new Map<string, { money: Money; orders: Set<string>; clients: Set<string> }>();
  const directions = new Map<string, Money>();
  const stores = new Map<string, Money>();
  const topClients = new Map<string, { name: string; money: Money; orders: Set<string>; prevQty: number }>();
  const bands = new Map<string, { label: string; price: number; qty: number }>();
  const prevGradeClients = new Map<string, Money>();
  const firstOrderDay = new Map<string, string>();
  for (const o of input.orders) {
    if (o.status === ORDER_STATUSES.CANCELLED || channelOf(o) !== "clients") continue;
    const key = o.clientId || o.clientName;
    const d = dayOf(o.createdAt);
    if (key && d && (!firstOrderDay.has(key) || d < firstOrderDay.get(key)!)) firstOrderDay.set(key, d);
  }
  for (const o of input.orders) {
    if (o.status === ORDER_STATUSES.CANCELLED) continue;
    const items = o.items.filter((i) => flowers.has(i.flowerType));
    if (!items.length) continue;
    const day = dayOf(o.createdAt);
    const ch = channelOf(o);
    const cKey = o.clientId || o.clientName || "—";
    if (day.startsWith(prevMonth)) {
      for (const i of items) {
        const price = i.unitPrice > 0 ? i.unitPrice : listPrice(day, i.flowerType, i.variety, i.grade);
        madd(soldPrev, i.quantity, price);
        if (ch === "clients") {
          madd(clientsPrev, i.quantity, i.unitPrice);
          const k = gkey(i.flowerType, i.grade);
          if (!prevGradeClients.has(k)) prevGradeClients.set(k, m0());
          madd(prevGradeClients.get(k)!, i.quantity, i.unitPrice);
          const tc = topClients.get(cKey);
          if (tc) tc.prevQty += i.quantity;
          else topClients.set(cKey, { name: o.clientName || "—", money: m0(), orders: new Set(), prevQty: i.quantity });
        }
      }
      if (ch === "clients") clientsPrev.orders++;
      continue;
    }
    if (!day.startsWith(month)) continue;
    if (!channels.has(ch)) channels.set(ch, { money: m0(), byList: 0 });
    const chAcc = channels.get(ch)!;
    if (ch === "clients") {
      clients.orders++;
      clientSet.add(cKey);
      if (firstOrderDay.get(cKey)?.startsWith(month)) clients.newClients++;
    }
    for (const i of items) {
      let price = i.unitPrice;
      if (!(price > 0)) {
        price = listPrice(day, i.flowerType, i.variety, i.grade);
        if (price > 0) chAcc.byList += i.quantity;
      }
      madd(chAcc.money, i.quantity, price);
      madd(sold, i.quantity, price);
      madd(grade(i.flowerType, i.grade).sold, i.quantity, price);
      madd(variety(i.flowerType, i.variety).sold, i.quantity, price);
      const w = weekOf(day);
      if (w) w.sold += i.quantity;
      if (ch !== "clients") continue;
      if (w) w.clients += i.quantity;
      madd(clients, i.quantity, i.unitPrice);
      madd(grade(i.flowerType, i.grade).clients, i.quantity, i.unitPrice);
      const mgr = input.names.get(o.managerEmail.toLowerCase()) || o.managerEmail || "—";
      if (!managers.has(mgr)) managers.set(mgr, { money: m0(), orders: new Set(), clients: new Set() });
      const mg = managers.get(mgr)!;
      madd(mg.money, i.quantity, i.unitPrice);
      mg.orders.add(o.orderId);
      mg.clients.add(cKey);
      const dir = (o.direction || "").trim() || "Алматы";
      if (!directions.has(dir)) directions.set(dir, m0());
      madd(directions.get(dir)!, i.quantity, i.unitPrice);
      const st = storeLabel(o.store);
      if (!stores.has(st)) stores.set(st, m0());
      madd(stores.get(st)!, i.quantity, i.unitPrice);
      if (!topClients.has(cKey)) topClients.set(cKey, { name: o.clientName || "—", money: m0(), orders: new Set(), prevQty: 0 });
      const tc = topClients.get(cKey)!;
      tc.name = o.clientName || tc.name;
      madd(tc.money, i.quantity, i.unitPrice);
      tc.orders.add(o.orderId);
      if (i.unitPrice > 0) {
        const bk = `${i.flowerType}|${i.grade}|${i.unitPrice}`;
        const b = bands.get(bk) ?? { label: `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType} · ${formatGrade(i.grade)}`, price: i.unitPrice, qty: 0 };
        b.qty += i.quantity;
        bands.set(bk, b);
      }
    }
  }
  clients.clientCount = clientSet.size;
  for (const [k, a] of Array.from(prevGradeClients.entries())) {
    const g = grades.get(k);
    if (g) g.clientsPrevAvg = avgPrice(a);
  }

  // --- Склад: отгрузки, списания, выдачи ---
  const shipped = input.shipments.filter((s) => inM(s.createdAt) && mine(batchById.get(s.batchId))).reduce((s, x) => s + x.quantity, 0);
  const rootOf = (b: Batch | undefined) => (b && b.sourceBatchId ? batchById.get(b.sourceBatchId) ?? b : b);
  const cutIds = new Set(cutBatches.map((b) => b.batchId));
  const byReason = new Map<string, number>();
  let woTotal = 0;
  let woPrev = 0;
  let woFromCut = 0;
  for (const w of input.writeoffs) {
    const b = batchById.get(w.batchId);
    if (!mine(b)) continue;
    if (inM(w.createdAt, prevMonth)) woPrev += w.quantity;
    if (!inM(w.createdAt)) {
      if (cutIds.has(rootOf(b)?.batchId ?? "")) woFromCut += w.quantity; // списано позже из срезки месяца
      continue;
    }
    woTotal += w.quantity;
    if (cutIds.has(rootOf(b)?.batchId ?? "")) woFromCut += w.quantity;
    byReason.set(w.reason || "—", (byReason.get(w.reason || "—") ?? 0) + w.quantity);
    grade(b!.flowerType, b!.grade).writeoff += w.quantity;
    variety(b!.flowerType, b!.variety).writeoff += w.quantity;
    const wk = weekOf(dayOf(w.createdAt));
    if (wk) wk.writeoff += w.quantity;
  }
  const tk = input.takeouts.filter((t) => inM(t.date || t.createdAt) && flowers.has(t.flowerType));
  const leftFromCut = input.batches.filter((b) => cutIds.has(rootOf(b)?.batchId ?? "") && mine(b)).reduce((s, b) => s + Math.max(0, b.quantityRemaining), 0);

  // --- Другие способы счёта ---
  const views: MonthReport["views"] = [];
  {
    const byDelivery = m0();
    for (const o of input.orders) {
      if (o.status === ORDER_STATUSES.CANCELLED || channelOf(o) !== "clients" || !inM(o.deliveryDate)) continue;
      for (const i of o.items) if (flowers.has(i.flowerType)) madd(byDelivery, i.quantity, i.unitPrice);
    }
    views.push({ label: "Клиенты — по дню доставки", detail: "заявки, которые везли в этом месяце, когда бы их ни оформили", qty: byDelivery.qty, sum: byDelivery.sum });
    const itemById = new Map<string, { o: OrderWithItems; price: number }>();
    for (const o of input.orders) for (const i of o.items) itemById.set(i.itemId, { o, price: i.unitPrice });
    const byShip = m0();
    for (const s of input.shipments) {
      if (!inM(s.createdAt) || !mine(batchById.get(s.batchId))) continue;
      const it = itemById.get(s.itemId);
      if (!it || it.o.status === ORDER_STATUSES.CANCELLED || channelOf(it.o) !== "clients") continue;
      madd(byShip, s.quantity, it.price);
    }
    views.push({ label: "Клиенты — по факту отгрузки", detail: "журнал отгрузок месяца × цена позиции", qty: byShip.qty, sum: byShip.sum });
    const pd = input.pointDays.filter((d) => inM(d.date) && (farm ? (d.farm || "") === farm : true));
    const pdMoney = pd.reduce((s, d) => s + d.kaspi + d.cash, 0);
    const pdStems = pd.reduce((s, d) => s + Object.entries(d.soldStems ?? {}).filter(([f]) => flowers.has(f)).reduce((x, [, q]) => x + q, 0), 0);
    views.push({ label: "Пожарка — отчёты точки", detail: `продано самой точкой, ${pd.length} дн.`, qty: pdStems, sum: pdMoney });
    const orderById = new Map(input.orders.map((o) => [o.orderId, o]));
    let paid = 0;
    for (const p of input.payments) {
      if (!inM(p.date)) continue;
      const o = orderById.get(p.orderId);
      if (!o) continue;
      const ours = p.farm ? !farm || p.farm === farm : p.flowerType ? flowers.has(p.flowerType) : o.items.length > 0 && o.items.every((i) => flowers.has(i.flowerType));
      if (ours) paid += p.amount;
    }
    views.push({ label: "Деньги, пришедшие в месяце", detail: "журнал оплат по дню оплаты", qty: 0, sum: paid });
  }

  // --- Выводы ---
  const insights: MonthReport["insights"] = [];
  const allSold = sold.qty;
  if (cutTotal > 0) insights.push({ level: "info", text: `Срезано ${nf(cutTotal)} шт., ушло по заявкам ${nf(allSold)} (${pct(allSold, cutTotal)}%), клиентам — ${nf(clients.qty)} (${pct(clients.qty, cutTotal)}%).` });
  if (clientsPrev.qty > 0) {
    const dq = pct(clients.qty - clientsPrev.qty, clientsPrev.qty);
    const da = avgPrice(clientsPrev) ? Math.round(((avgPrice(clients) - avgPrice(clientsPrev)) / avgPrice(clientsPrev)) * 100) : 0;
    insights.push({ level: dq >= 0 ? "good" : "warn", text: `Клиентам продано на ${dq >= 0 ? "+" : ""}${dq}% штук к прошлому месяцу; средняя цена ${nf(avgPrice(clients))} ₸ (${da >= 0 ? "+" : ""}${da}%).` });
  }
  const weekNoCut = weeks.filter((w) => w.cut === 0 && w.to <= localDayKey());
  if (cutTotal > 0 && weekNoCut.length) insights.push({ level: "warn", text: `Нет приёмки за ${weekNoCut.map((w) => w.label).join(", ")} — срезка этих дней не занесена или занесена другими датами.` });
  if (cutTotal > 0 && woTotal > cutTotal * 0.15) insights.push({ level: "bad", text: `Списано ${nf(woTotal)} шт. — ${pct(woTotal, cutTotal)}% от срезанного (из срезки этого месяца — ${nf(woFromCut)}).` });
  for (const g of Array.from(grades.values())) {
    if (g.cut >= 2000 && g.sold.qty < g.cut * 0.3) insights.push({ level: "warn", text: `${g.label}: срезано ${nf(g.cut)}, ушло ${nf(g.sold.qty)} (${pct(g.sold.qty, g.cut)}%)${g.writeoff ? `, списано ${nf(g.writeoff)}` : ""}.` });
  }
  const top = Array.from(topClients.values()).filter((t) => t.money.qty > 0).sort((a, b) => b.money.qty - a.money.qty);
  if (top.length >= 2 && clients.qty > 0) {
    const two = top[0].money.qty + top[1].money.qty;
    if (two > clients.qty * 0.4) insights.push({ level: "warn", text: `Два крупнейших клиента — ${pct(two, clients.qty)}% штук клиентам (${top[0].name}, ${top[1].name}).` });
  }

  const money = (m: Money) => m;
  return {
    month,
    prevMonth,
    farm,
    days,
    cut: { total: cutTotal, batches: cutBatches.length, receiveDays, prevTotal: cutPrev },
    channels: (["clients", "region", "point", "shops"] as Channel[]).filter((c) => channels.has(c)).map((c) => ({ channel: c, money: money(channels.get(c)!.money), byList: channels.get(c)!.byList })),
    sold,
    soldPrev,
    clients,
    clientsPrev,
    shipped,
    writeoff: { total: woTotal, prevTotal: woPrev, fromMonthCut: woFromCut, byReason: Array.from(byReason.entries()).map(([reason, qty]) => ({ reason, qty })).sort((a, b) => b.qty - a.qty) },
    takeouts: { qty: tk.reduce((s, t) => s + t.quantity, 0), sum: tk.reduce((s, t) => s + t.quantity * (t.unitPrice || 0), 0) },
    leftFromCut,
    grades: Array.from(grades.values())
      .filter((g) => g.cut || g.sold.qty || g.writeoff)
      .sort((a, b) => a.flowerType.localeCompare(b.flowerType) || compareGrades(a.flowerType, a.grade, b.grade)),
    varieties: Array.from(varieties.values())
      .filter((v) => v.cut || v.sold.qty || v.writeoff)
      .sort((a, b) => b.sold.qty + b.cut - (a.sold.qty + a.cut)),
    weeks,
    managers: Array.from(managers.entries())
      .map(([name, x]) => ({ name, money: x.money, orders: x.orders.size, clients: x.clients.size }))
      .sort((a, b) => b.money.sum - a.money.sum),
    directions: Array.from(directions.entries()).map(([name, m]) => ({ name, money: m })).sort((a, b) => b.money.qty - a.money.qty),
    stores: Array.from(stores.entries()).map(([name, m]) => ({ name, money: m })).sort((a, b) => b.money.qty - a.money.qty),
    topClients: top.slice(0, 20).map((t) => ({ name: t.name, money: t.money, orders: t.orders.size, prevQty: t.prevQty })),
    priceBands: Array.from(bands.values()).sort((a, b) => b.qty - a.qty).slice(0, 20),
    views,
    insights,
  };
}
