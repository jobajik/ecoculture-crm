"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/actionResult";
import { FARM_ORDER } from "@/lib/constants";
import { greenhouseSession } from "@/lib/greenhouse/session";
import { cleanCycle, cleanLogRow, cycleOf, GH_VARIETIES, type CycleDraft, type ImportLogRow, type LogKind, type LogRowClean, type LogRowDraft } from "@/lib/greenhouse/production";
import { deleteCycle, deleteLogRow, importCycles, importLogRows, listLogIds, loadGreenhouse, saveCycle, saveGreenhouseDay, saveLogRows, type DayLogInput, type DayWorkInput } from "@/lib/repo/greenhouse";
import { cleanWorkDay, isWorkArea, type WorkArea, type WorkRowDraft } from "@/lib/payroll/work";
import { listDepartments, listEmployees, prefetchPayroll } from "@/lib/repo/payroll";
import { toIsoDate } from "@/lib/sheetDate";
import { forgetReads } from "@/lib/sheets";
import { dayLogs, dayWork } from "@/lib/greenhouse/dayData";
import { listWork } from "@/lib/repo/payrollWork";
import { localDayKey } from "@/lib/timezone";

/**
 * Действия «Теплицы»: журналы (срезка, черенкование, брак) и даты циклов. Всё присланное из браузера проверяется
 * заново той же `cleanLogRow` (грабли 1.11); отказ возвращается текстом через `guard()` (грабли 1.13).
 */

const LOGS: LogKind[] = ["harvest", "cuttings", "waste"];

function refresh() {
  revalidatePath("/greenhouse", "layout");
}

async function editor(farm: string) {
  const { scope, email } = await greenhouseSession({ farm });
  if (!scope) throw new Error("Раздел «Теплица» для вас закрыт.");
  if (!scope.editsLogs) throw new Error("Записи теплицы ведут агроном и ответственные за участки — у вас просмотр.");
  const f = String(farm ?? "").trim().toLowerCase();
  if (!FARM_ORDER.includes(f)) throw new Error("Не указана компания.");
  if (scope.farmLocked && scope.farmLocked !== f) throw new Error("Это записи другого производства.");
  return { email, farm: f };
}

function cleanLog(log: string): LogKind {
  if (!LOGS.includes(log as LogKind)) throw new Error("Неизвестный журнал.");
  return log as LogKind;
}

/** Сорта, уже встречавшиеся в журналах компании, плюс книжные — чтобы «karma pink» записался как «Karma Pink». */
async function knownVarieties(farm: string): Promise<string[]> {
  const data = await loadGreenhouse(farm);
  const set = new Set<string>(GH_VARIETIES);
  for (const list of [data.harvest, data.cuttings, data.waste]) for (const x of list) if (x.variety) set.add(x.variety);
  return Array.from(set);
}

async function saveLogRowsActionInner(log: string, farm: string, drafts: LogRowDraft[]) {
  const kind = cleanLog(log);
  const { email, farm: f } = await editor(farm);
  if (!Array.isArray(drafts) || drafts.length === 0) throw new Error("Нечего записывать.");
  if (drafts.length > 300) throw new Error("За раз — не больше 300 строк.");
  const today = localDayKey();
  const known = await knownVarieties(f);
  const clean: LogRowClean[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const { row, error } = cleanLogRow(kind, drafts[i], today, known);
    if (!row) throw new Error(`Строка ${i + 1}: ${error}.`);
    clean.push(row);
  }
  const result = await saveLogRows(kind, f, clean, email);
  refresh();
  return result;
}
export async function saveLogRowsAction(log: string, farm: string, drafts: LogRowDraft[]) {
  return guard(() => saveLogRowsActionInner(log, farm, drafts));
}

