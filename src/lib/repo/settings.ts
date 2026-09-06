import { readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { DEFAULT_SHELF_LIFE_DAYS, DEFAULT_WARNING_THRESHOLD } from "../constants";
import type { Settings } from "../types";

/**
 * Настройки хранятся в листе Settings как пары Key/Value, например:
 *   ShelfLifeDays_rose            7
 *   ShelfLifeDays_chrysanthemum   18
 *   WarningThresholdPercent       70
 * Если строки нет — используется значение по умолчанию из constants.ts.
 */
export async function getSettings(): Promise<Settings> {
  const table = await readTable(SHEET_TABS.SETTINGS);
  const map: Record<string, string> = {};
  table.rows.forEach((row) => {
    const record = rowToRecord(SHEET_TABS.SETTINGS, row);
    if (record.Key) map[record.Key.trim()] = record.Value;
  });

  const shelfLifeDays: Record<string, number> = { ...DEFAULT_SHELF_LIFE_DAYS };
  for (const key of Object.keys(map)) {
    const match = key.match(/^ShelfLifeDays_(.+)$/);
    if (match) {
      const flowerType = match[1];
      const value = Number(map[key]);
      if (!Number.isNaN(value) && value > 0) shelfLifeDays[flowerType] = value;
    }
  }

  const thresholdRaw = Number(map["WarningThresholdPercent"]);
  const warningThreshold =
    !Number.isNaN(thresholdRaw) && thresholdRaw > 0 && thresholdRaw <= 100
      ? thresholdRaw / 100
      : DEFAULT_WARNING_THRESHOLD;

  return { shelfLifeDays, warningThreshold };
}
