import { listOrdersWithItems } from "./repo/orders";
import { listBatches } from "./repo/batches";
import { listWriteoffs } from "./repo/writeoffs";
import { listPriceHistory } from "./repo/priceHistory";
import { listHarvestForecast } from "./repo/harvestForecast";
import { getSettings } from "./repo/settings";
import { computeBatchStorageInfo, getMaxShelfLifeDays } from "./shelfLife";
import { currentPrices, priceFor, type PriceRow } from "./priceList";
import { priceChangeDays, daysSinceLastChange } from "./priceChanges";
import {
  FLOWER_TYPE_LABELS,
  compareGrades,
  formatGrade,
  getFarmFor,
  isLiquidGrade,
  isTopGrade,
  monthOfWeek,
} from "./constants";
import { toIsoDate } from "./sheetDate";
import { BENCHMARKS } from "./benchmarks";
import type { OrderWithItems } from "./types";

// ---------------------------------------------------------------------------
// Аналитика: цифры, а не картинки.
//
// Владелец прямо попросил меньше графиков и больше чисел с ориентирами. Поэтому
// здесь всё считается парами «сейчас / было» за два одинаковых окна: последние
// 30 дней и предыдущие 30. Сравнение календарных месяцев в середине месяца врёт
// (восьмое сентября против всего августа), а два равных окна честны в любой день.
//
// Каждая метрика, у которой есть «правильное» значение, сравнивается с
// ориентиром из BENCHMARKS. Ориентиры — бизнес-решение владельца, а не
// техническая константа: меняются здесь, и подсветка по всей странице
// пересчитывается сама.
// ---------------------------------------------------------------------------

/** Длина окна сравнения в днях. */
export const ANALYTICS_DAYS = 30;

// Ориентиры вынесены в ./benchmarks — их читает и страница в браузере.
export { BENCHMARKS, toneLowerBetter, toneHigherBetter } from "./benchmarks";
export type { Tone, Benchmark } from "./benchmarks";

export interface Delta {
  /** Значение за текущее окно. */
  value: number;
  /** Значение за предыдущее окно такой же длины. */
  prev: number;
  /** Рост в процентах. null — сравнивать не с чем (в прошлом окне ноль). */
  changePercent: number | null;
}

function delta(value: number, prev: number): Delta {
  return {
    value,
    prev,
    changePercent: prev > 0 ? ((value - prev) / prev) * 100 : null,
  };
}

export interface FlowerRow {
  flowerType: string;
  /** Принято на склад за период, стеблей. */
  received: number;
  /** Продано (оформлено в заявках) за период, стеблей. */
  sold: number;
  /** Списано за период, стеблей. */
  writeoff: number;
  /** Лежит на складе сейчас. */
  stock: number;
  /** На сколько дней хватит склада при нынешнем темпе продаж. */
  coverDays: number | null;
  /** Срок хранения этого цветка. */
  shelfLifeDays: number;
  revenue: number;
  revenueShare: number;
  avgPrice: Delta;
  /** Доля высшей категории в приёмке за период, %. */
  topGradePercent: number | null;
}

export interface GradeRow {
  flowerType: string;
  grade: string;
  label: string;
  stems: number;
  revenue: number;
  avgPrice: Delta;
  share: number;
}

export interface VarietyRow {
  key: string;
  flowerType: string;
  variety: string;
  stems: number;
  revenue: Delta;
  share: number;
}

export interface ClientRow {
  clientName: string;
  orders: number;
  revenue: number;
  share: number;
  /** Сколько дней назад была последняя заявка. */
  lastOrderDaysAgo: number;
  /** Неоплаченное по этому клиенту за всё время. */
  debt: number;
}

export interface ManagerRow {
  managerEmail: string;
  orders: number;
  revenue: Delta;
  stems: number;
  avgCheck: number;
  /** Доля оплаченного от оформленного этим менеджером, %. */
  collectPercent: number | null;
  /** Во что его заявки оценивались бы по прайсу (только позиции с ценой). */
  listRevenue: number;
  /** Насколько он продаёт дешевле прайса, %. Минус — продаёт дороже. */
  discountPercent: number | null;
}

/**
 * Отклонение факта от прайса в разрезе позиции.
 *
 * Менеджеру разрешено поставить в заявке свою цену — так решил владелец: с
 * клиентом можно договориться и дороже, и дешевле. Но заданная цена остаётся
 * ориентиром, и эта строка показывает, насколько от неё ушли.
 */
export interface PriceDeviationRow {
  key: string;
  flowerType: string;
  grade: string;
  label: string;
  stems: number;
  /** Сколько стоило бы по прайсу. */
  listRevenue: number;
  /** Сколько получилось на самом деле. */
  revenue: number;
  /** Скидка к прайсу, %. Отрицательная — продали дороже прайса. */
  discountPercent: number | null;
}

/** Строка приёмки по ростовке: что реально дало производство. */
export interface ReceivedGradeRow {
  flowerType: string;
  grade: string;
  label: string;
  stems: Delta;
  share: number;
  /** Высшая ли это категория — по ней считается выход. */
  top: boolean;
  /** Ликвидное ли качество — то, что уходит без уговоров и скидок. */
  liquid: boolean;
}

/** План срезки агронома против фактической приёмки, по текущему месяцу. */
export interface HarvestPlanRow {
  flowerType: string;
  planStems: number;
  receivedStems: number;
  /** Сколько плана уже выполнено, %. null — плана нет. */
  percentOfPlan: number | null;
}

export interface WriteoffReasonRow {
  reason: string;
  stems: number;
  money: number;
  share: number;
}

export interface AttentionRow {
  level: "critical" | "warning" | "good";
  title: string;
  detail: string;
}

export interface WeekRow {
  label: string;
  revenue: number;
  stems: number;
}

export interface AnalyticsSummary {
  generatedAt: string;
  /** Две-четыре фразы человеческим языком: что вообще произошло за период. */
  headline: string[];
  days: number;
  periodLabel: string;
  prevLabel: string;