async function deleteLogRowActionInner(log: string, farm: string, id: string) {
  const kind = cleanLog(log);
  const { farm: f } = await editor(farm);
  const removed = await deleteLogRow(kind, f, String(id ?? "").trim());
  if (!removed) throw new Error("Запись не найдена — возможно, её уже удалили.");
  refresh();
  return { ok: true };
}
export async function deleteLogRowAction(log: string, farm: string, id: string) {
  return guard(() => deleteLogRowActionInner(log, farm, id));
}

async function saveCycleActionInner(farm: string, draft: CycleDraft) {
  const { email, farm: f } = await editor(farm);
  const { cycle, error } = cleanCycle(draft);
  if (!cycle) throw new Error(error);
  const result = await saveCycle(f, cycle, email);
  refresh();
  return result;
}
export async function saveCycleAction(farm: string, draft: CycleDraft) {
  return guard(() => saveCycleActionInner(farm, draft));
}

async function deleteCycleActionInner(farm: string, cycle: number, block: string) {
  const { farm: f } = await editor(farm);
  const c = cycleOf(cycle);
  if (!c) throw new Error("Номер цикла — целое число.");
  const removed = await deleteCycle(f, c, String(block ?? "").trim());
  if (!removed) throw new Error("Даты этого блока уже удалены.");
  refresh();
  return { ok: true };
}
export async function deleteCycleAction(farm: string, cycle: number, block: string) {
  return guard(() => deleteCycleActionInner(farm, cycle, block));
}

async function listLogIdsActionInner(log: string, farm: string) {
  const kind = cleanLog(log);
  const { farm: f } = await editor(farm);
  return await listLogIds(kind, f);
}
export async function listLogIdsAction(log: string, farm: string) {
  return guard(() => listLogIdsActionInner(log, farm));
}

const CHUNK_MAX = 4000;

async function importLogRowsActionInner(log: string, farm: string, rows: ImportLogRow[]) {
  const kind = cleanLog(log);
  const { email, farm: f } = await editor(farm);
  if (!Array.isArray(rows) || rows.length === 0) return { added: 0, skipped: 0 };
  if (rows.length > CHUNK_MAX) throw new Error(`За раз загружается не больше ${CHUNK_MAX} строк.`);
  const today = localDayKey();
  // Сорт не сверяем со списком: книга — источник сортов. Остальное — как у ручного ввода.
  const clean: ImportLogRow[] = [];
  for (const r of rows) {
    const { row, error } = cleanLogRow(kind, { ...r, weightKg: r.weightKg, kind: r.kind }, today, []);
    if (!row) throw new Error(`Строка из файла не прошла проверку: ${error}.`);
    clean.push({ ...row, ordinal: Math.max(1, Math.round(Number(r.ordinal) || 1)) });
  }
  const result = await importLogRows(kind, f, clean, email);
  refresh();
  return result;
}
export async function importLogRowsAction(log: string, farm: string, rows: ImportLogRow[]) {
  return guard(() => importLogRowsActionInner(log, farm, rows));
}

async function importCyclesActionInner(farm: string, drafts: CycleDraft[]) {
  const { email, farm: f } = await editor(farm);
  if (!Array.isArray(drafts) || drafts.length > 2000) throw new Error("Слишком много строк дат.");
  const clean = [];
  for (const d of drafts) {
    const { cycle, error } = cleanCycle(d);
    if (!cycle) throw new Error(`Даты циклов: ${error}`);
    clean.push(cycle);
  }
  const result = await importCycles(f, clean, email);
  refresh();
  return result;
}
export async function importCyclesAction(farm: string, drafts: CycleDraft[]) {
  return guard(() => importCyclesActionInner(farm, drafts));
}

// --- Внести день ---------------------------------------------------------------------

export interface DayPayload {
  logs?: Partial<Record<LogKind, { rows: LogRowDraft[]; known: string[] }>>;
  work?: Partial<Record<WorkArea, { rows: WorkRowDraft[]; known: string[] }>>;
}

