import {
  DIRECTION_GROUPS,
  SHIPMENT_DIRECTIONS,
  groupOfDirection,
  isTopGrade,
} from "./constants";

// ---------------------------------------------------------------------------
// Баланс: что агрономы обещают срезать против того, что отдел продаж собирается
// отгрузить. Всё в этом файле — чистые функции без обращений к таблице, чтобы
// их можно было прогонять тестами (scripts/check-balance.ts).
//
// Сравнение идёт по типу цветка, а не по сортам и длинам: прогноз ведётся по
// ростовке, а план отгрузок — по направлениям, общего разреза мельче цветка у
// них нет. Итог всё равно отвечает на главный вопрос: хватит ли того, что
// вырастет, на то, что уже пообещали клиентам.
// ---------------------------------------------------------------------------

export interface DirectionPlan {
  direction: string;
  stems: number;
  amount: number;
}

export interface GroupSummary {
  key: string;
  label: string;
  directions: string[];
  stems: number;
  amount: number;
  /** Доля блока в плане отгрузок по этому цветку, 0…1. */
  share: number;
}

export interface FlowerBalance {
  flowerType: string;
  /** Сколько обещают срезать за месяц. */
  forecastStems: number;
  /** Из них высшей категории. */
  forecastTopStems: number;
  /** Сколько планируется отгрузить. */
  plannedStems: number;
  plannedAmount: number;
  /**
   * Прогноз минус план. Больше нуля — остаток, который некуда девать;
   * меньше нуля — нехватка, обещали больше, чем вырастет.
   */
  diff: number;
  groups: GroupSummary[];
}

/** Средняя цена стебля по направлению — нужна, чтобы вместе со стеблями двигать и сумму. */
export function pricePerStem(plan: DirectionPlan): number {
  return plan.stems > 0 ? plan.amount / plan.stems : 0;
}

export function buildFlowerBalance(
  flowerType: string,
  /** Ростовка: градация → количество. На весь цветок, вкладка HarvestMix. */
  forecastByGrade: Record<string, number>,
  /** План отгрузок: направление → стебли и сумма. */
  planByDirection: Record<string, DirectionPlan>,
  /**
   * Сумма прогноза по сортам (вкладка HarvestForecast). Это два счёта одного и
   * того же урожая: сорта отвечают «сколько даст каждый сорт», ростовка — «какая
   * получится длина». Общий итог берём по сортам, потому что агроном считает
   * именно так; ростовка нужна для выхода высшей категории.
   *
   * Если сорта не заполнены, а ростовка есть — считаем по ростовке: показать
   * ноль там, где цифры уже внесены, было бы хуже, чем взять их с другой стороны.
   */
  varietyStems?: number
): FlowerBalance {
  let mixStems = 0;
  let forecastTopStems = 0;
  for (const [grade, stems] of Object.entries(forecastByGrade)) {
    mixStems += stems;
    if (isTopGrade(flowerType, grade)) forecastTopStems += stems;
  }
  const forecastStems = varietyStems && varietyStems > 0 ? varietyStems : mixStems;

  let plannedStems = 0;
  let plannedAmount = 0;
  for (const direction of SHIPMENT_DIRECTIONS) {
    const plan = planByDirection[direction];
    if (!plan) continue;
    plannedStems += plan.stems;
    plannedAmount += plan.amount;
  }

  const groups: GroupSummary[] = DIRECTION_GROUPS.map((group) => {
    let stems = 0;
    let amount = 0;
    for (const direction of group.directions) {
      const plan = planByDirection[direction];
      if (!plan) continue;
      stems += plan.stems;
      amount += plan.amount;
    }
    return {
      key: group.key,
      label: group.label,
      directions: [...group.directions],
      stems,
      amount,
      share: plannedStems > 0 ? stems / plannedStems : 0,
    };
  });

  return {
    flowerType,
    forecastStems,
    forecastTopStems,
    plannedStems,
    plannedAmount,
    diff: forecastStems - plannedStems,
    groups,
  };
}

// ---------------------------------------------------------------------------
// Распределение остатка и ужатие плана.
//
// Обе операции целочисленные: стеблей не бывает 0,4. Поэтому доли считаются в
// дробях, а остаток от округления добирается по одному стеблю — иначе сумма
// после распределения не сойдётся с исходной, и в плане появятся или исчезнут
// сотни стеблей на ровном месте.
// ---------------------------------------------------------------------------

export type DistributeMode = "proportional" | "equal";

/**
 * Раскладывает `total` стеблей по направлениям `targets`.
 *
 * `proportional` — пропорционально тому, что уже стоит в плане. Если во всех
 * целевых направлениях стоят нули, пропорции нет — тогда делим поровну, иначе
 * остаток просто некуда положить и функция вернула бы нули.
 */
