import type { GhData } from "../repo/greenhouse";
import type { WorkArea, WorkEntry, WorkRowDraft } from "../payroll/work";
import { WORK_AREAS } from "../payroll/work";
import type { DayLogRow } from "./day";
import type { LogKind } from "./production";

/**
 * Строки одного дня для «Внести день» — одна сборка на страницу и на ответ сохранения: после записи действие
 * возвращает свежий день, и браузер берёт номера новых строк из него, а не ждёт перерисовки страницы.
 */
export function dayLogs(data: GhData, date: string): Record<LogKind, DayLogRow[]> {
  return {
    harvest: data.harvest.filter((h) => h.date === date).map((h) => ({ id: h.id, cycle: h.cycle, block: h.block, variety: h.variety, kind: h.grade, qty: h.qty, weightKg: h.weightKg, part: "", line: "", note: h.note })),
    cuttings: data.cuttings.filter((c) => c.date === date).map((c) => ({ id: c.id, cycle: c.cycle, block: c.block, variety: c.variety, kind: c.kind, qty: c.qty, weightKg: 0, part: c.part, line: c.line, note: c.note })),
    waste: data.waste.filter((w) => w.date === date).map((w) => ({ id: w.id, cycle: w.cycle, block: w.block, variety: w.variety, kind: w.kind, qty: w.qty, weightKg: 0, part: "", line: "", note: w.note })),
  };
}

export type DayWorkRow = WorkRowDraft & { name: string };

export function dayWork(entries: WorkEntry[], date: string): Record<WorkArea, DayWorkRow[]> {
  const day = entries.filter((e) => e.date === date);
  return Object.fromEntries(
    WORK_AREAS.map((a) => [a, day.filter((e) => e.area === a).map((e) => ({ workId: e.workId, employeeId: e.employeeId, name: e.name, block: e.block, part: e.part, workType: e.workType, qty: e.qty, hours: e.hours, note: e.note }))]),
  ) as Record<WorkArea, DayWorkRow[]>;
}