  revenue: Delta;
  stems: Delta;
  orders: Delta;
  avgPrice: Delta;
  avgCheck: Delta;
  clients: Delta;

  /** Оплачено из оформленного за период. */
  paidRevenue: number;
  collectPercent: number;
  /** Отгружено от заказанного по заявкам, срок доставки которых уже прошёл, %. */
  fillRatePercent: number | null;
  /** Доля клиентов, которые покупали и в прошлом периоде, %. */
  repeatClientPercent: number | null;
  /** Сколько дней в среднем проходит от заявки до доставки. */
  avgLeadDays: number | null;
  /** Долг по всей базе, а не только за период — как у бухгалтера. */
  debtTotal: number;

  /** Сколько заявки стоили бы по прайсу и сколько потеряли на скидках. */
  listRevenue: number;
  discountPercent: number | null;
  /** Сколько денег разошлось между прайсом и фактом. Минус — продали дороже. */
  discountMoney: number;
  /** Какая доля выручки вообще сравнима с прайсом (у позиции есть цена), %. */
  pricedRevenuePercent: number | null;
  /** Когда прайс меняли последний раз и сколько дней назад это было. */
  priceListLastChange: string | null;
  priceListAgeDays: number | null;
  /** Отклонение факта от прайса по позициям. */
  priceDeviation: PriceDeviationRow[];

  receivedStems: Delta;
  /** Сколько из принятого за период уже продано, %. */
  soldOfReceivedPercent: number | null;
  /** Во что принятое за период оценивается по действующему прайсу. */
  receivedMoney: number;
  /** Приёмка по ростовке: что реально дало производство. */
  receivedByGrade: ReceivedGradeRow[];
  /** План срезки агронома против факта приёмки, текущий месяц. */
  harvestPlan: HarvestPlanRow[];
  /** Какая доля месяца уже прошла — чтобы сравнивать план и факт честно. */
  monthProgressPercent: number;
  writeoffStems: Delta;
  writeoffPercent: number | null;
  writeoffMoney: number;
  topGradePercent: number | null;
  /** Доля ликвидного качества в приёмке за период, %. */
  liquidReceivedPercent: number | null;
  /** Доля ликвидного качества в том, что лежит на складе сейчас, %. */
  liquidStockPercent: number | null;

  stockStems: number;
  stockMoney: number;
  stockAvgAge: number;
  expiredStems: number;
  expiringStems: number;
  expiredPercent: number;
  coverDays: number | null;

  topClientsPercent: number;

  byFlower: FlowerRow[];
  byGrade: GradeRow[];
  topVarieties: VarietyRow[];
  clientRows: ClientRow[];
  managers: ManagerRow[];
  writeoffReasons: WriteoffReasonRow[];
  attention: AttentionRow[];
  weeks: WeekRow[];
}

// --- Вспомогательное --------------------------------------------------------

