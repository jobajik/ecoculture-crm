import { FARM_BY_FLOWER_TYPE } from "../constants";
import { listHarvestForecast } from "../repo/harvestForecast";
import type { GhData } from "../repo/greenhouse";
import { forecastAccuracy, forecastHarvest, harvestCurve, type Forecast, type ForecastAccuracy, type PlanRow } from "./forecast";
import type { CycleRow } from "./production";

/**
 * План срезки агронома для теплицы компании: строки «Прогноза срезки» (вкладка HarvestForecast) по цветкам этой
 * компании. У Есентая это хризантема. Не прочиталась вкладка — плана нет (страница так и пишет), не ошибка.
 */
export async function loadGreenhousePlan(farm: string): Promise<PlanRow[]> {
  const flowers = Object.entries(FARM_BY_FLOWER_TYPE)
    .filter(([, f]) => f === farm)
    .map(([flower]) => flower);
  const rows = await listHarvestForecast();
  return rows.filter((r) => flowers.includes(r.flowerType) && r.targetStems > 0).map((r) => ({ period: r.period, variety: r.variety, targetStems: r.targetStems }));
}

/**
 * Точность прогноза на прошлом считается ≈ 0,7 с (12 прогнозов «как будто тогда»). Её незачем пересчитывать на
 * каждое открытие страницы: живёт 6 часов на компанию и день, пока не изменилось число записей срезки. Память — в
 * globalThis: серверные действия и страницы собираются в разные бандлы со своими копиями модуля.
 */
const g = globalThis as unknown as { __ghAccuracy?: Map<string, { at: number; value: ForecastAccuracy }> };
const ACCURACY_TTL_MS = 6 * 3600 * 1000;

export function cachedAccuracy(farm: string, data: GhData, today: string): ForecastAccuracy {
  const cache = (g.__ghAccuracy ??= new Map());
  const key = `${farm}|${today}|${data.harvest.length}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ACCURACY_TTL_MS) return hit.value;
  let value: ForecastAccuracy;
  try {
    value = forecastAccuracy(data, today);
  } catch {
    value = { medianError: null, runs: 0 };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Прогноз на 3 недели — кривая и нормы из завершённых блоков, итог пополам с темпом последних трёх недель. */
export function greenhouseForecast(rows: CycleRow[], data: GhData, today: string): Forecast | null {
  try {
    const curve = harvestCurve(rows);
    if (!curve.daily.length) return null;
    return forecastHarvest(rows, today, 3, { curve, harvest: data.harvest });
  } catch {
    return null;
  }
}
