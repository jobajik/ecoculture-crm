import { appendRows, readTable, rowToRecord, updateRows, SHEET_TABS } from "../sheets";

/**
 * Прогноз срезки. Ведётся агрономами на вкладке HarvestForecast:
 *
 *   Period   FlowerType  Variety   Grade    TargetStems  UpdatedAt  UpdatedByEmail
 *   2026-09  rose        Freedom   60       12000        ...        agro@company.kz
 *   2026-09  rose        Freedom   80       4000         ...        agro@company.kz
 *
 * Одна строка — один сорт одной градации в месяце. Ключ строки —
 * Period + FlowerType + Variety + Grade, поэтому агроном может править свой
 * прогноз сколько угодно раз: строка переписывается, а не дублируется.
 *
 * Градация здесь та же, что на складе: у розы и эустомы это длина, у хризантемы
 * категория. Именно поэтому план и факт потом сходятся сорт в сорт — считать
 * ничего не нужно, разрез один и тот же.
 */
export interface HarvestForecastRow {
  period: string;
  flowerType: string;
  variety: string;
  grade: string;
  targetStems: number;
  updatedAt: string;
  updatedByEmail: string;
}

export interface HarvestForecastInput {
  period: string;
  flowerType: string;
  variety: string;
  grade: string;
  targetStems: number;
}

function toNumber(raw: string): number {
  const cleaned = String(raw || "")
    .replace(/\s| /g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function forecastKey(
  period: string,
  flowerType: string,
  variety: string,
  grade: string
): string {
  return `${period}|${flowerType}|${variety}|${grade}`;
}

export async function listHarvestForecast(): Promise<HarvestForecastRow[]> {
  try {
    const table = await readTable(SHEET_TABS.HARVEST_FORECAST);
    return table.rows
      .map((row) => {
        const record = rowToRecord(SHEET_TABS.HARVEST_FORECAST, row);
        return {
          period: (record.Period || "").trim(),
          flowerType: (record.FlowerType || "").trim(),
          variety: (record.Variety || "").trim(),
          grade: (record.Grade || "").trim(),
          targetStems: toNumber(record.TargetStems),
          updatedAt: (record.UpdatedAt || "").trim(),
          updatedByEmail: (record.UpdatedByEmail || "").trim().toLowerCase(),
        };
      })
      .filter((f) => f.period && f.flowerType && f.variety && f.grade);
  } catch {
    return [];
  }
}

/**
 * Прогноз за месяц. Если передан flowerTypes — вернём только эти типы цветка:
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
    map.set(forecastKey(row.period, row.flowerType, row.variety, row.grade), row);
  }
  return map;
}

/** Записывает прогноз: что было — переписывает, чего не было — дописывает. */
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
      (record.Variety || "").trim(),
      (record.Grade || "").trim()
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
      Grade: input.grade,
      TargetStems: input.targetStems,
      UpdatedAt: updatedAt,
      UpdatedByEmail: updatedByEmail,
    };
    const rowNumber = rowByKey.get(
      forecastKey(input.period, input.flowerType, input.variety, input.grade)
    );
    if (rowNumber) updates.push({ rowNumber, record });
    else creates.push(record);
  }

  await updateRows(SHEET_TABS.HARVEST_FORECAST, updates);
  await appendRows(SHEET_TABS.HARVEST_FORECAST, creates);

  return { updated: updates.length, created: creates.length };
}
