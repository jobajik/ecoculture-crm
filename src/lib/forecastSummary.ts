import {
  compareGrades,
  isLiquidGrade,
  isTopGrade,
  type PlanWeek,
} from "./constants";

/**
 * Разбор загруженного прогноза срезки в цифры, на которые можно смотреть.
 *
 * Прогноз агроном теперь не набивает руками, а загружает файлом — значит
 * страница перестала быть формой и стала отчётом: что вырастет, каких сортов,
 * какой ростовки, сколько из этого высшей категории и ликвида.
 *
 * Функции чистые и лежат в `lib`, потому что их зовёт и страница (сервер), и
 * проверочный скрипт (см. грабли 1.8 — общий код не место в компоненте).
 */

export interface ForecastVarietyInput {
  period: string;
  flowerType: string;
  variety: string;
  targetStems: number;
}

export interface ForecastMixInput {
  period: string;
  flowerType: string;
  grade: string;
  targetStems: number;
}

export interface ForecastLine {
  /** Сорт или градация. */
  label: string;
  total: number;
  /** Доля в месяце по своему цветку, %. */
  share: number;
  byWeek: Record<string, number>;
  /** Только для ростовки: входит ли в высшую категорию и в ликвид. */
  top?: boolean;
  liquid?: boolean;
}

export interface ForecastFlowerSummary {
  flowerType: string;
  /** Итог по таблице сортов — «сколько всего вырастет». */
  total: number;
  /** Итог по таблице ростовки. Должен совпадать с total: это один урожай. */
  mixTotal: number;
  /** Насколько две таблицы разошлись, в стеблях. */
  mismatch: number;
  byWeek: Record<string, number>;
  mixByWeek: Record<string, number>;
  /** Высшая категория из ростовки. */
  topStems: number;
  topPercent: number | null;
  /** Ликвидное качество из ростовки. */
  liquidStems: number;
  liquidPercent: number | null;
  varieties: ForecastLine[];
  grades: ForecastLine[];
}

export interface ForecastSummary {
  month: string;
  weeks: PlanWeek[];
  flowers: ForecastFlowerSummary[];
  /** Есть ли вообще что показывать. */
  empty: boolean;
  totalStems: number;
}

function share(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function buildForecastSummary(input: {
  month: string;
  weeks: PlanWeek[];
  flowerTypes: string[];
  varieties: ForecastVarietyInput[];
  mix: ForecastMixInput[];
}): ForecastSummary {
  const { month, weeks, flowerTypes } = input;
  const weekCodes = weeks.map((w) => w.code);

  const flowers: ForecastFlowerSummary[] = flowerTypes.map((flowerType) => {
    const varietyMap = new Map<string, ForecastLine>();
    const gradeMap = new Map<string, ForecastLine>();
    const byWeek: Record<string, number> = {};
    const mixByWeek: Record<string, number> = {};
    for (const code of weekCodes) {
      byWeek[code] = 0;
      mixByWeek[code] = 0;
    }

    for (const row of input.varieties) {
      if (row.flowerType !== flowerType) continue;
      if (!weekCodes.includes(row.period)) continue;
      if (row.targetStems <= 0) continue;
      const line = varietyMap.get(row.variety) ?? {
        label: row.variety,
        total: 0,
        share: 0,
        byWeek: {},
      };
      line.total += row.targetStems;
      line.byWeek[row.period] = (line.byWeek[row.period] ?? 0) + row.targetStems;
      varietyMap.set(row.variety, line);
      byWeek[row.period] += row.targetStems;
    }

    for (const row of input.mix) {
      if (row.flowerType !== flowerType) continue;
      if (!weekCodes.includes(row.period)) continue;
      if (row.targetStems <= 0) continue;
      const line = gradeMap.get(row.grade) ?? {
        label: row.grade,
        total: 0,
        share: 0,
        byWeek: {},
        top: isTopGrade(flowerType, row.grade),
        liquid: isLiquidGrade(flowerType, row.grade),
      };
      line.total += row.targetStems;
      line.byWeek[row.period] = (line.byWeek[row.period] ?? 0) + row.targetStems;
      gradeMap.set(row.grade, line);
      mixByWeek[row.period] += row.targetStems;
    }

    const total = Array.from(varietyMap.values()).reduce((s, l) => s + l.total, 0);
    const mixTotal = Array.from(gradeMap.values()).reduce((s, l) => s + l.total, 0);

    const varieties = Array.from(varietyMap.values())
      .map((l) => ({ ...l, share: share(l.total, total) }))
      // Сорта — по объёму: у них своего порядка нет, и «кто даёт больше» это и
      // есть вопрос, ради которого смотрят таблицу.
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "ru"));

    const grades = Array.from(gradeMap.values())
      .map((l) => ({ ...l, share: share(l.total, mixTotal) }))
      // Ростовка — в естественном порядке цветка: 40, 50, 60… Это шкала.
      .sort((a, b) => compareGrades(flowerType, a.label, b.label));

    const topStems = grades.filter((g) => g.top).reduce((s, g) => s + g.total, 0);
    const liquidStems = grades.filter((g) => g.liquid).reduce((s, g) => s + g.total, 0);

    return {
      flowerType,
      total,
      mixTotal,
      mismatch: mixTotal - total,
      byWeek,
      mixByWeek,
      topStems,
      topPercent: mixTotal > 0 ? share(topStems, mixTotal) : null,
      liquidStems,
      liquidPercent: mixTotal > 0 ? share(liquidStems, mixTotal) : null,
      varieties,
      grades,
    };
  });

  const totalStems = flowers.reduce((s, f) => s + Math.max(f.total, f.mixTotal), 0);

  return {
    month,
    weeks,
    flowers,
    empty: totalStems === 0,
    totalStems,
  };
}
