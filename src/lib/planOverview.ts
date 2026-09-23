import { FLOWER_TYPES, FLOWER_TYPE_LABELS_PLURAL, type PlanWeek } from "./constants";
import { buildDirectionFact, type DirectionFactOrder, type DirectionPlanRow } from "./direction";
import type { SalesSnapshot } from "./salesAnalytics";

/**
 * «Обзор месяца» — первая вкладка раздела «Планы».
 *
 * Владелец: «мне не нравится вкладка Планы». Разбор глазами РОПа показал, что
 * беда не в оформлении, а в устройстве: план ставился в одном месте, а как он
 * выполняется, надо было искать в другом («Продажи → План и факт», вкладка
 * «Регионы», «Баланс»). Страницы планов были сетками пустых полей без единой
 * цифры факта, и на вопрос «как идёт месяц» раздел не отвечал вовсе.
 *
 * Обзор собирает три плана месяца в одну картину — каждый рядом со своим фактом
 * и с ТЕМПОМ (какая часть месяца уже прошла):
 *  - продажи менеджеров: продано против плана, кто отстаёт от темпа;
 *  - отгрузки по направлениям: заказано и отгружено против плана недель;
 *  - срезка против плана отгрузок: в какие недели не хватит цветка, в какие
 *    останется лишний.
 * Плюс короткий список «что не заполнено» — без плана раздел честно пуст.
 *
 * Всё считается из уже прочитанного, чистой функцией (`check-plan-overview`).
 */

export const FLOWER_ORDER: string[] = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];

/** Отстаёт — если выполнение ниже темпа больше чем на столько процентных пунктов. */
export const BEHIND_MARGIN = 15;

export interface PaceInfo {
  daysPassed: number;
  daysInMonth: number;
  /** Какая доля месяца прошла, 0…100. У прошлого месяца — 100, у будущего — 0. */
  pacePercent: number;
}

export interface SalesCard {
  fact: number;
  target: number;
  percent: number | null;
  forecast: number;
  requiredPerDay: number;
  byFlower: { flowerType: string; label: string; fact: number; target: number; percent: number | null }[];
  behind: { name: string; percent: number; left: number }[];
  /** Продают, а плана нет. */
  noPlan: string[];
  unsplit: number;
}

export interface ShipmentCard {
  planStems: number;
  /** Заказано на месяц (по дате доставки). */
  orderedStems: number;
  shippedStems: number;
  /** Сколько по плану должно было уйти к сегодняшнему дню. */
  expectedToDate: number;
  /** Отгружено с начала месяца по сегодня. */
  shippedToDate: number;
  orderedPercent: number | null;
  byFlower: { flowerType: string; label: string; plan: number; ordered: number; shipped: number }[];
  /** Направления с планом, где заказано меньше темпа. */
  behind: { direction: string; ordered: number; plan: number }[];
  /** Везут без плана. */
  unplanned: { direction: string; ordered: number }[];
}

export interface HarvestWeek {
  code: string;
  index: number;
  label: string;
  forecast: number;
  planned: number;
  diff: number;
}

export interface HarvestCard {
  byFlower: {
    flowerType: string;
    label: string;
    forecast: number;
    planned: number;
    diff: number;
    weeks: HarvestWeek[];
  }[];
  /** Недели, где план отгрузок больше срезки, — по всем цветкам. */
  shortWeeks: { flowerType: string; label: string; week: string; missing: number }[];
  hasForecast: boolean;
  hasPlan: boolean;
}

export interface ChecklistItem {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
}

export interface PlanOverview {
  month: string;
  pace: PaceInfo;
  sales: SalesCard;
  shipments: ShipmentCard;
  harvest: HarvestCard;
  checklist: ChecklistItem[];
}

export function paceOf(month: string, today: string): PaceInfo {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const current = today.slice(0, 7);
  const daysPassed = current === month ? Number(today.slice(8, 10)) : current > month ? daysInMonth : 0;
  return { daysPassed, daysInMonth, pacePercent: (daysPassed / daysInMonth) * 100 };
}

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
const label = (flowerType: string) => FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType;

