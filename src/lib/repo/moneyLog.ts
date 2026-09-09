import { appendRow, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import { toIsoDateTime } from "../sheetDate";
import type { MoneyLogEntry } from "../types";

/**
 * Журнал действий по деньгам во вкладке MoneyLog.
 *
 * Оплату можно поставить и снять, заявку — пересчитать, рекламацию — провести.
 * Все эти действия меняют сумму, и без записи спор «я такого не делала»
 * разбирается по памяти. Поэтому журнал только дописывается: строку отсюда
 * никто не редактирует и не удаляет — в этом весь смысл.
 *
 * Запись НИКОГДА не должна ронять само действие: если журнал не записался,
 * оплата всё равно должна быть отмечена. Поэтому `logMoney` глотает ошибку и
 * пишет её в консоль сервера.
 */

function toEntry(record: Record<string, string>): MoneyLogEntry {
  const num = (v: string | undefined) => {
    const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    logId: record.LogID || "",
    createdAt: toIsoDateTime(record.CreatedAt),
    actorEmail: (record.ActorEmail || "").toLowerCase(),
    orderId: record.OrderID || "",
    action: record.Action || "",
    details: record.Details || "",
    amountBefore: num(record.AmountBefore),
    amountAfter: num(record.AmountAfter),
  };
}

export async function listMoneyLog(): Promise<MoneyLogEntry[]> {
  try {
    const table = await readTable(SHEET_TABS.MONEY_LOG);
    return table.rows
      .map((row) => toEntry(rowToRecord(SHEET_TABS.MONEY_LOG, row)))
      .filter((e) => e.logId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

export async function logMoney(entry: {
  actorEmail: string;
  orderId: string;
  action: string;
  details: string;
  amountBefore: number;
  amountAfter: number;
}): Promise<void> {
  try {
    await appendRow(SHEET_TABS.MONEY_LOG, {
      LogID: generateId("LOG"),
      CreatedAt: new Date().toISOString(),
      ActorEmail: entry.actorEmail,
      OrderID: entry.orderId,
      Action: entry.action,
      Details: entry.details,
      AmountBefore: Math.round(entry.amountBefore * 100) / 100,
      AmountAfter: Math.round(entry.amountAfter * 100) / 100,
    });
  } catch (error) {
    // Журнал — вещь важная, но не важнее самого действия.
    console.error("Не удалось записать журнал действий по деньгам:", error);
  }
}