function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function shiftDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Дата заявки/партии/списания как Date; мусор превращается в null. */
function parseDate(raw: string): Date | null {
  const iso = toIsoDate(raw);
  if (iso) {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inRange(raw: string, from: Date, to: Date): boolean {
  const d = parseDate(raw);
  return d !== null && d >= from && d < to;
}

function share(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/** Порядок цветков одинаковый везде — тот же, что на главной. */
const FLOWER_ORDER = ["rose", "chrysanthemum", "eustoma"];
function flowerRank(flowerType: string): number {
  const i = FLOWER_ORDER.indexOf(flowerType);
  return i === -1 ? FLOWER_ORDER.length : i;
}

/**
 * Сводка по продажам за окно. Считается по дате ОФОРМЛЕНИЯ заявки — так же, как
 * продажи менеджеров и финансы бухгалтера, чтобы цифры на разных страницах
 * сходились.
 */
function salesWindow(orders: OrderWithItems[], from: Date, to: Date) {
  const picked = orders.filter((o) => o.status !== "cancelled" && inRange(o.createdAt, from, to));
  let revenue = 0;
  let stems = 0;
  let paidRevenue = 0;
  // Выполнение считаем только по заявкам, у которых дата доставки уже прошла:
  // вчерашняя заявка на послезавтра не отгружена не потому, что подвели.
  let dueOrdered = 0;
  let dueShipped = 0;
  let leadDaysSum = 0;
  let leadDaysCount = 0;
  const clients = new Set<string>();
  const byFlower = new Map<string, { stems: number; revenue: number }>();
  const byGrade = new Map<string, { flowerType: string; grade: string; stems: number; revenue: number }>();
  const byVariety = new Map<string, { flowerType: string; variety: string; stems: number; revenue: number }>();
  const byManager = new Map<
    string,
    { orders: number; stems: number; revenue: number; paid: number }
  >();

  const today = dayStart(new Date(to));
  for (const o of picked) {
    const amount = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const delivery = parseDate(o.deliveryDate);
    const created = parseDate(o.createdAt);
    if (delivery && created) {
      const lead = Math.round((delivery.getTime() - dayStart(created).getTime()) / 86400000);
      if (lead >= 0 && lead < 90) {
        leadDaysSum += lead;
        leadDaysCount += 1;
      }
    }
    if (delivery && delivery < today) {
      dueOrdered += o.items.reduce((s, i) => s + i.quantity, 0);
      dueShipped += o.items.reduce((s, i) => s + i.shippedQuantity, 0);
    }
    revenue += amount;
    if (o.paid) paidRevenue += amount;
    if (o.clientName.trim()) clients.add(o.clientName.trim().toLowerCase());

    const m = byManager.get(o.managerEmail) ?? { orders: 0, stems: 0, revenue: 0, paid: 0 };
    m.orders += 1;
    m.revenue += amount;
    if (o.paid) m.paid += amount;

    for (const item of o.items) {
      const money = item.quantity * item.unitPrice;
      stems += item.quantity;
      m.stems += item.quantity;

      const f = byFlower.get(item.flowerType) ?? { stems: 0, revenue: 0 };
      f.stems += item.quantity;
      f.revenue += money;
      byFlower.set(item.flowerType, f);

      const gKey = `${item.flowerType}:${item.grade}`;
      const g = byGrade.get(gKey) ?? {
        flowerType: item.flowerType,
        grade: item.grade,
        stems: 0,
        revenue: 0,
      };
      g.stems += item.quantity;
      g.revenue += money;
      byGrade.set(gKey, g);

      const vKey = `${item.flowerType}:${item.variety}`;
      const v = byVariety.get(vKey) ?? {
        flowerType: item.flowerType,
        variety: item.variety,
        stems: 0,
        revenue: 0,
      };
      v.stems += item.quantity;
      v.revenue += money;
      byVariety.set(vKey, v);
    }

    byManager.set(o.managerEmail, m);
  }

  return {
    orders: picked,
    orderCount: picked.length,
    revenue,
    stems,
    paidRevenue,
    clientCount: clients.size,
    clients,
    dueOrdered,
    dueShipped,
    avgLeadDays: leadDaysCount > 0 ? leadDaysSum / leadDaysCount : null,
    byFlower,
    byGrade,
    byVariety,
    byManager,
  };
}

/**
 * Сводная аналитика. `farmFilter` ограничивает всё производством: зав. складом
 * не должен видеть чужой цветок ни в остатках, ни в продажах, ни в ценах.
 * Фильтруем на входе — тогда все расчёты ниже автоматически считаются по своему.
 */
export async function getAnalyticsSummary(
  farmFilter?: string | null,
  /** Для тестов: подставить данные и «сегодня» вместо чтения из Google-таблицы. */
  injected?: {
    now?: Date;
    orders: OrderWithItems[];
    batches: Awaited<ReturnType<typeof listBatches>>;
    writeoffs: Awaited<ReturnType<typeof listWriteoffs>>;
    priceHistory: Awaited<ReturnType<typeof listPriceHistory>>;
    settings: Awaited<ReturnType<typeof getSettings>>;
    forecast?: Awaited<ReturnType<typeof listHarvestForecast>>;
  }
): Promise<AnalyticsSummary> {
  const [allOrders, allBatches, allWriteoffs, allPriceHistory, settings, allForecast] = injected
    ? [
        injected.orders,
        injected.batches,
        injected.writeoffs,
        injected.priceHistory,
        injected.settings,
        injected.forecast ?? [],
      ]
    : await Promise.all([
        listOrdersWithItems(),
        listBatches(),
        listWriteoffs(),
        listPriceHistory(),
        getSettings(),
        listHarvestForecast(),
      ]);

  const now = injected?.now ?? new Date();
  const to = shiftDays(dayStart(now), 1); // включая сегодня
  const from = shiftDays(to, -ANALYTICS_DAYS);
  const prevFrom = shiftDays(from, -ANALYTICS_DAYS);

  const mine = (flowerType: string) => !farmFilter || getFarmFor(flowerType) === farmFilter;

  const batches = allBatches.filter((b) => mine(b.flowerType));
  const priceHistory = allPriceHistory.filter((p) => mine(p.flowerType));

  // В заявке оставляем только свои позиции; заявки, где своего цветка нет, выпадают.
  const orders: OrderWithItems[] = farmFilter
    ? allOrders
        .map((o) => {
          const items = o.items.filter((i) => mine(i.flowerType));
          return {
            ...o,
            items,
            totalAmount: items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
          };
        })
        .filter((o) => o.items.length > 0)
    : allOrders;

  // Списание привязано к партии — тип цветка и градацию берём оттуда.
  const batchById = new Map(allBatches.map((b) => [b.batchId, b]));
  const writeoffs = allWriteoffs.filter((w) => {
    const b = batchById.get(w.batchId);
    return b ? mine(b.flowerType) : false;
  });

  const nowSales = salesWindow(orders, from, to);
  const prevSales = salesWindow(orders, prevFrom, from);

  // --- Цены: действующий прайс и во что заявки оценивались бы по нему -------
  const priceRows: PriceRow[] = priceHistory.map((p) => ({
    date: toIsoDate(p.date) || p.date,
    flowerType: p.flowerType,
    variety: p.variety,
    grade: p.grade,
    price: p.price,
  }));
  const pricesToday = currentPrices(priceRows, to.toISOString().slice(0, 10));
  const priceCache = new Map<string, ReturnType<typeof currentPrices>>();
  const pricesOn = (iso: string) => {
    const found = priceCache.get(iso);
    if (found) return found;
    const built = currentPrices(priceRows, iso);
    priceCache.set(iso, built);
    return built;
  };

  // Отклонение от прайса считается ОДНИМ проходом: и общее, и по менеджерам, и
  // по позициям. Владелец разрешил менеджерам менять цену в заявке («если
  // договорились на высокую/низкую»), но попросил бенчмарк — насколько факт
  // разошёлся с заданной ценой. Разрез по менеджеру отвечает на вопрос «кто
  // раздаёт скидки», разрез по позиции — «где прайс оторван от жизни».
  let listRevenue = 0;
  let soldAtListPrice = 0;
  const deviationByManager = new Map<string, { list: number; fact: number; stems: number }>();
  const deviationByPosition = new Map<
    string,
    { flowerType: string; grade: string; list: number; fact: number; stems: number }
  >();

  for (const o of nowSales.orders) {
    const iso = (toIsoDate(o.createdAt) || o.createdAt).slice(0, 10);
    const table = pricesOn(iso);
    for (const item of o.items) {
      const listPrice = priceFor(table, item.flowerType, item.variety, item.grade);
      // Позиции без цены в прайсе в расчёт скидки не берём: делить на ноль
      // и записывать «скидка 100 %» было бы враньём.
      if (listPrice <= 0) continue;
      const list = listPrice * item.quantity;
      const fact = item.unitPrice * item.quantity;
      listRevenue += list;
      soldAtListPrice += fact;

      const m = deviationByManager.get(o.managerEmail) ?? { list: 0, fact: 0, stems: 0 };
      m.list += list;
      m.fact += fact;
      m.stems += item.quantity;
      deviationByManager.set(o.managerEmail, m);

      const pKey = `${item.flowerType}:${item.grade}`;
      const p = deviationByPosition.get(pKey) ?? {
        flowerType: item.flowerType,
        grade: item.grade,
        list: 0,
        fact: 0,
        stems: 0,
      };
      p.list += list;
      p.fact += fact;
      p.stems += item.quantity;
      deviationByPosition.set(pKey, p);
    }
  }
  const discountPercent =
    listRevenue > 0 ? ((listRevenue - soldAtListPrice) / listRevenue) * 100 : null;
  // Какая часть выручки вообще сравнима с прайсом. Без этой цифры «скидка 2 %»
  // лукавит: она может быть посчитана по десятой части заявок.
  const pricedRevenuePercent =
    nowSales.revenue > 0 ? share(soldAtListPrice, nowSales.revenue) : null;

  const priceDeviation: PriceDeviationRow[] = Array.from(deviationByPosition.values())
    .map((p) => ({
      key: `${p.flowerType}:${p.grade}`,
      flowerType: p.flowerType,
      grade: p.grade,
      label: `${FLOWER_TYPE_LABELS[p.flowerType] ?? p.flowerType} ${formatGrade(p.grade)}`,
      stems: p.stems,
      listRevenue: p.list,
      revenue: p.fact,
      discountPercent: p.list > 0 ? ((p.list - p.fact) / p.list) * 100 : null,
    }))
    .sort(
      (a, b) =>
        flowerRank(a.flowerType) - flowerRank(b.flowerType) ||
        compareGrades(a.flowerType, a.grade, b.grade)
    );

  // Когда прайс последний раз трогали. Прайс, которому два месяца, — это не
  // «стабильные цены», а забытый файл; отклонение по нему ничего не значит.
  const changeDays = priceChangeDays(priceRows);
  const priceListLastChange = changeDays[0]?.date ?? null;
  // Дату «сегодня» собираем из местных частей, а не через toISOString: у
  // полуночи в плюсовом часовом поясе ISO отдаёт вчерашний день, и возраст
  // прайса каждый раз оказывался бы на сутки больше.
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const priceListAgeDays = daysSinceLastChange(changeDays, todayIso);

  // --- Приёмка -------------------------------------------------------------
  const receivedNow = batches.filter((b) => inRange(b.receivedAt || b.harvestDate, from, to));
  const receivedPrev = batches.filter((b) => inRange(b.receivedAt || b.harvestDate, prevFrom, from));
  const receivedStems = receivedNow.reduce((s, b) => s + b.quantityIn, 0);
  const receivedStemsPrev = receivedPrev.reduce((s, b) => s + b.quantityIn, 0);
  const topGradeStems = receivedNow
    .filter((b) => isTopGrade(b.flowerType, b.grade))
    .reduce((s, b) => s + b.quantityIn, 0);
  const topGradePercent = receivedStems > 0 ? share(topGradeStems, receivedStems) : null;
  const liquidReceivedStems = receivedNow
    .filter((b) => isLiquidGrade(b.flowerType, b.grade))
    .reduce((s, b) => s + b.quantityIn, 0);
  const liquidReceivedPercent =
    receivedStems > 0 ? share(liquidReceivedStems, receivedStems) : null;
  // Во что принятое оценивается по действующему прайсу — «на сколько вырастили».
  const receivedMoney = receivedNow.reduce(
    (sum, b) => sum + priceFor(pricesToday, b.flowerType, b.variety, b.grade) * b.quantityIn,
    0
  );

  // Что дало производство в разрезе ростовки: длина у розы, категория у
  // хризантемы. Это ответ на вопрос «какой цветок выходит», а не «сколько всего».
  const receivedGradeMap = new Map<string, { flowerType: string; grade: string; now: number; prev: number }>();
  const addReceived = (
    list: typeof receivedNow,
    field: "now" | "prev"
  ) => {
    for (const b of list) {
      const key = `${b.flowerType}:${b.grade}`;
      const row = receivedGradeMap.get(key) ?? {
        flowerType: b.flowerType,
        grade: b.grade,
        now: 0,
        prev: 0,
      };
      row[field] += b.quantityIn;
      receivedGradeMap.set(key, row);
    }
  };
  addReceived(receivedNow, "now");
  addReceived(receivedPrev, "prev");

  const receivedByGrade: ReceivedGradeRow[] = Array.from(receivedGradeMap.values())
    .map((r) => ({
      flowerType: r.flowerType,
      grade: r.grade,
      label: `${FLOWER_TYPE_LABELS[r.flowerType] ?? r.flowerType} ${formatGrade(r.grade)}`,
      stems: delta(r.now, r.prev),
      share: share(r.now, receivedStems),
      top: isTopGrade(r.flowerType, r.grade),
      liquid: isLiquidGrade(r.flowerType, r.grade),
    }))
    .filter((r) => r.stems.value > 0 || r.stems.prev > 0)
    .sort(
      (a, b) =>
        flowerRank(a.flowerType) - flowerRank(b.flowerType) ||
        compareGrades(a.flowerType, a.grade, b.grade)
    );

  // --- План срезки против факта, текущий месяц -----------------------------
  const monthCode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86400000);
  const monthProgressPercent = share(now.getDate(), daysInMonth);

  const planMap = new Map<string, number>();
  for (const row of allForecast) {
    if (!mine(row.flowerType)) continue;
    if (monthOfWeek(row.period) !== monthCode) continue;
    planMap.set(row.flowerType, (planMap.get(row.flowerType) ?? 0) + row.targetStems);
  }
  const receivedThisMonth = new Map<string, number>();
  for (const b of batches) {
    if (!inRange(b.receivedAt || b.harvestDate, monthStart, monthEnd)) continue;
    receivedThisMonth.set(b.flowerType, (receivedThisMonth.get(b.flowerType) ?? 0) + b.quantityIn);
  }
  const harvestPlan: HarvestPlanRow[] = Array.from(
    new Set([...planMap.keys(), ...receivedThisMonth.keys()])
  )
    .map((flowerType) => {
      const planStems = planMap.get(flowerType) ?? 0;
      const receivedStemsMonth = receivedThisMonth.get(flowerType) ?? 0;
      return {
        flowerType,
        planStems,
        receivedStems: receivedStemsMonth,
        percentOfPlan: planStems > 0 ? share(receivedStemsMonth, planStems) : null,
      };
    })
    .sort((a, b) => flowerRank(a.flowerType) - flowerRank(b.flowerType));

  // --- Склад сейчас --------------------------------------------------------
  const activeBatches = batches.filter((b) => b.quantityRemaining > 0);
  const storageInfos = activeBatches.map((b) => computeBatchStorageInfo(b, settings, now));
  const stockStems = activeBatches.reduce((s, b) => s + b.quantityRemaining, 0);
  const stockAvgAge =
    stockStems > 0
      ? storageInfos.reduce((s, i) => s + i.daysInStorage * i.batch.quantityRemaining, 0) /
        stockStems
      : 0;
  const expiredStems = storageInfos
    .filter((i) => i.status === "critical")
    .reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const expiringStems = storageInfos
    .filter((i) => i.status === "warning")
    .reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const batchMoney = (b: (typeof activeBatches)[number]) =>
    priceFor(pricesToday, b.flowerType, b.variety, b.grade) * b.quantityRemaining;
  const stockMoney = activeBatches.reduce((s, b) => s + batchMoney(b), 0);
  const liquidStockStems = activeBatches
    .filter((b) => isLiquidGrade(b.flowerType, b.grade))
    .reduce((s, b) => s + b.quantityRemaining, 0);
  const liquidStockPercent = stockStems > 0 ? share(liquidStockStems, stockStems) : null;

  // --- Списания ------------------------------------------------------------
  const writeoffNow = writeoffs.filter((w) => inRange(w.createdAt, from, to));
  const writeoffPrev = writeoffs.filter((w) => inRange(w.createdAt, prevFrom, from));
  const writeoffStems = writeoffNow.reduce((s, w) => s + w.quantity, 0);
  const writeoffStemsPrev = writeoffPrev.reduce((s, w) => s + w.quantity, 0);
  const writeoffMoney = writeoffNow.reduce((sum, w) => {
    const b = batchById.get(w.batchId);
    if (!b) return sum;
    return sum + priceFor(pricesToday, b.flowerType, b.variety, b.grade) * w.quantity;
  }, 0);
  const writeoffPercent = receivedStems > 0 ? share(writeoffStems, receivedStems) : null;

  const reasonMap = new Map<string, { stems: number; money: number }>();
  for (const w of writeoffNow) {
    const key = w.reason?.trim() || "Не указана";
    const b = batchById.get(w.batchId);
    const money = b ? priceFor(pricesToday, b.flowerType, b.variety, b.grade) * w.quantity : 0;
    const row = reasonMap.get(key) ?? { stems: 0, money: 0 };
    row.stems += w.quantity;
    row.money += money;
    reasonMap.set(key, row);
  }
  const writeoffReasons: WriteoffReasonRow[] = Array.from(reasonMap.entries())
    .map(([reason, r]) => ({
      reason,
      stems: r.stems,
      money: r.money,
      share: share(r.stems, writeoffStems),
    }))
    .sort((a, b) => b.stems - a.stems);

  // --- По цветку -----------------------------------------------------------
  const flowerTypes = Array.from(
    new Set([
      ...batches.map((b) => b.flowerType),
      ...Array.from(nowSales.byFlower.keys()),
      ...Array.from(prevSales.byFlower.keys()),
    ])
  ).filter(mine);

  const byFlower: FlowerRow[] = flowerTypes
    .map((flowerType) => {
      const nowRow = nowSales.byFlower.get(flowerType) ?? { stems: 0, revenue: 0 };
      const prevRow = prevSales.byFlower.get(flowerType) ?? { stems: 0, revenue: 0 };
      const stock = activeBatches
        .filter((b) => b.flowerType === flowerType)
        .reduce((s, b) => s + b.quantityRemaining, 0);
      const perDay = nowRow.stems / ANALYTICS_DAYS;
      const receivedType = receivedNow.filter((b) => b.flowerType === flowerType);
      const receivedTypeStems = receivedType.reduce((s, b) => s + b.quantityIn, 0);
      const topType = receivedType
        .filter((b) => isTopGrade(b.flowerType, b.grade))
        .reduce((s, b) => s + b.quantityIn, 0);
      return {
        flowerType,
        received: receivedTypeStems,
        sold: nowRow.stems,
        writeoff: writeoffNow
          .filter((w) => batchById.get(w.batchId)?.flowerType === flowerType)
          .reduce((s, w) => s + w.quantity, 0),
        stock,
        coverDays: perDay > 0 ? stock / perDay : null,
        shelfLifeDays: getMaxShelfLifeDays(flowerType, settings),
        revenue: nowRow.revenue,
        revenueShare: share(nowRow.revenue, nowSales.revenue),
        avgPrice: delta(
          nowRow.stems > 0 ? nowRow.revenue / nowRow.stems : 0,
          prevRow.stems > 0 ? prevRow.revenue / prevRow.stems : 0
        ),
        topGradePercent: receivedTypeStems > 0 ? share(topType, receivedTypeStems) : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.stock - a.stock);

  // --- По ростовке ---------------------------------------------------------
  const byGrade: GradeRow[] = Array.from(nowSales.byGrade.values())
    .map((g) => {
      const prev = prevSales.byGrade.get(`${g.flowerType}:${g.grade}`);
      return {
        flowerType: g.flowerType,
        grade: g.grade,
        label: `${FLOWER_TYPE_LABELS[g.flowerType] ?? g.flowerType} ${formatGrade(g.grade)}`,
        stems: g.stems,
        revenue: g.revenue,
        avgPrice: delta(
          g.stems > 0 ? g.revenue / g.stems : 0,
          prev && prev.stems > 0 ? prev.revenue / prev.stems : 0
        ),
        share: share(g.stems, nowSales.stems),
      };
    })
    // Порядок ростовок такой же, как на складе: 40, 50, 60… мини-микс, второй
    // сорт. Так строки таблицы продаж и таблицы склада читаются рядом.
    .sort(
      (a, b) =>
        flowerRank(a.flowerType) - flowerRank(b.flowerType) ||
        compareGrades(a.flowerType, a.grade, b.grade)
    );

  // --- Топ сортов ----------------------------------------------------------
  const topVarieties: VarietyRow[] = Array.from(nowSales.byVariety.entries())
    .map(([key, v]) => ({
      key,
      flowerType: v.flowerType,
      variety: v.variety,
      stems: v.stems,
      revenue: delta(v.revenue, prevSales.byVariety.get(key)?.revenue ?? 0),
      share: share(v.revenue, nowSales.revenue),
    }))
    .sort((a, b) => b.revenue.value - a.revenue.value);

  // --- Клиенты -------------------------------------------------------------
  const clientMap = new Map<
    string,
    { clientName: string; orders: number; revenue: number; last: Date | null }
  >();
  for (const o of nowSales.orders) {
    const name = o.clientName.trim() || "Без названия";
    const key = name.toLowerCase();
    const row = clientMap.get(key) ?? { clientName: name, orders: 0, revenue: 0, last: null };
    row.orders += 1;
    row.revenue += o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const created = parseDate(o.createdAt);
    if (created && (!row.last || created > row.last)) row.last = created;
    clientMap.set(key, row);
  }
  // Долг считаем по всей базе, а не за окно: висяк не перестаёт быть висяком.
  const debtByClient = new Map<string, number>();
  let debtTotal = 0;
  for (const o of orders) {
    if (o.status === "cancelled" || o.paid) continue;
    const amount = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    debtTotal += amount;
    const key = (o.clientName.trim() || "Без названия").toLowerCase();
    debtByClient.set(key, (debtByClient.get(key) ?? 0) + amount);
  }

  const clientRows: ClientRow[] = Array.from(clientMap.entries())
    .map(([key, c]) => ({
      clientName: c.clientName,
      orders: c.orders,
      revenue: c.revenue,
      share: share(c.revenue, nowSales.revenue),
      lastOrderDaysAgo: c.last
        ? Math.max(0, Math.round((dayStart(now).getTime() - c.last.getTime()) / 86400000))
        : 0,
      debt: debtByClient.get(key) ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const topClientsPercent = clientRows.slice(0, 3).reduce((s, c) => s + c.share, 0);

  // --- Менеджеры -----------------------------------------------------------
  const managers: ManagerRow[] = Array.from(nowSales.byManager.entries())
    .map(([managerEmail, m]) => {
      const dev = deviationByManager.get(managerEmail);
      return {
        managerEmail,
        orders: m.orders,
        revenue: delta(m.revenue, prevSales.byManager.get(managerEmail)?.revenue ?? 0),
        stems: m.stems,
        avgCheck: m.orders > 0 ? m.revenue / m.orders : 0,
        collectPercent: m.revenue > 0 ? share(m.paid, m.revenue) : null,
        listRevenue: dev?.list ?? 0,
        discountPercent:
          dev && dev.list > 0 ? ((dev.list - dev.fact) / dev.list) * 100 : null,
      };
    })
    .sort((a, b) => b.revenue.value - a.revenue.value);

  // --- Недели (единственный график на странице) ----------------------------
  const weeks: WeekRow[] = [];
  for (let i = 7; i >= 0; i--) {
    const wTo = shiftDays(to, -7 * i);
    const wFrom = shiftDays(wTo, -7);
    const w = salesWindow(orders, wFrom, wTo);
    weeks.push({
      label: `${fmtDate(wFrom)} – ${fmtDate(shiftDays(wTo, -1))}`,
      revenue: w.revenue,
      stems: w.stems,
    });
  }

  const collectPercent = nowSales.revenue > 0 ? share(nowSales.paidRevenue, nowSales.revenue) : 0;
  const expiredPercent = share(expiredStems, stockStems);
  const soldPerDay = nowSales.stems / ANALYTICS_DAYS;
  const coverDays = soldPerDay > 0 ? stockStems / soldPerDay : null;

  // --- Коротко: что вообще произошло ---------------------------------------
  // Три-четыре фразы обычным языком. Владелец справедливо заметил, что
  // «просто цифры» ничего не объясняют: плитка «19 %» понятна только тому, кто
  // помнит, от чего этот процент. Поэтому сверху страницы стоит короткий
  // пересказ, а таблицы ниже — уже подробности для того, кто захочет копнуть.
  const headline: string[] = [];
  const say = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const moneyShort = (n: number) =>
    Math.abs(n) >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} млн ₸`
      : `${say(n)} ₸`;

  if (nowSales.stems > 0) {
    const changeWord =
      nowSales.revenue > prevSales.revenue ? "больше" : nowSales.revenue < prevSales.revenue ? "меньше" : "столько же";
    headline.push(
      `За 30 дней продали ${say(nowSales.stems)} стеблей на ${moneyShort(nowSales.revenue)} — ` +
        `в среднем ${say(nowSales.revenue / nowSales.stems)} ₸ за стебель` +
        (prevSales.revenue > 0
          ? `. Это на ${Math.abs(
              Math.round(((nowSales.revenue - prevSales.revenue) / prevSales.revenue) * 100)
            )} % ${changeWord}, чем в предыдущие 30 дней.`
          : ".")
    );
  } else {
    headline.push("За 30 дней заявок не было — продажам взяться неоткуда.");
  }

  if (receivedStems > 0) {
    headline.push(
      `Срезали и приняли ${say(receivedStems)} стеблей. Продано ${Math.round(
        share(nowSales.stems, receivedStems)
      )} % от этого` +
        (liquidReceivedPercent !== null
          ? `, ликвидного качества в срезке ${Math.round(liquidReceivedPercent)} %.`
          : ".")
    );
  }

  headline.push(
    `Сейчас на складе ${say(stockStems)} стеблей на ${moneyShort(stockMoney)} по прайсу, ` +
      `средний возраст ${stockAvgAge.toFixed(1).replace(".", ",")} дн.` +
      (coverDays !== null
        ? ` При нынешнем темпе продаж этого хватит на ${Math.round(coverDays)} дн.`
        : "")
  );

  if (nowSales.revenue > 0) {
    headline.push(
      `Оплачено ${Math.round(collectPercent)} % из оформленного за период; ` +
        `всего долгов по базе ${moneyShort(debtTotal)}.`
    );
  }

  // --- На что смотреть -----------------------------------------------------
  // Список собирается из тех же цифр и ориентиров, что и таблицы: это не второй
  // расчёт, а способ не заставлять человека искать проблему глазами.
  const attention: AttentionRow[] = [];
  const fmtN = (n: number) => Math.round(n).toLocaleString("ru-RU");

  if (expiredStems > 0) {
    attention.push({
      level: "critical",
      title: `Просрочено ${fmtN(expiredStems)} шт`,
      detail: `${expiredPercent.toFixed(1)} % склада, примерно ${fmtN(
        activeBatches
          .filter((b, idx) => storageInfos[idx].status === "critical")
          .reduce((s, b) => s + batchMoney(b), 0)
      )} ₸ по прайсу. Уценить или списать — само оно не уйдёт.`,
    });
  }
  // Про запас пишем ОДНОЙ строкой на все цветки: три одинаковых карточки подряд
  // читаются как шум, а не как предупреждение.
  const slow = byFlower.filter(
    (row) => row.coverDays !== null && row.coverDays > row.shelfLifeDays && row.stock > 0
  );
  if (slow.length > 0) {
    attention.push({
      level: "warning",
      title:
        slow.length === 1
          ? `${FLOWER_TYPE_LABELS[slow[0].flowerType] ?? slow[0].flowerType}: запаса больше, чем срок хранения`
          : "Запаса больше, чем срок хранения",
      detail: `${slow
        .map(
          (row) =>
            `${FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType} — ${fmtN(
              row.coverDays!
            )} дн. при сроке ${row.shelfLifeDays} (лежит ${fmtN(row.stock)}, уходит ${fmtN(
              row.sold / ANALYTICS_DAYS
            )} шт в день)`
        )
        .join("; ")}. При таком темпе часть не успеет уйти — либо продавать быстрее, либо срезать меньше.`,
    });
  }
  if (writeoffPercent !== null && writeoffPercent > BENCHMARKS.writeoffPercent.warn) {
    attention.push({
      level: "critical",
      title: `Списание ${writeoffPercent.toFixed(1)} % от принятого`,
      detail: `Ориентир — не больше ${BENCHMARKS.writeoffPercent.warn} %. За период это ${fmtN(
        writeoffStems
      )} шт и примерно ${fmtN(writeoffMoney)} ₸.`,
    });
  }
  if (nowSales.revenue > 0 && collectPercent < BENCHMARKS.collectPercent.good) {
    attention.push({
      level: collectPercent < BENCHMARKS.collectPercent.warn ? "critical" : "warning",
      title: `Собираемость ${collectPercent.toFixed(0)} %`,
      detail: `Не оплачено из оформленного за период ${fmtN(
        nowSales.revenue - nowSales.paidRevenue
      )} ₸. Всего долгов по базе — ${fmtN(debtTotal)} ₸.`,
    });
  }
  if (discountPercent !== null && discountPercent > BENCHMARKS.discountPercent.warn) {
    // Называем поимённо: «скидки дают слишком легко» без имени — это претензия
    // ко всем сразу, то есть ни к кому.
    const worst = [...managers]
      .filter((m) => m.discountPercent !== null && m.discountPercent > discountPercent)
      .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0))
      .slice(0, 2);
    attention.push({
      level: "warning",
      title: `Продаём на ${discountPercent.toFixed(1)} % дешевле прайса`,
      detail:
        `По прайсу заявки стоили бы ${fmtN(listRevenue)} ₸, продали на ${fmtN(
          soldAtListPrice
        )} ₸ — разница ${fmtN(listRevenue - soldAtListPrice)} ₸. Ориентир — не больше ${
          BENCHMARKS.discountPercent.warn
        } %.` +
        (worst.length > 0
          ? ` Сильнее всех отклоняются: ${worst
              .map((m) => `${m.managerEmail} (${m.discountPercent!.toFixed(1)} %)`)
              .join(", ")}.`
          : " Либо прайс оторван от жизни, либо скидки дают слишком легко."),
    });
  }
  if (
    priceListAgeDays !== null &&
    priceListAgeDays > BENCHMARKS.priceListAgeDays.warn &&
    nowSales.revenue > 0
  ) {
    attention.push({
      level: "warning",
      title: `Прайс не меняли ${priceListAgeDays} дн.`,
      detail: `Последняя правка — ${priceListLastChange}. Пока прайс не обновлён, отклонение от него ничего не значит: сравнивать факт не с чем.`,
    });
  }
  if (
    pricedRevenuePercent !== null &&
    pricedRevenuePercent < BENCHMARKS.pricedRevenuePercent.warn &&
    nowSales.revenue > 0
  ) {
    attention.push({
      level: "warning",
      title: `С прайсом сравнимо только ${pricedRevenuePercent.toFixed(0)} % выручки`,
      detail:
        "У остальных позиций цены в прайсе нет, и отклонение по ним не считается вовсе. " +
        "Заполните недостающие строки — иначе бенчмарк смотрит на часть продаж.",
    });
  }
  if (topClientsPercent > BENCHMARKS.topClientsPercent.warn && clientRows.length > 0) {
    attention.push({
      level: "warning",
      title: `На трёх клиентов приходится ${topClientsPercent.toFixed(0)} % выручки`,
      detail: `Крупнейший — ${clientRows[0].clientName} (${clientRows[0].share.toFixed(
        0
      )} %). Уход одного такого клиента сразу вырубает месяц.`,
    });
  }
  const priceDrops = byFlower.filter(
    (f) => f.avgPrice.changePercent !== null && f.avgPrice.changePercent < -5
  );
  if (priceDrops.length > 0) {
    attention.push({
      level: "warning",
      title:
        priceDrops.length === 1
          ? `${
              FLOWER_TYPE_LABELS[priceDrops[0].flowerType] ?? priceDrops[0].flowerType
            }: средняя цена упала на ${Math.abs(priceDrops[0].avgPrice.changePercent!).toFixed(1)} %`
          : "Средняя цена продажи упала",
      detail: `${priceDrops
        .map(
          (f) =>
            `${FLOWER_TYPE_LABELS[f.flowerType] ?? f.flowerType}: ${fmtN(f.avgPrice.prev)} → ${fmtN(
              f.avgPrice.value
            )} ₸ за стебель`
        )
        .join("; ")}. Проверьте прайс и скидки.`,
    });
  }
  if (attention.length === 0 && stockStems > 0) {
    attention.push({
      level: "good",
      title: "Тревожных мест не видно",
      detail:
        "Просрочки нет, списание и собираемость в пределах ориентиров, запас укладывается в срок хранения.",
    });
  }

  // Больше шести строк никто не читает: оставляем самое тревожное.
  const ATTENTION_LIMIT = 6;
  const attentionOrder = { critical: 0, warning: 1, good: 2 } as const;
  attention.sort((a, b) => attentionOrder[a.level] - attentionOrder[b.level]);

  return {
    generatedAt: now.toISOString(),
    headline,
    days: ANALYTICS_DAYS,
    periodLabel: `${fmtDate(from)} – ${fmtDate(shiftDays(to, -1))}`,
    prevLabel: `${fmtDate(prevFrom)} – ${fmtDate(shiftDays(from, -1))}`,

    revenue: delta(nowSales.revenue, prevSales.revenue),
    stems: delta(nowSales.stems, prevSales.stems),
    orders: delta(nowSales.orderCount, prevSales.orderCount),
    avgPrice: delta(
      nowSales.stems > 0 ? nowSales.revenue / nowSales.stems : 0,
      prevSales.stems > 0 ? prevSales.revenue / prevSales.stems : 0
    ),
    avgCheck: delta(
      nowSales.orderCount > 0 ? nowSales.revenue / nowSales.orderCount : 0,
      prevSales.orderCount > 0 ? prevSales.revenue / prevSales.orderCount : 0
    ),
    clients: delta(nowSales.clientCount, prevSales.clientCount),

    paidRevenue: nowSales.paidRevenue,
    collectPercent,
    fillRatePercent:
      nowSales.dueOrdered > 0 ? share(nowSales.dueShipped, nowSales.dueOrdered) : null,
    repeatClientPercent:
      nowSales.clients.size > 0
        ? share(
            Array.from(nowSales.clients).filter((c) => prevSales.clients.has(c)).length,
            nowSales.clients.size
          )
        : null,
    avgLeadDays: nowSales.avgLeadDays,
    debtTotal,

    listRevenue,
    discountPercent,
    discountMoney: listRevenue - soldAtListPrice,
    pricedRevenuePercent,
    priceListLastChange,
    priceListAgeDays,
    priceDeviation,

    receivedStems: delta(receivedStems, receivedStemsPrev),
    liquidReceivedPercent,
    liquidStockPercent,
    soldOfReceivedPercent: receivedStems > 0 ? share(nowSales.stems, receivedStems) : null,
    receivedMoney,
    receivedByGrade,
    harvestPlan,
    monthProgressPercent,
    writeoffStems: delta(writeoffStems, writeoffStemsPrev),
    writeoffPercent,
    writeoffMoney,
    topGradePercent,

    stockStems,
    stockMoney,
    stockAvgAge,
    expiredStems,
    expiringStems,
    expiredPercent,
    coverDays,

    topClientsPercent,

    byFlower,
    byGrade,
    topVarieties,
    clientRows,
    managers,
    writeoffReasons,
    attention: attention.slice(0, ATTENTION_LIMIT),
    weeks,
  };
}

/**
 * Аналитика сразу по обоим производствам и по хозяйству целиком.
 *
 * Данные из Google-таблицы читаются ОДИН раз и прогоняются через тот же расчёт
 * с разными фильтрами: иначе три вызова подряд означали бы восемнадцать запросов
 * к Google вместо шести. Возвращает три готовых сводки — их и показывает отчёт
 * тремя колонками.
 */
export async function getAnalyticsByFarm(
  /** Зав. складом видит только своё производство: тогда считаем одну колонку. */
  onlyFarm?: string | null
): Promise<{ all: AnalyticsSummary; byFarm: { farm: string; summary: AnalyticsSummary }[] }> {
  const [orders, batches, writeoffs, priceHistory, settings, forecast] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    listWriteoffs(),
    listPriceHistory(),
    getSettings(),
    listHarvestForecast(),
  ]);
  const injected = { orders, batches, writeoffs, priceHistory, settings, forecast };

  if (onlyFarm) {
    const summary = await getAnalyticsSummary(onlyFarm, injected);
    return { all: summary, byFarm: [{ farm: onlyFarm, summary }] };
  }

  const farms = ["rose_farm", "esentai"];
  const [all, ...rest] = await Promise.all([
    getAnalyticsSummary(null, injected),
    ...farms.map((farm) => getAnalyticsSummary(farm, injected)),
  ]);
  return { all, byFarm: farms.map((farm, i) => ({ farm, summary: rest[i] })) };
}