export function splitStems(
  total: number,
  targets: string[],
  weights: Record<string, number>,
  mode: DistributeMode
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const t of targets) result[t] = 0;

  if (targets.length === 0 || total <= 0) return result;

  const weightSum = targets.reduce((s, t) => s + Math.max(0, weights[t] ?? 0), 0);
  const useEqual = mode === "equal" || weightSum <= 0;

  // Сначала целые части, потом дробные хвосты — по убыванию, по одному стеблю.
  const exact = targets.map((t) => {
    const share = useEqual ? 1 / targets.length : Math.max(0, weights[t] ?? 0) / weightSum;
    return { direction: t, value: total * share };
  });

  let assigned = 0;
  for (const item of exact) {
    const whole = Math.floor(item.value);
    result[item.direction] = whole;
    assigned += whole;
  }

  const remainder = total - assigned;
  const byFraction = [...exact].sort(
    (a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value))
  );
  for (let i = 0; i < remainder; i++) {
    result[byFraction[i % byFraction.length].direction] += 1;
  }

  return result;
}

export interface RedistributeResult {
  /** Новый план по всем направлениям (в том числе нетронутым). */
  next: Record<string, DirectionPlan>;
  /** Сколько стеблей реально разошлось. */
  distributed: number;
}

/**
 * Добавляет остаток срезки к плану отгрузок.
 *
 * Сумма в тенге двигается вслед за стеблями по цене самого направления. Если у
 * направления цены нет (стоял ноль), берём среднюю по цветку — иначе в плане
 * появились бы стебли по нулевой цене, и выручка молча занизилась бы.
 */
export function distributeSurplus(
  current: Record<string, DirectionPlan>,
  surplus: number,
  targets: string[],
  mode: DistributeMode
): RedistributeResult {
  const next: Record<string, DirectionPlan> = {};
  for (const direction of SHIPMENT_DIRECTIONS) {
    const plan = current[direction] ?? { direction, stems: 0, amount: 0 };
    next[direction] = { ...plan };
  }

  if (surplus <= 0 || targets.length === 0) return { next, distributed: 0 };

  const weights: Record<string, number> = {};
  for (const t of targets) weights[t] = next[t]?.stems ?? 0;

  // Средняя цена по цветку — запасной вариант для пустых направлений.
  const totalStems = SHIPMENT_DIRECTIONS.reduce((s, d) => s + (next[d]?.stems ?? 0), 0);
  const totalAmount = SHIPMENT_DIRECTIONS.reduce((s, d) => s + (next[d]?.amount ?? 0), 0);
  const fallbackPrice = totalStems > 0 ? totalAmount / totalStems : 0;

  const added = splitStems(surplus, targets, weights, mode);

  let distributed = 0;
  for (const [direction, extra] of Object.entries(added)) {
    if (!extra) continue;
    const plan = next[direction];
    const price = plan.stems > 0 ? plan.amount / plan.stems : fallbackPrice;
    next[direction] = {
      direction,
      stems: plan.stems + extra,
      amount: Math.round(plan.amount + extra * price),
    };
    distributed += extra;
  }

  return { next, distributed };
}

/**
 * Ужимает план под прогноз, когда обещали больше, чем вырастет.
 *
 * Урезаем пропорционально: если срезки хватает на 80 % плана, каждое
 * направление получает свои 80 %. Это честнее, чем обнулять хвост списка —
 * недостача есть у всех клиентов, а не только у последнего в таблице.
 */
export function trimToForecast(
  current: Record<string, DirectionPlan>,
  forecastStems: number
): RedistributeResult {
  const next: Record<string, DirectionPlan> = {};
  for (const direction of SHIPMENT_DIRECTIONS) {
    const plan = current[direction] ?? { direction, stems: 0, amount: 0 };
    next[direction] = { ...plan };
  }

  const planned = SHIPMENT_DIRECTIONS.reduce((s, d) => s + next[d].stems, 0);
  if (planned <= forecastStems || planned === 0) return { next, distributed: 0 };

  const targets = SHIPMENT_DIRECTIONS.filter((d) => next[d].stems > 0);
  const weights: Record<string, number> = {};
  for (const t of targets) weights[t] = next[t].stems;

  const kept = splitStems(Math.max(0, Math.floor(forecastStems)), targets, weights, "proportional");

  for (const direction of targets) {
    const plan = next[direction];
    const price = pricePerStem(plan);
    const stems = kept[direction] ?? 0;
    next[direction] = {
      direction,
      stems,
      amount: Math.round(stems * price),
    };
  }

  return { next, distributed: planned - forecastStems };
}

/** Направления блока (или все, если блок не выбран). */
export function targetsFor(groupKey: string | null): string[] {
  if (!groupKey) return [...SHIPMENT_DIRECTIONS];
  const group = DIRECTION_GROUPS.find((g) => g.key === groupKey);
  return group ? [...group.directions] : [];
}

export { groupOfDirection };