/** Сколько плана недель должно быть выполнено к дню `today`: прошедшие недели целиком, текущая — по дням. */
export function expectedToDate(weeks: PlanWeek[], planByWeek: Record<string, number>, today: string): number {
  let sum = 0;
  for (const w of weeks) {
    const plan = planByWeek[w.code] ?? 0;
    if (plan <= 0) continue;
    if (w.to < today) sum += plan;
    else if (w.from <= today) {
      const passed = Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${w.from}T00:00:00`).getTime()) / 86_400_000) + 1;
      sum += (plan * Math.min(passed, w.days)) / w.days;
    }
  }
  return Math.round(sum);
}

export function buildPlanOverview(input: {
  month: string;
  today: string;
  weeks: PlanWeek[];
  sales: Pick<SalesSnapshot, "totals" | "managers" | "byFlower" | "unsplitTargetAmount">;
  orders: DirectionFactOrder[];
  shipmentPlans: DirectionPlanRow[];
  /** Прогноз срезки: [цветок][код недели] — стебли. */
  forecast: Record<string, Record<string, number>>;
  /** Сколько активных менеджеров и у скольких стоит план месяца. */
  activeManagers: number;
  managersWithPlan: number;
  cancelledStatus: string;
}): PlanOverview {
  const { month, today, weeks } = input;
  const pace = paceOf(month, today);

  // --- Продажи ---------------------------------------------------------------
  const t = input.sales.totals;
  const salesPercent = pct(t.amountMonth, t.targetAmount);
  const behindSales = input.sales.managers
    .filter((m) => m.targetAmount > 0)
    .map((m) => ({ name: m.name, percent: (m.amountMonth / m.targetAmount) * 100, left: Math.max(0, m.targetAmount - m.amountMonth) }))
    .filter((m) => pace.pacePercent > 0 && m.percent < pace.pacePercent - BEHIND_MARGIN)
    .sort((a, b) => a.percent - b.percent);
  const sales: SalesCard = {
    fact: t.amountMonth,
    target: t.targetAmount,
    percent: salesPercent,
    forecast: t.forecastAmount,
    requiredPerDay: t.requiredPerDay,
    byFlower: FLOWER_ORDER.map((f) => {
      const row = input.sales.byFlower.find((r) => r.flowerType === f);
      return {
        flowerType: f,
        label: label(f),
        fact: row?.amount ?? 0,
        target: row?.targetAmount ?? 0,
        percent: row && row.targetAmount > 0 ? (row.amount / row.targetAmount) * 100 : null,
      };
    }),
    behind: behindSales,
    noPlan: input.sales.managers.filter((m) => m.targetAmount <= 0 && m.amountMonth > 0).map((m) => m.name),
    unsplit: input.sales.unsplitTargetAmount,
  };

  // --- Отгрузки --------------------------------------------------------------
  const monthFrom = weeks[0]?.from ?? `${month}-01`;
  const monthTo = weeks[weeks.length - 1]?.to ?? `${month}-31`;
  const allPeriods = weeks.map((w) => w.code);
  const monthFact = buildDirectionFact({
    orders: input.orders,
    plans: input.shipmentPlans,
    from: monthFrom,
    to: monthTo,
    planPeriods: allPeriods,
    cancelledStatus: input.cancelledStatus,
  });
  const planByWeek: Record<string, number> = {};
  for (const row of input.shipmentPlans) {
    if (!allPeriods.includes(row.period)) continue;
    planByWeek[row.period] = (planByWeek[row.period] ?? 0) + row.targetStems;
  }
  const toDate = today < monthFrom ? null : today > monthTo ? monthTo : today;
  const factToDate = toDate
    ? buildDirectionFact({
        orders: input.orders,
        plans: [],
        from: monthFrom,
        to: toDate,
        planPeriods: [],
        cancelledStatus: input.cancelledStatus,
      })
    : null;

  const rows = monthFact.groups.flatMap((g) => g.rows);
  const shipments: ShipmentCard = {
    planStems: monthFact.planStems,
    orderedStems: monthFact.orderedStems,
    shippedStems: monthFact.shippedStems,
    expectedToDate: expectedToDate(weeks, planByWeek, today),
    shippedToDate: factToDate?.shippedStems ?? 0,
    orderedPercent: pct(monthFact.orderedStems, monthFact.planStems),
    byFlower: monthFact.byFlower.map((r) => ({
      flowerType: r.flowerType,
      label: label(r.flowerType),
      plan: r.planStems,
      ordered: r.orderedStems,
      shipped: r.shippedStems,
    })),
    behind: rows
      .filter((r) => r.planStems > 0 && pace.pacePercent > 0 && (r.orderedStems / r.planStems) * 100 < pace.pacePercent - BEHIND_MARGIN)
      .map((r) => ({ direction: r.direction, ordered: r.orderedStems, plan: r.planStems }))
      .sort((a, b) => a.ordered / a.plan - b.ordered / b.plan),
    unplanned: rows
      .filter((r) => r.planStems <= 0 && r.orderedStems > 0)
      .map((r) => ({ direction: r.direction, ordered: r.orderedStems })),
  };

  // --- Срезка против плана отгрузок -----------------------------------------
  const planByFlowerWeek: Record<string, Record<string, number>> = {};
  for (const row of input.shipmentPlans) {
    if (!allPeriods.includes(row.period)) continue;
    const m = (planByFlowerWeek[row.flowerType] ??= {});
    m[row.period] = (m[row.period] ?? 0) + row.targetStems;
  }
  const harvestFlowers = FLOWER_ORDER.map((f) => {
    const wk: HarvestWeek[] = weeks.map((w) => {
      const forecast = input.forecast[f]?.[w.code] ?? 0;
      const planned = planByFlowerWeek[f]?.[w.code] ?? 0;
      return { code: w.code, index: w.index, label: w.label, forecast, planned, diff: forecast - planned };
    });
    const forecast = wk.reduce((s, w) => s + w.forecast, 0);
    const planned = wk.reduce((s, w) => s + w.planned, 0);
    return { flowerType: f, label: label(f), forecast, planned, diff: forecast - planned, weeks: wk };
  });
  const harvest: HarvestCard = {
    byFlower: harvestFlowers,
    // Нехватка имеет смысл только там, где прогноз есть: без прогноза «не
    // хватит всего плана» — это не новость о срезке, а незаполненный прогноз.
    shortWeeks: harvestFlowers
      .filter((f) => f.forecast > 0)
      .flatMap((f) =>
        f.weeks
          .filter((w) => w.planned > 0 && w.diff < 0)
          .map((w) => ({ flowerType: f.flowerType, label: f.label, week: `неделя ${w.index} (${w.label})`, missing: -w.diff }))
      ),
    hasForecast: harvestFlowers.some((f) => f.forecast > 0),
    hasPlan: harvestFlowers.some((f) => f.planned > 0),
  };

  // --- Что не заполнено ------------------------------------------------------
  const filledWeeks = weeks.filter((w) => (planByWeek[w.code] ?? 0) > 0).length;
  const flowersWithForecast = harvestFlowers.filter((f) => f.forecast > 0);
  const checklist: ChecklistItem[] = [
    {
      key: "sales",
      label: "План продаж менеджерам",
      detail:
        input.activeManagers === 0
          ? "активных менеджеров нет"
          : `${input.managersWithPlan} из ${input.activeManagers} менеджеров`,
      done: input.activeManagers > 0 && input.managersWithPlan >= input.activeManagers,
      href: `/plans/sales?period=${month}`,
    },
    {
      key: "shipments",
      label: "План отгрузок",
      detail: `${filledWeeks} из ${weeks.length} недель`,
      done: weeks.length > 0 && filledWeeks >= weeks.length,
      href: `/plans/shipments?period=${month}`,
    },
    {
      key: "forecast",
      label: "Прогноз срезки",
      detail:
        flowersWithForecast.length === FLOWER_ORDER.length
          ? "по всем цветкам"
          : flowersWithForecast.length === 0
            ? "не загружен"
            : `нет: ${harvestFlowers.filter((f) => f.forecast <= 0).map((f) => f.label.toLowerCase()).join(", ")}`,
      done: flowersWithForecast.length === FLOWER_ORDER.length,
      href: `/plans/balance?period=${month}`,
    },
  ];

  return { month, pace, sales, shipments, harvest, checklist };
}
