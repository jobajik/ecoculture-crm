import { appendRows, readTable, rowToRecord, updateRows, SHEET_TABS } from "../sheets";
import { monthOfWeek } from "../constants";

/**
 * Прогноз срезки. Ведётся агрономами и состоит из ДВУХ независимых частей:
 *
 * 1. По сортам (вкладка HarvestForecast): сколько стеблей даст каждый сорт
 *    в каждую неделю.
 *
 *      Period       FlowerType  Variety   Grade  TargetStems  UpdatedAt  ...
 *      2026-09-W1   rose        Freedom          3000         ...
 *      2026-09-W2   rose        Freedom          4000         ...
 *
 * 2. Ростовка (вкладка HarvestMix, файл harvestMix.ts): как весь урожай этого
 *    цветка распределится по длинам — на весь цветок целиком, а НЕ по каждому
 *    сорту отдельно.
 *
 * Почему врозь. Агроном знает, сколько даст сорт, и отдельно знает, какая
 * ростовка получится по теплице в целом. Требовать ростовку по каждому сорту —
 * значит требовать цифры, которых у него нет: он придумает их, и прогноз станет
 * хуже, а не точнее. Поэтому сорта и ростовка живут раздельно, а сходимость их
 * сумм показывается в интерфейсе как подсказка.
 *
 * Колонка Grade здесь осталась от прежней версии и не используется — см.
 * комментарий в SHEET_HEADERS (удалять нельзя, данные читаются по позиции).
 */
export interface HarvestForecastRow {
  period: string;
  flowerType: string;
  variety: string;
  targetStems: number;
  updatedAt: string;
  updatedByEmail: string;
}

export interface HarvestForecastInput {
  period: string;
  flowerType: string;
  variety: string;
  targetStems: number;
}

function toNumber(raw: string): number {
  const cleaned = String(raw || "")
    .replace(/\s| /g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function forecastKey(period: string, flowerType: string, variety: string): string {
  return `${period}|${flowerType}|${variety}`;
}

export async function listHarvestForecast(): Promise<HarvestForecastRow[]> {
  try {
    const table = await readTable(SHEET_TABS.HARVEST_FORECAST);
    const merged = new Map<string, HarvestForecastRow>();

    for (const row of table.rows) {
      const record = rowToRecord(SHEET_TABS.HARVEST_FORECAST, row);
      const period = (record.Period || "").trim();
      const flowerType = (record.FlowerType || "").trim();
      const variety = (record.Variety || "").trim();
      if (!period || !flowerType || !variety) continue;

      // Строки старого формата (сорт × длина) складываем в один итог по сорту:
      // так прогноз, введённый до разделения, не пропадает.
      const key = forecastKey(period, flowerType, variety);
      const existing = merged.get(key);
      const stems = toNumber(record.TargetStems);
      if (existing) {
        existing.targetStems += stems;
        if ((record.UpdatedAt || "") > existing.updatedAt) {
          existing.updatedAt = (record.UpdatedAt || "").trim();
        }
      } else {
        merged.set(key, {
          period,
          flowerType,
          variety,
          targetStems: stems,
          updatedAt: (record.UpdatedAt || "").trim(),
          updatedByEmail: (record.UpdatedByEmail || "").trim().toLowerCase(),
        });
      }
    }

    return Array.from(merged.values());
  } catch {
    return [];
  }
}

/**
 * Прогноз за неделю. Если передан flowerTypes — вернём только эти типы цветка:
 * так агроном не видит и не может случайно затереть чужое производство.
 */
export async function getForecastForPeriod(
  period: string,
  flowerTypes?: string[]
): Promise<Map<string, HarvestForecastRow>> {
  const rows = await listHarvestForecast();
  const map = new Map<string, HarvestForecastRow>();
  for (const row of rows) {
    if (row.period !== period) continue;
    if (flowerTypes && !flowerTypes.includes(row.flowerType)) continue;
    map.set(forecastKey(row.period, row.flowerType, row.variety), row);
  }
  return map;
}

/** Все недели месяца разом — страница работает с месяцем целиком. */
export async function getForecastForMonth(
  month: string,
  flowerTypes?: string[]
): Promise<Map<string, HarvestForecastRow>> {
  const rows = await listHarvestForecast();
  const map = new Map<string, HarvestForecastRow>();
  for (const row of rows) {
    if (monthOfWeek(row.period) !== month) continue;
    if (flowerTypes && !flowerTypes.includes(row.flowerType)) continue;
    map.set(forecastKey(row.period, row.flowerType, row.variety), row);
  }
  return map;
}

/** Записывает прогноз по сортам: что было — переписывает, чего не было — дописывает. */
export async function saveHarvestForecast(
  inputs: HarvestForecastInput[],
  updatedByEmail: string
): Promise<{ updated: number; created: number }> {
  if (inputs.length === 0) return { updated: 0, created: 0 };

  const table = await readTable(SHEET_TABS.HARVEST_FORECAST);
  const rowByKey = new Map<string, number>();
  table.rows.forEach((row, idx) => {
    const record = rowToRecord(SHEET_TABS.HARVEST_FORECAST, row);
    const key = forecastKey(
      (record.Period || "").trim(),
      (record.FlowerType || "").trim(),
      (record.Variety || "").trim()
    );
    if (!rowByKey.has(key)) rowByKey.set(key, table.rowNumbers[idx]);
  });

  const updatedAt = new Date().toISOString();
  const updates: { rowNumber: number; record: Record<string, unknown> }[] = [];
  const creates: Record<string, unknown>[] = [];

  for (const input of inputs) {
    const record = {
      Period: input.period,
      FlowerType: input.flowerType,
      Variety: input.variety,
      Grade: "", // не используется, см. комментарий выше
      TargetStems: input.targetStems,
      UpdatedAt: updatedAt,
      UpdatedByEmail: updatedByEmail,
    };
    const rowNumber = rowByKey.get(forecastKey(input.period, input.flowerType, input.variety));
    if (rowNumber) updates.push({ rowNumber, record });
    else creates.push(record);
  }

  await updateRows(SHEET_TABS.HARVEST_FORECAST, updates);
  await appendRows(SHEET_TABS.HARVEST_FORECAST, creates);

  return { updated: updates.length, created: creates.length };
}
