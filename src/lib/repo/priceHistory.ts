import { appendRow, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import type { FlowerType } from "../constants";
import type { PriceHistoryEntry } from "../types";

function toEntry(record: Record<string, string>): PriceHistoryEntry {
  return {
    date: record.Date,
    flowerType: (record.FlowerType || "rose") as FlowerType,
    variety: record.Variety || "",
    grade: record.Grade || "",
    price: Number(record.Price) || 0,
  };
}

export async function listPriceHistory(): Promise<PriceHistoryEntry[]> {
  const table = await readTable(SHEET_TABS.PRICE_HISTORY);
  return table.rows
    .map((row) => toEntry(rowToRecord(SHEET_TABS.PRICE_HISTORY, row)))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function addPriceHistoryEntry(entry: PriceHistoryEntry): Promise<void> {
  await appendRow(SHEET_TABS.PRICE_HISTORY, {
    Date: entry.date,
    FlowerType: entry.flowerType,
    Variety: entry.variety,
    Grade: entry.grade,
    Price: entry.price,
  });
}
