import { appendRow, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import type { FlowerType } from "../constants";
import { toIsoDate } from "../sheetDate";
import { cleanPriceKind, PRICE_KINDS } from "../priceList";
import type { PriceHistoryEntry } from "../types";

/**
 * История КЛИЕНТСКОГО прайса — для аналитики («отклонение от прайса», «возраст
 * прайса») и календаря.
 *
 * Две ошибки здесь жили незаметно, пока аудит не снял цифры с живой базы:
 *  - дата читалась сырой, и у ячеек с числовым форматом приходило «46276»
 *    вместо «2026-09-11» (грабли 1.9-bis). Сравнение «цена, действовавшая в
 *    день заявки» сравнивало даты как строки, и «46276» оказывалось позже любой
 *    настоящей даты — отклонение от прайса и его возраст считались неверно;
 *  - в ту же вкладку пишется внутренний прайс наших магазинов (Kind = «retail»),
 *    и аналитика сравнивала цены клиентских сделок с ценой перемещения в свой
 *    магазин. Отдаём только клиентский прайс — ровно как `listPrices()`.
 */
function toEntry(record: Record<string, string>): PriceHistoryEntry {
  return {
    date: toIsoDate(record.Date),
    flowerType: (record.FlowerType || "rose") as FlowerType,
    variety: record.Variety || "",
    grade: record.Grade || "",
    price: Number(String(record.Price ?? "").replace(/\s/g, "").replace(",", ".")) || 0,
  };
}

export async function listPriceHistory(): Promise<PriceHistoryEntry[]> {
  const table = await readTable(SHEET_TABS.PRICE_HISTORY);
  return table.rows
    .map((row) => rowToRecord(SHEET_TABS.PRICE_HISTORY, row))
    .filter((record) => cleanPriceKind(record.Kind) === PRICE_KINDS.CLIENT)
    .map(toEntry)
    .filter((e) => e.date)
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
