import { commitAtomic, forgetReads, payrollSpreadsheetId, PAYROLL_SHEET_MESSAGE, prefetchTables, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { ensurePayrollSheet } from "../payrollSheet";
import { sheetNumber } from "../sheetCell";
import { toIsoDate } from "../sheetDate";
import { generateId } from "../id";
import { nameKey } from "../payroll/rules";
import { importWorkId, isWorkArea, matchEmployeeByName, type ImportRow, type WorkBudget, type WorkEntry, type WorkNameLink, type WorkRowClean } from "../payroll/work";
import type { Employee } from "../payroll/types";

/**
 * Выработка во вкладках PayrollWork, PayrollWorkBudgets и PayrollWorkNames таблицы зарплаты. Чтение — по позиции
 * колонок (`rowToRecord`), числа — `sheetNumber`, даты — `toIsoDate` (грабли 1.1, 1.9-bis, 1.9-quater). Вкладка
 * выработки большая (история из книги — ~26 000 строк), поэтому её НЕ читают страницы, которым она не нужна:
 * `prefetchPayroll()` её не берёт, страницы выработки зовут `prefetchWork()` сами.
 */

const WORK_TABS = [SHEET_TABS.PAYROLL_WORK, SHEET_TABS.PAYROLL_WORK_BUDGETS, SHEET_TABS.PAYROLL_WORK_NAMES];

export async function prefetchWork(): Promise<void> {
  await prefetchTables([...WORK_TABS, SHEET_TABS.PAYROLL_EMPLOYEES, SHEET_TABS.PAYROLL_DEPARTMENTS]);
}

function toEntry(r: Record<string, string>): WorkEntry | null {
  const area = (r.Area || "").trim().toLowerCase();
  if (!isWorkArea(area)) return null;
  return {
    workId: (r.WorkID || "").trim(),
    farm: (r.Farm || "").trim().toLowerCase(),
    date: toIsoDate(r.Date),
    area,
    employeeId: (r.EmployeeID || "").trim(),
    name: (r.Name || "").trim(),
    block: (r.Block || "").trim(),
    part: (r.Part || "").trim(),
    workType: (r.WorkType || "").trim().toLowerCase(),
    qty: sheetNumber(r.Qty),
    hours: sheetNumber(r.Hours),
    note: r.Note || "",
    createdBy: (r.CreatedBy || "").trim().toLowerCase(),
    createdAt: r.CreatedAt || "",
    updatedBy: (r.UpdatedBy || "").trim().toLowerCase(),
    updatedAt: r.UpdatedAt || "",
  };
}

function monthOf(raw: string): string {
  const v = (raw || "").trim();
  return /^\d{4}-\d{2}$/.test(v) ? v : toIsoDate(v).slice(0, 7);
}

function toBudget(r: Record<string, string>): WorkBudget | null {
  const area = (r.Area || "").trim().toLowerCase();
  if (!isWorkArea(area)) return null;
  return {
    month: monthOf(r.Month),
    farm: (r.Farm || "").trim().toLowerCase(),
    area,
    workType: (r.WorkType || "").trim().toLowerCase(),
    amount: sheetNumber(r.Amount),
    note: r.Note || "",
    updatedBy: (r.UpdatedBy || "").trim().toLowerCase(),
    updatedAt: r.UpdatedAt || "",
  };
}

function toLink(r: Record<string, string>): WorkNameLink {
  return { farm: (r.Farm || "").trim().toLowerCase(), name: (r.Name || "").trim(), employeeId: (r.EmployeeID || "").trim() };
}

async function rows<T>(tab: string, convert: (r: Record<string, string>) => T | null, fresh = false): Promise<T[]> {
  try {
    const table = await readTable(tab, { fresh });
    const out: T[] = [];
    for (const row of table.rows) {
      const v = convert(rowToRecord(tab, row));
      if (v) out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

export interface WorkFilter {
  farm: string;
  from?: string;
  to?: string;
  area?: string;
}

/** Записи компании за период (включительно). Карточка подставляется по привязке имён, где её нет в строке. */
export async function listWork(filter: WorkFilter): Promise<WorkEntry[]> {
  const [all, links] = await Promise.all([rows(SHEET_TABS.PAYROLL_WORK, toEntry), listNameLinks(filter.farm)]);
  const byName = new Map(links.map((l) => [nameKey(l.name), l.employeeId]));
  const out: WorkEntry[] = [];
  for (const e of all) {
    if (!e.workId || e.farm !== filter.farm || !e.date) continue;
    if (filter.from && e.date < filter.from) continue;
    if (filter.to && e.date > filter.to) continue;
    if (filter.area && e.area !== filter.area) continue;
    if (!e.employeeId) {
      const linked = byName.get(nameKey(e.name));
      if (linked) e.employeeId = linked;
    }
    out.push(e);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.area.localeCompare(b.area) || a.name.localeCompare(b.name, "ru"));
}

export async function listWorkBudgets(farm: string, month?: string): Promise<WorkBudget[]> {
  return (await rows(SHEET_TABS.PAYROLL_WORK_BUDGETS, toBudget)).filter((b) => b.farm === farm && b.month && (!month || b.month === month));
}

export async function listNameLinks(farm: string): Promise<WorkNameLink[]> {
  return (await rows(SHEET_TABS.PAYROLL_WORK_NAMES, toLink)).filter((l) => l.farm === farm && l.name && l.employeeId);
}

const TAB_MISSING = "Не удалось завести вкладку выработки в таблице зарплаты. Попробуйте ещё раз через минуту; не помогло — администратор открывает /api/payroll/setup.";

/** Свежее чтение вкладки, которой может ещё не быть, — заводим сами (как у табеля, `repo/payroll.ts`). */
async function freshOrMissing(tab: string) {
  try {
    return await readTable(tab, { fresh: true });
  } catch {
    if (!payrollSpreadsheetId()) throw new Error(PAYROLL_SHEET_MESSAGE);
    try {
      await ensurePayrollSheet();
      forgetReads();
      return await readTable(tab, { fresh: true });
    } catch {
      throw new Error(TAB_MISSING);
    }
  }
}

/**
 * Записать день участка: присланные строки против того, что в таблице на этот день, участок и компанию. Изменившиеся —
 * правкой ячеек, новые — дописыванием, пропавшие из формы — удалением; всё одним `commitAtomic` после свежего чтения
 * (грабли 1.15, 1.16). Имя пишется снимком из карточки.
 */
export async function saveWorkDay(
  farm: string,
  area: string,
  date: string,
  input: WorkRowClean[],
  employees: Pick<Employee, "employeeId" | "fullName">[],
  by: string,
): Promise<{ added: number; changed: number; removed: number }> {
  const tab = SHEET_TABS.PAYROLL_WORK;
  const table = await freshOrMissing(tab);
  const now = new Date().toISOString();
  const nameOf = new Map(employees.map((e) => [e.employeeId, e.fullName]));
  const existing: { idx: number; entry: WorkEntry }[] = [];
  table.rows.forEach((row, idx) => {
    const e = toEntry(rowToRecord(tab, row));
    if (e && e.workId && e.farm === farm && e.area === area && e.date === date) existing.push({ idx, entry: e });
  });
  const ops: Parameters<typeof commitAtomic>[0] = [];
  const append: Record<string, unknown>[] = [];
  const kept = new Set<string>();
  let changed = 0;
  for (const row of input) {
    const name = row.employeeId ? nameOf.get(row.employeeId) ?? "" : row.name;
    const found = row.workId ? existing.find((x) => x.entry.workId === row.workId) : undefined;
    if (found) {
      kept.add(found.entry.workId);
      const e = found.entry;
      const changes: Record<string, unknown> = {};
      if (e.employeeId !== row.employeeId) changes.EmployeeID = row.employeeId;
      if (name && e.name !== name) changes.Name = name;
      if (e.block !== row.block) changes.Block = row.block;
      if (e.part !== row.part) changes.Part = row.part;
      if (e.workType !== row.workType) changes.WorkType = row.workType;
      if (e.qty !== row.qty) changes.Qty = row.qty || "";
      if (e.hours !== row.hours) changes.Hours = row.hours || "";
      if (e.note !== row.note) changes.Note = row.note;
      if (Object.keys(changes).length) {
        ops.push({ kind: "update", tab, rowNumber: table.rowNumbers[found.idx], changes: { ...changes, UpdatedBy: by, UpdatedAt: now } });
        changed += 1;
      }
    } else {
      append.push({
        WorkID: generateId("WK"),
        Farm: farm,
        Date: date,
        Area: area,
        EmployeeID: row.employeeId,
        Name: name,
        Block: row.block,
        Part: row.part,
        WorkType: row.workType,
        Qty: row.qty || "",
        Hours: row.hours || "",
        Note: row.note,
        CreatedBy: by,
        CreatedAt: now,
        UpdatedBy: by,
        UpdatedAt: now,
      });
    }
  }
  const gone = existing.filter((x) => !kept.has(x.entry.workId));
  if (append.length) ops.push({ kind: "append", tab, records: append });
  if (gone.length) ops.push({ kind: "delete", tab, rowNumbers: gone.map((x) => table.rowNumbers[x.idx]) });
  if (ops.length) await commitAtomic(ops);
  return { added: append.length, changed, removed: gone.length };
}

export async function deleteWorkEntry(farm: string, workId: string): Promise<boolean> {
  const tab = SHEET_TABS.PAYROLL_WORK;
  const table = await freshOrMissing(tab);
  const idx = table.rows.findIndex((row) => {
    const e = toEntry(rowToRecord(tab, row));
    return e && e.workId === workId && e.farm === farm;
  });
  if (idx < 0) return false;
  await commitAtomic([{ kind: "delete", tab, rowNumbers: [table.rowNumbers[idx]] }]);
  return true;
}

/** Номера всех строк компании — браузер отсеивает по ним уже загруженное, прежде чем слать файл кусками. */
export async function listWorkIds(farm: string): Promise<string[]> {
  const tab = SHEET_TABS.PAYROLL_WORK;
  const table = await freshOrMissing(tab);
  const out: string[] = [];
  for (const row of table.rows) {
    const r = rowToRecord(tab, row);
    if ((r.Farm || "").trim().toLowerCase() === farm && (r.WorkID || "").trim()) out.push((r.WorkID || "").trim());
  }
  return out;
}

/**
 * Дописать кусок истории из книги: номер строки — хэш её содержимого (`importWorkId`), поэтому уже загруженные строки
 * пропускаются и повторная загрузка того же файла ничего не дублирует. Карточка подбирается по имени
 * (`matchEmployeeByName`), не нашлась — строка живёт с одним именем до привязки в журнале.
 */
export async function importWorkRows(
  farm: string,
  input: ImportRow[],
  employees: Pick<Employee, "employeeId" | "fullName">[],
  by: string,
): Promise<{ added: number; skipped: number }> {
  const tab = SHEET_TABS.PAYROLL_WORK;
  const table = await freshOrMissing(tab);
  const have = new Set<string>();
  for (const row of table.rows) {
    const id = (row[0] || "").trim();
    if (id) have.add(id);
  }
  const links = await listNameLinks(farm);
  const matched = new Map<string, string>();
  const now = new Date().toISOString();
  const records: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of input) {
    const id = importWorkId(farm, r);
    if (have.has(id)) {
      skipped += 1;
      continue;
    }
    have.add(id);
    const key = nameKey(r.name);
    if (!matched.has(key)) matched.set(key, matchEmployeeByName(r.name, employees, links));
    records.push({
      WorkID: id,
      Farm: farm,
      Date: r.date,
      Area: r.area,
      EmployeeID: matched.get(key) ?? "",
      Name: r.name,
      Block: r.block,
      Part: r.part,
      WorkType: r.workType,
      Qty: r.qty || "",
      Hours: r.hours || "",
      Note: "из книги учёта",
      CreatedBy: by,
      CreatedAt: now,
      UpdatedBy: by,
      UpdatedAt: now,
    });
  }
  if (records.length) await commitAtomic([{ kind: "append", tab, records }]);
  return { added: records.length, skipped };
}

/** Бюджеты месяца участка: изменившиеся — правкой, новые — дописыванием, нулевые — удалением; одним пакетом. */
export async function saveWorkBudgets(
  farm: string,
  month: string,
  area: string,
  input: { workType: string; amount: number; note: string }[],
  by: string,
): Promise<{ changed: number }> {
  const tab = SHEET_TABS.PAYROLL_WORK_BUDGETS;
  const table = await freshOrMissing(tab);
  const now = new Date().toISOString();
  const ops: Parameters<typeof commitAtomic>[0] = [];
  const append: Record<string, unknown>[] = [];
  const deletes: number[] = [];
  let changed = 0;
  for (const b of input) {
    const idx = table.rows.findIndex((row) => {
      const x = toBudget(rowToRecord(tab, row));
      return x && x.farm === farm && x.month === month && x.area === area && x.workType === b.workType;
    });
    if (idx >= 0) {
      const was = toBudget(rowToRecord(tab, table.rows[idx]))!;
      if (b.amount === 0 && !b.note) {
        deletes.push(table.rowNumbers[idx]);
        changed += 1;
      } else if (was.amount !== b.amount || was.note !== b.note) {
        ops.push({ kind: "update", tab, rowNumber: table.rowNumbers[idx], changes: { Amount: b.amount, Note: b.note, UpdatedBy: by, UpdatedAt: now } });
        changed += 1;
      }
    } else if (b.amount > 0 || b.note) {
      append.push({ Month: month, Farm: farm, Area: area, WorkType: b.workType, Amount: b.amount, Note: b.note, UpdatedBy: by, UpdatedAt: now });
      changed += 1;
    }
  }
  if (append.length) ops.push({ kind: "append", tab, records: append });
  if (deletes.length) ops.push({ kind: "delete", tab, rowNumbers: deletes });
  if (ops.length) await commitAtomic(ops);
  return { changed };
}

/** Привязать имя из старого учёта к карточке (или снять привязку пустым EmployeeID). */
export async function saveNameLink(farm: string, name: string, employeeId: string, by: string): Promise<void> {
  const tab = SHEET_TABS.PAYROLL_WORK_NAMES;
  const table = await freshOrMissing(tab);
  const now = new Date().toISOString();
  const key = nameKey(name);
  const idx = table.rows.findIndex((row) => {
    const l = toLink(rowToRecord(tab, row));
    return l.farm === farm && nameKey(l.name) === key;
  });
  if (idx >= 0) {
    if (!employeeId) {
      await commitAtomic([{ kind: "delete", tab, rowNumbers: [table.rowNumbers[idx]] }]);
      return;
    }
    await commitAtomic([{ kind: "update", tab, rowNumber: table.rowNumbers[idx], changes: { EmployeeID: employeeId, SetBy: by, SetAt: now } }]);
    return;
  }
  if (!employeeId) return;
  await commitAtomic([{ kind: "append", tab, records: [{ Farm: farm, Name: name, EmployeeID: employeeId, SetBy: by, SetAt: now }] }]);
}
