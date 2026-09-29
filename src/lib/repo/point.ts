import { appendRow, deleteWhere, readTable, rowToRecord, SHEET_TABS, updateWhere } from "../sheets";
import { generateId } from "../id";
import { toIsoDate, toIsoDateTime } from "../sheetDate";
import type { PointDay, PointWriteoff } from "../point";

/**
 * Точка на базаре: выручка по дням (PointSales) и списания на точке
 * (PointWriteoffs). Чтения обёрнуты в try/catch: пока вкладок нет
 * (`npm run setup-sheet`), страница показывает пустоту, а не падает.
 */

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export async function listPointDays(options: { fresh?: boolean } = {}): Promise<PointDay[]> {
  try {
    const t = await readTable(SHEET_TABS.POINT_SALES, options);
    return t.rows
      .map((row) => rowToRecord(SHEET_TABS.POINT_SALES, row))
      .map((r) => ({
        date: toIsoDate(r.Date),
        kaspi: num(r.Kaspi),
        cash: num(r.Cash),
        note: r.Note || "",
        accountantEmail: (r.AccountantEmail || "").toLowerCase(),
        updatedAt: toIsoDateTime(r.UpdatedAt) || r.UpdatedAt || "",
      }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
  } catch {
    return [];
  }
}

/**
 * Выручка за день: строка на день. Внесли день повторно — строка
 * ПЕРЕПИСЫВАЕТСЯ (бухгалтер исправляет), а не добавляется вторая: иначе один
 * день посчитался бы дважды. Пустой день (0 и 0) — строка удаляется.
 */
export async function savePointDay(input: { date: string; kaspi: number; cash: number; note: string; email: string }): Promise<"saved" | "removed"> {
  const same = (r: Record<string, string>) => toIsoDate(r.Date) === input.date;
  if (input.kaspi === 0 && input.cash === 0) {
    await deleteWhere(SHEET_TABS.POINT_SALES, same);
    return "removed";
  }
  const record = {
    Date: input.date,
    Kaspi: input.kaspi,
    Cash: input.cash,
    Note: input.note,
    AccountantEmail: input.email,
    UpdatedAt: new Date().toISOString(),
  };
  const updated = await updateWhere(SHEET_TABS.POINT_SALES, same, () => record);
  if (!updated) await appendRow(SHEET_TABS.POINT_SALES, record);
  return "saved";
}

export async function listPointWriteoffs(options: { fresh?: boolean } = {}): Promise<PointWriteoff[]> {
  try {
    const t = await readTable(SHEET_TABS.POINT_WRITEOFFS, options);
    return t.rows
      .map((row) => rowToRecord(SHEET_TABS.POINT_WRITEOFFS, row))
      .map((r) => ({
        writeoffId: r.WriteoffID || "",
        date: toIsoDate(r.Date),
        flowerType: (r.FlowerType || "").trim(),
        quantity: num(r.Quantity),
        amount: num(r.Amount),
        reason: r.Reason || "",
        createdByEmail: (r.CreatedByEmail || "").toLowerCase(),
        createdAt: toIsoDateTime(r.CreatedAt) || r.CreatedAt || "",
      }))
      .filter((w) => w.writeoffId && w.date);
  } catch {
    return [];
  }
}

export async function appendPointWriteoff(input: Omit<PointWriteoff, "writeoffId" | "createdAt">): Promise<string> {
  const id = generateId("PW");
  await appendRow(SHEET_TABS.POINT_WRITEOFFS, {
    WriteoffID: id,
    Date: input.date,
    FlowerType: input.flowerType,
    Quantity: input.quantity,
    Amount: input.amount,
    Reason: input.reason,
    CreatedByEmail: input.createdByEmail,
    CreatedAt: new Date().toISOString(),
  });
  return id;
}

export async function deletePointWriteoff(writeoffId: string): Promise<number> {
  return deleteWhere(SHEET_TABS.POINT_WRITEOFFS, (r) => r.WriteoffID === writeoffId);
}
