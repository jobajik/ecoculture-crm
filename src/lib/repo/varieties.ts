import { readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { DEFAULT_VARIETIES } from "../constants";

/**
 * Справочник сортов по типам цветка.
 *
 * Ведётся на вкладке Varieties в Google-таблице (FlowerType | Variety | Active),
 * поэтому добавить новый сорт можно самостоятельно — строкой в таблице.
 * Если вкладка пустая или недоступна, берём список по умолчанию из constants.ts,
 * чтобы формы работали в любом случае.
 */
export async function listVarietiesByType(): Promise<Record<string, string[]>> {
  try {
    const table = await readTable(SHEET_TABS.VARIETIES);
    const result: Record<string, string[]> = {};

    for (const row of table.rows) {
      const record = rowToRecord(SHEET_TABS.VARIETIES, row);
      const flowerType = (record.FlowerType || "").trim().toLowerCase();
      const variety = (record.Variety || "").trim();
      const active = (record.Active || "").toString().trim().toUpperCase() !== "FALSE";
      if (!flowerType || !variety || !active) continue;
      if (!result[flowerType]) result[flowerType] = [];
      if (!result[flowerType].includes(variety)) result[flowerType].push(variety);
    }

    // Для типов, которых нет в таблице, подставляем значения по умолчанию.
    for (const [flowerType, defaults] of Object.entries(DEFAULT_VARIETIES)) {
      if (!result[flowerType] || result[flowerType].length === 0) {
        result[flowerType] = [...defaults];
      }
    }

    return result;
  } catch {
    return { ...DEFAULT_VARIETIES };
  }
}

/** Приводит написание сорта к тому, что есть в справочнике (без учёта регистра и лишних пробелов). */
export function normalizeVariety(
  raw: string,
  flowerType: string,
  catalog: Record<string, string[]>
): string | null {
  const cleaned = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!cleaned) return null;
  const known = catalog[flowerType] ?? [];
  for (const variety of known) {
    if (variety.toLowerCase() === cleaned) return variety;
  }
  return null;
}
