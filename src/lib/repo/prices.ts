import { appendRows, readTable, rowToRecord, updateRows, SHEET_TABS } from "../sheets";
import { toIsoDate } from "../sheetDate";
import { currentPrices, priceKey, type PriceRow } from "../priceList";

/**
 * Прайс-лист во вкладке PriceHistory: Date | FlowerType | Variety | Grade | Price.
 *
 * История не перезаписывается: каждая правка в другой день добавляет строку, а
 * правка в тот же день перезаписывает сегодняшнюю. Так видно, когда и на сколько
 * меняли цену, и при этом за день не набегает десять строк на одну позицию.
 *
 * Дата читается через toIsoDate: таблица возвращает её то числом-серийником,
 * то «08.09.2026» — см. грабли 1.9-bis.
 */

function toRow(record: Record<string, string>): PriceRow {
  return {
    date: toIsoDate(record.Date),
    flowerType: (record.FlowerType || "").trim(),
    variety: (record.Variety || "").trim(),
    grade: (record.Grade || "").trim(),
    price: Number(String(record.Price ?? "").replace(/\s/g, "").replace(",", ".")) || 0,
  };
}

export async function listPrices(): Promise<PriceRow[]> {
  try {
    const table = await readTable(SHEET_TABS.PRICE_HISTORY);
    return table.rows
      .map((row) => toRow(rowToRecord(SHEET_TABS.PRICE_HISTORY, row)))
      .filter((r) => r.flowerType && r.grade && r.date);
  } catch {
    return [];
  }
}

/** Действующий прайс на дату (по умолчанию — на сегодня). */
export async function getCurrentPrices(asOf?: string): Promise<Map<string, PriceRow>> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  return currentPrices(await listPrices(), date);
}

export interface PriceInput {
  flowerType: string;
  variety: string;
  grade: string;
  price: number;
}

/**
 * Записывает цены сегодняшним днём: что уже стоит на сегодня — переписывает,
 * чего нет — добавляет. Цена 0 означает «цены нет», строка всё равно пишется:
 * иначе снятую цену нельзя было бы отличить от незаполненной.
 */
export async function savePrices(
  inputs: PriceInput[],
  date?: string
): Promise<{ updated: number; created: number }> {
  if (inputs.length === 0) return { updated: 0, created: 0 };
  const day = date ?? new Date().toISOString().slice(0, 10);

  const table = await readTable(SHEET_TABS.PRICE_HISTORY);
  const rowByKey = new Map<string, number>();
  table.rows.forEach((row, idx) => {
    const record = rowToRecord(SHEET_TABS.PRICE_HISTORY, row);
    if (toIsoDate(record.Date) !== day) return;
    const key = priceKey(
      (record.FlowerType || "").trim(),
      (record.Variety || "").trim(),
      (record.Grade || "").trim()
    );
    if (!rowByKey.has(key)) rowByKey.set(key, table.rowNumbers[idx]);
  });

  const updates: { rowNumber: number; record: Record<string, unknown> }[] = [];
  const creates: Record<string, unknown>[] = [];

  for (const input of inputs) {
    const record = {
      Date: day,
      FlowerType: input.flowerType,
      Variety: input.variety,
      Grade: input.grade,
      Price: input.price,
    };
    const rowNumber = rowByKey.get(priceKey(input.flowerType, input.variety, input.grade));
    if (rowNumber) updates.push({ rowNumber, record });
    else creates.push(record);
  }

  await updateRows(SHEET_TABS.PRICE_HISTORY, updates);
  await appendRows(SHEET_TABS.PRICE_HISTORY, creates);
  return { updated: updates.length, created: creates.length };
}
