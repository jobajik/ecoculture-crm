import { toIsoDateTime } from "./sheetDate";
import { localDayKey } from "./timezone";
import type { Batch } from "./types";

/**
 * День приёмки партии по Алматы, «ГГГГ-ММ-ДД».
 *
 * Программа пишет `ReceivedAt` через `toISOString()` — это Гринвич, и приёмка в
 * 02:00 по Алматы иначе легла бы во вчера. Время без пояса (серийник, ручная
 * правка в таблице) уже местное — берём его день как есть.
 */
export function receivedDay(raw: string): string {
  const v = toIsoDateTime(raw);
  if (!v) return "";
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : localDayKey(d);
  }
  return v.slice(0, 10);
}

/** Партии основного склада, принятые в этот день (офисные — перемещения, не приёмка). */
export function receivedOn(batches: Batch[], day: string): Batch[] {
  return batches
    .filter((b) => !b.store && b.quantityIn > 0 && receivedDay(b.receivedAt) === day)
    .sort((a, b) => toIsoDateTime(b.receivedAt).localeCompare(toIsoDateTime(a.receivedAt)));
}