/**
 * Сохранить день целиком: срезку, брак, черенкование и выработку участков — одной записью. Каждая строка проверяется
 * заново (журналы — `cleanLogRow`, выработка — `cleanWorkDay`), дата у всех строк — день страницы. Журналы пишут те,
 * кому открыты записи теплицы, выработку — те, кому её открывает роль модуля зарплаты.
 */
async function saveDayActionInner(farm: string, date: string, payload: DayPayload) {
  const { scope, email } = await greenhouseSession({ farm });
  if (!scope) throw new Error("Раздел «Теплица» для вас закрыт.");
  const f = String(farm ?? "").trim().toLowerCase();
  if (!FARM_ORDER.includes(f)) throw new Error("Не указана компания.");
  if (scope.farmLocked && scope.farmLocked !== f) throw new Error("Это записи другого производства.");
  const today = localDayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toIsoDate(date) !== date) throw new Error("Дата записана неверно.");
  if (date > today) throw new Error("Записи ведутся по факту — будущий день вносить нельзя.");

  const logs: Partial<Record<LogKind, DayLogInput>> = {};
  const logKinds = Object.keys(payload?.logs ?? {}).filter((k) => payload.logs?.[k as LogKind]);
  if (logKinds.length) {
    if (!scope.editsLogs) throw new Error("Срезку, брак и черенкование записывают агроном и ответственные за участки — у вас просмотр.");
    const known = await knownVarieties(f);
    for (const k of logKinds) {
      const kind = cleanLog(k);
      const input = payload.logs![kind]!;
      const drafts = Array.isArray(input.rows) ? input.rows : [];
      if (drafts.length > 500) throw new Error("За день — не больше 500 строк в одном журнале.");
      const rows = [];
      for (let i = 0; i < drafts.length; i++) {
        const { row, error } = cleanLogRow(kind, { ...drafts[i], date }, today, known);
        if (!row) throw new Error(`${LOG_TITLES[kind]}, строка ${i + 1}: ${error}.`);
        rows.push(row);
      }
      logs[kind] = { rows, known: Array.isArray(input.known) ? input.known.map(String) : [] };
    }
  }

  const work: Partial<Record<WorkArea, DayWorkInput>> = {};
  const areas = Object.keys(payload?.work ?? {}).filter((a) => payload.work?.[a as WorkArea]);
  let employees: { employeeId: string; fullName: string }[] = [];
  if (areas.length) {
    await prefetchPayroll();
    const [departments, all] = await Promise.all([listDepartments(), listEmployees()]);
    const deptIds = new Set(departments.filter((d) => d.farm === f).map((d) => d.deptId));
    employees = all.filter((e) => deptIds.has(e.deptId));
    for (const a of areas) {
      if (!isWorkArea(a)) throw new Error("Неизвестный участок.");
      const input = payload.work![a]!;
      const { rows, error } = cleanWorkDay(scope.payroll, a, date, Array.isArray(input.rows) ? input.rows : [], employees, today);
      if (error) throw new Error(`Выработка: ${error}`);
      work[a] = { rows, known: Array.isArray(input.known) ? input.known.map(String) : [] };
    }
  }
  if (!Object.keys(logs).length && !Object.keys(work).length) throw new Error("Изменений нет.");
  const result = await saveGreenhouseDay(f, date, logs, work, employees, email);
  refresh();
  // Свежий день — браузеру: номера новых строк он берёт отсюда, иначе следующее сохранение задвоило бы их.
  forgetReads();
  const fresh = await loadGreenhouse(f);
  const freshWork = Object.keys(work).length ? dayWork(await listWork({ farm: f, from: date, to: date }), date) : null;
  return { ...result, logs: dayLogs(fresh, date), work: freshWork };
}
export async function saveDayAction(farm: string, date: string, payload: DayPayload) {
  return guard(() => saveDayActionInner(farm, date, payload));
}

const LOG_TITLES: Record<LogKind, string> = { harvest: "Срезка", cuttings: "Черенкование", waste: "Брак" };
