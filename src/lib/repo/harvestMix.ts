import { appendRows, readTable, rowToRecord, updateRows, SHEET_TABS } from "../sheets";
import { monthOfWeek } from "../constants";

/**
 * Ростовка — как весь урожай цветка распределится по длинам (у хризантемы по
 * категориям). Вкладка HarvestMix:
 *
 *   Period       FlowerType  Grade  TargetStems  UpdatedAt  UpdatedByEmail
 *   2026-09-W1   rose        60     8000         ...        agro@company.kz
 *   2026-09-W1   rose        80     4000         ...        agro@company.kz
 *
 * Ключевое: это цифры НА ВЕСЬ ЦВЕТОК, а не по сортам. Сорта живут отдельно, на
 * вкладке HarvestForecast. Агроном знает урожайность сорта и знает ростовку по
 * теплице — но не знает ростовку каждого сорта в отдельности, и требовать её
 * значило бы получать выдуманные цифры.
 *
 * Из ростовки считается выход высшей категории (TOP_GRADES_BY_FLOWER_TYPE).
 */
export interface HarvestMixRow {
  period: string;
  flowerType: string;
  grade: string;
  targetStems: number;
  updatedAt: string;
  updatedByEmail: string;
}

export interface HarvestMixInput {
  period: string;
  flowerType: string;
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

export function mixKey(period: string, flowerType: string, grade: string): string {
  return `${period}|${flowerType}|${grade}`;
}

export async function listHarvestMix(): Promise<HarvestMixRow[]> {
  try {
    const table = await readTable(SHEET_TABS.HARVEST_MIX);
    return table.rows
      .map((row) => {
        const record = rowToRecord(SHEET_TABS.HARVEST_MIX, row);
        return {
          period: (record.Period || "").trim(),
          flowerType: (record.FlowerType || "").trim(),
          grade: (record.Grade || "").trim(),
          targetStems: toNumber(record.TargetStems),
          updatedAt: (record.UpdatedAt || "").trim(),
          updatedByEmail: (record.UpdatedByEmail || "").trim().toLowerCase(),
        };
      })
      .filter((m) => m.period && m.flowerType && m.grade);
  } catch {
    // Вкладки может не быть, если таблицу ещё не пересобирали.
    return [];
  }
}

export async function getMixForMonth(
  month: string,
  flowerTypes?: string[]
): Promise<Map<string, HarvestMixRow>> {
  const rows = await listHarvestMix();
  const map = new Map<string, HarvestMixRow>();
  for (const row of rows) {
    if (monthOfWeek(row.period) !== month) continue;
    if (flowerTypes && !flowerTypes.includes(row.flowerType)) continue;
    map.set(mixKey(row.period, row.flowerType, row.grade), row);
  }
  return map;
}

/** Записывает ростовку: что было — переписывает, чего не было — дописывает. */
export async function saveHarvestMix(
  inputs: HarvestMixInput[],
  updatedByEmail: string
): Promise<{ updated: number; created: number }> {
  if (inputs.length === 0) return { updated: 0, created: 0 };

  const table = await readTable(SHEET_TABS.HARVEST_MIX);
  const rowByKey = new Map<string, number>();
  table.rows.forEach((row, idx) => {
    const record = rowToRecord(SHEET_TABS.HARVEST_MIX, row);
    const key = mixKey(
      (record.Period || "").trim(),
      (record.FlowerType || "").trim(),
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
      Grade: input.grade,
      TargetStems: input.targetStems,
      UpdatedAt: updatedAt,
      UpdatedByEmail: updatedByEmail,
    };
    const rowNumber = rowByKey.get(mixKey(input.period, input.flowerType, input.grade));
    if (rowNumber) updates.push({ rowNumber, record });
    else creates.push(record);
  }

  await updateRows(SHEET_TABS.HARVEST_MIX, updates);
  await appendRows(SHEET_TABS.HARVEST_MIX, creates);

  return { updated: updates.length, created: creates.length };
}
