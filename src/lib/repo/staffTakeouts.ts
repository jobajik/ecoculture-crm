import { appendRow, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import { toIsoDate, toIsoDateTime } from "../sheetDate";
import type { FlowerType } from "../constants";
import type { StaffTakeout } from "../types";
import { deductBatchQuantity, getBatchById } from "./batches";

/**
 * Выдачи цветка сотрудникам в счёт зарплаты.
 *
 * Устроено ровно как списание: остаток партии уменьшается, а в отдельной
 * вкладке остаётся строка. Разница — в том, что у строки есть фамилия и цена:
 * по ним бухгалтер считает удержание.
 */

function toTakeout(record: Record<string, string>): StaffTakeout {
  return {
    takeoutId: record.TakeoutID,
    createdAt: toIsoDateTime(record.CreatedAt) || record.CreatedAt || "",
    // Дату приводим к «ГГГГ-ММ-ДД» ЗДЕСЬ, а не там, где ей пользуются: таблица
    // возвращает то, что отображается, и та же ячейка может прийти как
    // «11.09.2026» или как «46276» (грабли 1.9-bis).
    date: toIsoDate(record.Date) || record.Date || "",
    staffName: record.StaffName || "",
    batchId: record.BatchID || "",
    flowerType: (record.FlowerType || "rose") as FlowerType,
    variety: record.Variety || "",
    grade: record.Grade || "",
    quantity: Number(record.Quantity) || 0,
    unitPrice: Number(record.UnitPrice) || 0,
    warehouseEmail: (record.WarehouseEmail || "").toLowerCase(),
    note: record.Note || "",
  };
}

export async function listStaffTakeouts(): Promise<StaffTakeout[]> {
  // Пока вкладка не создана (`npm run setup-sheet`), чтение падает с ошибкой
  // Google. Страница от этого не должна разваливаться: пустой список честно
  // означает «выдач ещё нет».
  try {
    const table = await readTable(SHEET_TABS.STAFF_TAKEOUTS);
    return table.rows
      .map((row) => toTakeout(rowToRecord(SHEET_TABS.STAFF_TAKEOUTS, row)))
      .filter((t) => t.takeoutId);
  } catch {
    return [];
  }
}

export interface NewStaffTakeoutInput {
  date: string;
  staffName: string;
  batchId: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  warehouseEmail: string;
}

/**
 * Записывает выдачу и снимает стебли с партии.
 *
 * Порядок важен: сначала списываем остаток, потом пишем строку. Если запись
 * упадёт, на складе окажется недостача — неприятно, но видно. В обратном
 * порядке строка осталась бы без списания, и склад показывал бы цветок,
 * которого уже нет, — а это обнаруживается только на погрузке.
 */
export async function createStaffTakeout(input: NewStaffTakeoutInput): Promise<string> {
  const batch = await getBatchById(input.batchId);
  if (!batch) throw new Error("Партия не найдена");
  if (batch.quantityRemaining < input.quantity) {
    throw new Error(
      `В партии ${input.batchId} осталось ${batch.quantityRemaining} шт., ` +
        `к выдаче запрошено ${input.quantity}`
    );
  }

  await deductBatchQuantity(input.batchId, input.quantity);

  const takeoutId = generateId("TK");
  await appendRow(SHEET_TABS.STAFF_TAKEOUTS, {
    TakeoutID: takeoutId,
    CreatedAt: new Date().toISOString(),
    Date: input.date,
    StaffName: input.staffName,
    BatchID: input.batchId,
    // Снимок: партию сотрут при очистке склада, а строка обязана читаться
    // сама по себе и через полгода.
    FlowerType: batch.flowerType,
    Variety: batch.variety,
    Grade: batch.grade,
    Quantity: input.quantity,
    UnitPrice: input.unitPrice,
    WarehouseEmail: input.warehouseEmail,
    Note: input.note ?? "",
  });

  return takeoutId;
}
