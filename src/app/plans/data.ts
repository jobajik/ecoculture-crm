import { getForecastForMonth } from "@/lib/repo/harvestForecast";
import { getMixForMonth } from "@/lib/repo/harvestMix";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { isValidPeriod, periodOf, weeksOfMonth } from "@/lib/constants";
import { FLOWER_ORDER } from "@/lib/planOverview";

/**
 * Общее для страниц раздела «Планы» — чтобы месяц, прогноз срезки и чтение
 * таблицы считались одинаково на всех вкладках.
 */

export function monthFrom(param: string | undefined): string {
  return param && isValidPeriod(param) ? param : periodOf(new Date());
}

/** Всё, что читают страницы планов, — одним запросом к Google (лимит общий на компанию). */
export async function prefetchPlanTabs(): Promise<void> {
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.USERS,
    SHEET_TABS.PLANS,
    SHEET_TABS.SHIPMENT_PLANS,
    SHEET_TABS.HARVEST_FORECAST,
    SHEET_TABS.HARVEST_MIX,
  ]);
}

/**
 * Прогноз срезки по неделям: [цветок][код недели] — стебли.
 *
 * Итог берётся по сортам (так считает агроном); если сорта не заполнены, а
 * ростовка есть, — по ростовке. То же правило, что в `buildFlowerBalance`:
 * показать ноль там, где цифры уже внесены, было бы хуже, чем взять их с
 * другой стороны.
 */
export async function forecastByWeek(month: string): Promise<Record<string, Record<string, number>>> {
  const [varieties, mix] = await Promise.all([getForecastForMonth(month), getMixForMonth(month)]);
  const weeks = weeksOfMonth(month).map((w) => w.code);
  const byVariety: Record<string, Record<string, number>> = {};
  const byMix: Record<string, Record<string, number>> = {};
  for (const row of varieties.values()) {
    const m = (byVariety[row.flowerType] ??= {});
    m[row.period] = (m[row.period] ?? 0) + row.targetStems;
  }
  for (const row of mix.values()) {
    const m = (byMix[row.flowerType] ??= {});
    m[row.period] = (m[row.period] ?? 0) + row.targetStems;
  }
  const out: Record<string, Record<string, number>> = {};
  for (const f of FLOWER_ORDER) {
    out[f] = {};
    for (const w of weeks) {
      const v = byVariety[f]?.[w] ?? 0;
      out[f][w] = v > 0 ? v : byMix[f]?.[w] ?? 0;
    }
  }
  return out;
}
