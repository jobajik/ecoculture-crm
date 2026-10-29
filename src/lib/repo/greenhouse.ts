import { commitAtomic, forgetReads, payrollSpreadsheetId, PAYROLL_SHEET_MESSAGE, prefetchTables, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { ensurePayrollSheet } from "../payrollSheet";
import { sheetNumber } from "../sheetCell";
import { toIsoDate } from "../sheetDate";
import { generateId } from "../id";
import { planDayRows } from "../greenhouse/day";
import { planWorkDay } from "./payrollWork";
import type { WorkArea, WorkRowClean } from "../payroll/work";
import type { Employee } from "../payroll/types";
import { cycleOf, importLogId, type GhCutting, type GhCycle, type GhHarvest, type GhWaste, type ImportLogRow, type LogKind, type LogRowClean } from "../greenhouse/production";

/**
 * Журналы теплицы во вкладках Gh* второй таблицы (той же, что зарплата): чтение по позиции колонок, числа через
 * `sheetNumber`, даты через `toIsoDate`. Три журнала (срезка, черенкование, брак) устроены одинаково, поэтому запись
 * одна (`saveLogRows` / `deleteLogRow` / `importLogRows`), а различается только раскладка полей по колонкам (`LOGS`).
 */

const GH_TABS = [SHEET_TABS.GH_CYCLES, SHEET_TABS.GH_HARVEST, SHEET_TABS.GH_CUTTINGS, SHEET_TABS.GH_WASTE];

export async function prefetchGreenhouse(): Promise<void> {
  await prefetchTables(GH_TABS);
}

function toCycle(r: Record<string, string>): GhCycle | null {
  const cycle = cycleOf(r.Cycle);
  const block = (r.Block || "").trim();
  if (!cycle || !block) return null;
  return {
    farm: (r.Farm || "").trim().toLowerCase(),
    cycle,
    block,
    cuttingsAt: toIsoDate(r.CuttingsAt),
    plantedAt: toIsoDate(r.PlantedAt),
    plannedHarvestAt: toIsoDate(r.PlannedHarvestAt),
    note: r.Note || "",
    updatedBy: (r.UpdatedBy || "").trim().toLowerCase(),
    updatedAt: r.UpdatedAt || "",
  };
}

function toHarvest(r: Record<string, string>): GhHarvest | null {
  const id = (r.HarvestID || "").trim();
  if (!id) return null;
  return { id, farm: (r.Farm || "").trim().toLowerCase(), date: toIsoDate(r.Date), cycle: cycleOf(r.Cycle), block: (r.Block || "").trim(), variety: (r.Variety || "").trim(), grade: (r.Grade || "").trim(), qty: sheetNumber(r.Qty), weightKg: sheetNumber(r.WeightKg), note: r.Note || "" };
}
function toCutting(r: Record<string, string>): GhCutting | null {
  const id = (r.CuttingID || "").trim();
  if (!id) return null;
  return { id, farm: (r.Farm || "").trim().toLowerCase(), cycle: cycleOf(r.Cycle), date: toIsoDate(r.Date), block: (r.Block || "").trim(), part: (r.Part || "").trim(), line: (r.Line || "").trim(), variety: (r.Variety || "").trim(), kind: (r.Kind || "").trim().toLowerCase(), qty: sheetNumber(r.Qty), note: r.Note || "" };
}
function toWaste(r: Record<string, string>): GhWaste | null {
  const id = (r.WasteID || "").trim();
  if (!id) return null;
  return { id, farm: (r.Farm || "").trim().toLowerCase(), date: toIsoDate(r.Date), cycle: cycleOf(r.Cycle), block: (r.Block || "").trim(), variety: (r.Variety || "").trim(), qty: sheetNumber(r.Qty), kind: (r.Kind || "").trim().toLowerCase(), note: r.Note || "" };
}

async function rows<T>(tab: string, convert: (r: Record<string, string>) => T | null): Promise<T[]> {
  try {
    const table = await readTable(tab);
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

export interface GhData {
  cycles: GhCycle[];
  harvest: GhHarvest[];
  cuttings: GhCutting[];
  waste: GhWaste[];
}

/** Всё по компании одним пакетом: страницы циклов считают сводки по всем четырём вкладкам сразу. */
export async function loadGreenhouse(farm: string): Promise<GhData> {
  await prefetchGreenhouse();
  const [cycles, harvest, cuttings, waste] = await Promise.all([rows(SHEET_TABS.GH_CYCLES, toCycle), rows(SHEET_TABS.GH_HARVEST, toHarvest), rows(SHEET_TABS.GH_CUTTINGS, toCutting), rows(SHEET_TABS.GH_WASTE, toWaste)]);
  const mine = <T extends { farm: string }>(list: T[]) => list.filter((x) => x.farm === farm);
  return { cycles: mine(cycles).sort((a, b) => b.cycle - a.cycle), harvest: mine(harvest).filter((h) => h.date), cuttings: mine(cuttings).filter((c) => c.date), waste: mine(waste).filter((w) => w.date) };
}

const TAB_MISSING = "Не удалось завести вкладку теплицы в таблице зарплаты. Попробуйте ещё раз через минуту; не помогло — администратор открывает /api/payroll/setup.";

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

// --- Циклы ---------------------------------------------------------------------

export async function saveCycle(farm: string, c: Omit<GhCycle, "farm" | "updatedBy" | "updatedAt">, by: string): Promise<{ created: boolean }> {
  const tab = SHEET_TABS.GH_CYCLES;
  const table = await freshOrMissing(tab);
  const now = new Date().toISOString();
  const idx = table.rows.findIndex((row) => {
    const x = toCycle(rowToRecord(tab, row));
    return x && x.farm === farm && x.cycle === c.cycle && x.block === c.block;
  });
  const record = { CuttingsAt: c.cuttingsAt, PlantedAt: c.plantedAt, PlannedHarvestAt: c.plannedHarvestAt, Note: c.note, UpdatedBy: by, UpdatedAt: now };
  if (idx >= 0) {
    await commitAtomic([{ kind: "update", tab, rowNumber: table.rowNumbers[idx], changes: record }]);
    return { created: false };
  }
  await commitAtomic([{ kind: "append", tab, records: [{ Farm: farm, Cycle: c.cycle, Block: c.block, ...record }] }]);
  return { created: true };
}

export async function deleteCycle(farm: string, cycle: number, block: string): Promise<boolean> {
  const tab = SHEET_TABS.GH_CYCLES;
  const table = await freshOrMissing(tab);
  const idx = table.rows.findIndex((row) => {
    const x = toCycle(rowToRecord(tab, row));
    return x && x.farm === farm && x.cycle === cycle && x.block === block;
  });
  if (idx < 0) return false;
  await commitAtomic([{ kind: "delete", tab, rowNumbers: [table.rowNumbers[idx]] }]);
  return true;
}

/** Даты циклов из книги: новые пары — дописать, у существующих заполнить ПУСТЫЕ даты (записанное руками не трогаем). */
export async function importCycles(farm: string, input: Omit<GhCycle, "farm" | "updatedBy" | "updatedAt">[], by: string): Promise<{ added: number; updated: number }> {
  const tab = SHEET_TABS.GH_CYCLES;
  const table = await freshOrMissing(tab);
  const now = new Date().toISOString();
  const ops: Parameters<typeof commitAtomic>[0] = [];
  const append: Record<string, unknown>[] = [];
  let updated = 0;
  for (const c of input) {
    const idx = table.rows.findIndex((row) => {
      const x = toCycle(rowToRecord(tab, row));
      return x && x.farm === farm && x.cycle === c.cycle && x.block === c.block;
    });
    if (idx >= 0) {
      const was = toCycle(rowToRecord(tab, table.rows[idx]))!;
      const changes: Record<string, unknown> = {};
      if (!was.cuttingsAt && c.cuttingsAt) changes.CuttingsAt = c.cuttingsAt;
      if (!was.plantedAt && c.plantedAt) changes.PlantedAt = c.plantedAt;
      if (!was.plannedHarvestAt && c.plannedHarvestAt) changes.PlannedHarvestAt = c.plannedHarvestAt;
      if (Object.keys(changes).length) {
        ops.push({ kind: "update", tab, rowNumber: table.rowNumbers[idx], changes: { ...changes, UpdatedBy: by, UpdatedAt: now } });
        updated += 1;
      }
    } else append.push({ Farm: farm, Cycle: c.cycle, Block: c.block, CuttingsAt: c.cuttingsAt, PlantedAt: c.plantedAt, PlannedHarvestAt: c.plannedHarvestAt, Note: "из книги агронома", UpdatedBy: by, UpdatedAt: now });
  }
  if (append.length) ops.push({ kind: "append", tab, records: append });
  if (ops.length) await commitAtomic(ops);
  return { added: append.length, updated };
}

// --- Журналы ----------------------------------------------------------------------

interface LogSpec {
  tab: string;
  idCol: string;
  idPrefix: string;
  read: (r: Record<string, string>) => { id: string; farm: string } | null;
  /** Строка журнала → ячейки записи (без служебных). */
  toRecord: (farm: string, r: LogRowClean) => Record<string, unknown>;
  /** Что сравнивать при правке. */
  changes: (r: LogRowClean) => Record<string, unknown>;
}

const LOGS: Record<LogKind, LogSpec> = {
  harvest: {
    tab: SHEET_TABS.GH_HARVEST,
    idCol: "HarvestID",
    idPrefix: "GH",
    read: toHarvest,
    toRecord: (farm, r) => ({ Farm: farm, Date: r.date, Cycle: r.cycle, Block: r.block, Variety: r.variety, Grade: r.kind, Qty: r.qty, WeightKg: r.weightKg || "", Note: r.note }),
    changes: (r) => ({ Date: r.date, Cycle: r.cycle, Block: r.block, Variety: r.variety, Grade: r.kind, Qty: r.qty, WeightKg: r.weightKg || "", Note: r.note }),
  },
  cuttings: {
    tab: SHEET_TABS.GH_CUTTINGS,
    idCol: "CuttingID",
    idPrefix: "GC",
    read: toCutting,
    toRecord: (farm, r) => ({ Farm: farm, Cycle: r.cycle, Date: r.date, Block: r.block, Part: r.part, Line: r.line, Variety: r.variety, Kind: r.kind, Qty: r.qty, Note: r.note }),
    changes: (r) => ({ Cycle: r.cycle, Date: r.date, Block: r.block, Part: r.part, Line: r.line, Variety: r.variety, Kind: r.kind, Qty: r.qty, Note: r.note }),
  },
  waste: {
    tab: SHEET_TABS.GH_WASTE,
    idCol: "WasteID",
    idPrefix: "GW",
    read: toWaste,
    toRecord: (farm, r) => ({ Farm: farm, Date: r.date, Cycle: r.cycle, Block: r.block, Variety: r.variety, Qty: r.qty, Kind: r.kind, Note: r.note }),
    changes: (r) => ({ Date: r.date, Cycle: r.cycle, Block: r.block, Variety: r.variety, Qty: r.qty, Kind: r.kind, Note: r.note }),
  },
};

/**
 * Записать строки журнала: с номером — правка только изменившихся ячеек, без номера — новая строка. Одним
 * `commitAtomic` после свежего чтения. Удаление отдельное (`deleteLogRow`), чтобы форма «добавить несколько строк»
 * не могла стереть журнал.
 */
export async function saveLogRows(log: LogKind, farm: string, input: LogRowClean[], by: string): Promise<{ added: number; changed: number }> {
  const spec = LOGS[log];
  const table = await freshOrMissing(spec.tab);
  const now = new Date().toISOString();
  const ops: Parameters<typeof commitAtomic>[0] = [];
  const append: Record<string, unknown>[] = [];
  let changed = 0;
  for (const r of input) {
    if (r.id) {
      const idx = table.rows.findIndex((row) => {
        const x = spec.read(rowToRecord(spec.tab, row));
        return x && x.id === r.id && x.farm === farm;
      });
      if (idx < 0) throw new Error("Запись не найдена — возможно, её уже удалили. Обновите страницу.");
      const op = logUpdateOp(spec, table.rows[idx], table.rowNumbers[idx], r, by, now);
      if (op) {
        ops.push(op);
        changed += 1;
      }
    } else {
      append.push(logAppendRecord(spec, farm, r, by, now));
    }
  }
  if (append.length) ops.push({ kind: "append", tab: spec.tab, records: append });
  if (ops.length) await commitAtomic(ops);
  return { added: append.length, changed };
}

function logAppendRecord(spec: LogSpec, farm: string, r: LogRowClean, by: string, now: string): Record<string, unknown> {
  return { [spec.idCol]: generateId(spec.idPrefix), ...spec.toRecord(farm, r), CreatedBy: by, CreatedAt: now, UpdatedBy: by, UpdatedAt: now };
}

/** Правка строки журнала — только изменившиеся ячейки; ничего не изменилось — `null`. */
function logUpdateOp(spec: LogSpec, row: string[], rowNumber: number, r: LogRowClean, by: string, now: string): Parameters<typeof commitAtomic>[0][number] | null {
  const was = rowToRecord(spec.tab, row);
  const next = spec.changes(r);
  const diff: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(next)) {
    const old = (was[col] ?? "").trim();
    const nv = String(val ?? "").trim();
    // Числа таблица отдаёт «как показано» — сравниваем через sheetNumber, где это число.
    const same = old === nv || (nv !== "" && !Number.isNaN(Number(nv)) && sheetNumber(old) === Number(nv)) || (col.endsWith("At") || col === "Date" ? toIsoDate(old) === nv : false);
    if (!same) diff[col] = val;
  }
  if (!Object.keys(diff).length) return null;
  return { kind: "update", tab: spec.tab, rowNumber, changes: { ...diff, UpdatedBy: by, UpdatedAt: now } };
}

export interface DayLogInput {
  rows: LogRowClean[];
  /** Номера строк, которые человек видел на экране: удаляются только они. */
  known: string[];
}

export interface DayWorkInput {
  rows: WorkRowClean[];
  known: string[];
}

export interface DaySaveResult {
  added: number;
  changed: number;
  removed: number;
}

/**
 * «Внести день»: срезка, брак, черенкование и выработка участков за один день — одним `commitAtomic` (все вкладки в
 * таблице зарплаты, грабли 1.16). По каждому журналу — план `planDayRows`: новые дописываются, изменённые правятся
 * ячейками, убранные с экрана удаляются. Присылаются только разделы, которые человек менял.
 */
export async function saveGreenhouseDay(
  farm: string,
  date: string,
  logs: Partial<Record<LogKind, DayLogInput>>,
  work: Partial<Record<WorkArea, DayWorkInput>>,
  employees: Pick<Employee, "employeeId" | "fullName">[],
  by: string,
): Promise<DaySaveResult> {
  const now = new Date().toISOString();
  const ops: Parameters<typeof commitAtomic>[0] = [];
  const result: DaySaveResult = { added: 0, changed: 0, removed: 0 };
  for (const kind of Object.keys(logs) as LogKind[]) {
    const input = logs[kind];
    if (!input) continue;
    const spec = LOGS[kind];
    const table = await freshOrMissing(spec.tab);
    const mine: { idx: number; id: string }[] = [];
    table.rows.forEach((row, idx) => {
      const rec = rowToRecord(spec.tab, row);
      const x = spec.read(rec);
      if (x && x.farm === farm && toIsoDate(rec.Date) === date) mine.push({ idx, id: x.id });
    });
    const plan = planDayRows(
      mine.map((m) => m.id),
      input.rows,
      (r) => r.id,
      input.known,
    );
    if (plan.error) throw new Error(plan.error);
    const at = new Map(mine.map((m) => [m.id, m.idx]));
    for (const r of plan.update) {
      const idx = at.get(r.id)!;
      const op = logUpdateOp(spec, table.rows[idx], table.rowNumbers[idx], r, by, now);
      if (op) {
        ops.push(op);
        result.changed += 1;
      }
    }
    if (plan.add.length) {
      ops.push({ kind: "append", tab: spec.tab, records: plan.add.map((r) => logAppendRecord(spec, farm, r, by, now)) });
      result.added += plan.add.length;
    }
    if (plan.remove.length) {
      ops.push({ kind: "delete", tab: spec.tab, rowNumbers: plan.remove.map((id) => table.rowNumbers[at.get(id)!]) });
      result.removed += plan.remove.length;
    }
  }
  for (const area of Object.keys(work) as WorkArea[]) {
    const input = work[area];
    if (!input) continue;
    const plan = await planWorkDay(farm, area, date, input.rows, employees, by, input.known);
    ops.push(...plan.ops);
    result.added += plan.added;
    result.changed += plan.changed;
    result.removed += plan.removed;
  }
  if (ops.length) await commitAtomic(ops);
  return result;
}

export async function deleteLogRow(log: LogKind, farm: string, id: string): Promise<boolean> {
  const spec = LOGS[log];
  const table = await freshOrMissing(spec.tab);
  const idx = table.rows.findIndex((row) => {
    const x = spec.read(rowToRecord(spec.tab, row));
    return x && x.id === id && x.farm === farm;
  });
  if (idx < 0) return false;
  await commitAtomic([{ kind: "delete", tab: spec.tab, rowNumbers: [table.rowNumbers[idx]] }]);
  return true;
}

export async function listLogIds(log: LogKind, farm: string): Promise<string[]> {
  const spec = LOGS[log];
  const table = await freshOrMissing(spec.tab);
  const out: string[] = [];
  for (const row of table.rows) {
    const r = rowToRecord(spec.tab, row);
    if ((r.Farm || "").trim().toLowerCase() === farm && (r[spec.idCol] || "").trim()) out.push((r[spec.idCol] || "").trim());
  }
  return out;
}

/** Кусок книги: номер строки — хэш содержимого, уже загруженные пропускаются (как у выработки). */
export async function importLogRows(log: LogKind, farm: string, input: ImportLogRow[], by: string): Promise<{ added: number; skipped: number }> {
  const spec = LOGS[log];
  const table = await freshOrMissing(spec.tab);
  const have = new Set<string>();
  for (const row of table.rows) {
    const id = (row[0] || "").trim();
    if (id) have.add(id);
  }
  const now = new Date().toISOString();
  const records: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of input) {
    const id = importLogId(farm, log, r);
    if (have.has(id)) {
      skipped += 1;
      continue;
    }
    have.add(id);
    records.push({ [spec.idCol]: id, ...spec.toRecord(farm, r), Note: "из книги агронома", CreatedBy: by, CreatedAt: now, UpdatedBy: by, UpdatedAt: now });
  }
  if (records.length) await commitAtomic([{ kind: "append", tab: spec.tab, records }]);
  return { added: records.length, skipped };
}
