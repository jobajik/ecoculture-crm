import { appendRow, readTable, rowToRecord, updateRow, SHEET_TABS } from "../sheets";
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

/**
 * Записать значение настройки. Строка ищется по ключу, а не по номеру: строки
 * во вкладке владелец двигает руками, и запись «в третью строку» рано или
 * поздно попала бы не в ту настройку.
 */
export async function saveSettings(values: Record<string, string>): Promise<void> {
  const table = await readTable(SHEET_TABS.SETTINGS);
  const rowByKey = new Map<string, number>();
  table.rows.forEach((row, idx) => {
    const record = rowToRecord(SHEET_TABS.SETTINGS, row);
    const key = (record.Key || "").trim();
    if (key) rowByKey.set(key, table.rowNumbers[idx]);
  });

  for (const [key, value] of Object.entries(values)) {
    const rowNumber = rowByKey.get(key);
    if (rowNumber === undefined) {
      await appendRow(SHEET_TABS.SETTINGS, { Key: key, Value: value });
    } else {
      await updateRow(SHEET_TABS.SETTINGS, rowNumber, { Key: key, Value: value });
    }
  }
}
