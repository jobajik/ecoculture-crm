"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import SaveBar from "@/components/SaveBar";
import {
  TIMESHEET_CODES,
  TIMESHEET_STATUS_LABELS,
  applyFired,
  employedOn,
  fillBySchedule,
  normalizeCell,
  summarizeRow,
  type DayInfo,
  type TimesheetMove,
  type TimesheetPerson,
  type TimesheetStatus,
} from "@/lib/payroll/timesheet";

const CODE_STYLE: Record<string, string> = {
  "Б": "bg-[#fde8e8] text-[#a12b2b]",
  "БС": "bg-[#eeeeee] text-[#555]",
  "О": "bg-[#e3effd] text-[#1f5fa8]",
  "К": "bg-[#efe7fb] text-[#6a3fb0]",
  "П": "bg-[#a12b2b] text-white",
  "В": "text-ink-muted",
  "У": "bg-[#444] text-white",
  "Д": "bg-[#e5f4e8] text-[#2d6b3a]",
};

const PALETTE = ["8", "7", "5", "12", "24", "Д", "В", "Б", "БС", "О", "К", "П", "У"];

type Sel = { r0: number; c0: number; r1: number; c1: number };

/**
 * Табель подразделения за месяц — сетка «сотрудник × день», как бумажный табель начальника. Ввод: часы или код
 * прямо в клетке, стрелки и Enter ходят по сетке; мышью можно выделить прямоугольник и поставить отметку кнопкой
 * сверху (отпуск с 5 по 18 — одно движение). «У» ставит «уволен» до конца месяца. Итоги строки считаются сразу,
 * теми же правилами, что на сервере (`payroll/timesheet.ts`).
 */
export default function TimesheetGrid({
  month,
  deptId,
  workWeek,
  overtime,
  dayShiftHours,
  days,
  people,
  initial,
  status,
  comment,
  canEdit,
  editRefusal,
  canSubmit,
  canReview,
  save,
  move,
}: {
  month: string;
  deptId: string;
  workWeek: 5 | 6;
  overtime: boolean;
  dayShiftHours: number;
  days: DayInfo[];
  people: TimesheetPerson[];
  initial: Record<string, string[]>;
  status: TimesheetStatus;
  comment: string;
  canEdit: boolean;
  editRefusal: string;
  canSubmit: boolean;
  canReview: boolean;
  save: (month: string, deptId: string, rows: { employeeId: string; shift: string; cells: string[] }[]) => Promise<unknown>;
  move: (month: string, deptId: string, move: TimesheetMove, comment: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const blank = () => days.map(() => "");
  const [base, setBase] = useState<Record<string, string[]>>(() => Object.fromEntries(people.map((p) => [p.key, initial[p.key] ?? blank()])));
  const [cells, setCells] = useState<Record<string, string[]>>(base);
  const [sel, setSel] = useState<Sel | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [returnText, setReturnText] = useState("");
  const [returning, setReturning] = useState(false);
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());

  const norm = (v: string) => normalizeCell(v) ?? v;
  const dirtyKeys = people.filter((p) => (cells[p.key] ?? []).some((v, i) => norm(v) !== (base[p.key]?.[i] ?? ""))).map((p) => p.key);
  const badCount = people.reduce((n, p) => n + (cells[p.key] ?? []).filter((v) => normalizeCell(v) === null).length, 0);

  const summaries = useMemo(
    () =>
      Object.fromEntries(
        people.map((p) => [
          p.key,
          summarizeRow(
            (cells[p.key] ?? []).map((v) => normalizeCell(v) ?? ""),
            days,
            { workWeek, overtime: overtime && !p.hourly, dayShiftHours, hiredAt: p.hiredAt, firedAt: p.firedAt }
          ),
        ])
      ),
    [cells, people, days, workWeek, overtime, dayShiftHours]
  );
  const totalHours = Math.round(people.reduce((s, p) => s + summaries[p.key].hours, 0) * 100) / 100;

  function setCell(r: number, c: number, value: string) {
    const p = people[r];
    if (!p) return;
    setCells((prev) => {
      let row = [...(prev[p.key] ?? blank())];
      if (normalizeCell(value) === "У") row = applyFired(row, c);
      else row[c] = value;
      return { ...prev, [p.key]: row };
    });
    setDone("");
  }

  function locked(r: number, c: number): boolean {
    const p = people[r];
    return !p || !days[c] || !employedOn(days[c].date, p.hiredAt, p.firedAt);
  }

  function focus(r: number, c: number) {
    const el = inputs.current.get(`${r}:${c}`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const moves: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] };
    const m = moves[e.key];
    if (!m) return;
    const input = e.currentTarget;
    // Внутри набранного текста стрелки влево-вправо двигают курсор, а не клетку.
    if (e.key === "ArrowLeft" && input.selectionStart !== 0) return;
    if (e.key === "ArrowRight" && input.selectionEnd !== input.value.length) return;
    e.preventDefault();
    focus(Math.max(0, Math.min(people.length - 1, r + m[0])), Math.max(0, Math.min(days.length - 1, c + m[1])));
    setSel(null);
  }

  function inSel(r: number, c: number) {
    if (!sel) return false;
    return r >= Math.min(sel.r0, sel.r1) && r <= Math.max(sel.r0, sel.r1) && c >= Math.min(sel.c0, sel.c1) && c <= Math.max(sel.c0, sel.c1);
  }

  function paint(value: string) {
    if (!sel) return;
    const rMin = Math.min(sel.r0, sel.r1);
    const rMax = Math.max(sel.r0, sel.r1);
    const cMin = Math.min(sel.c0, sel.c1);
    const cMax = Math.max(sel.c0, sel.c1);
    setCells((prev) => {
      const next = { ...prev };
      for (let r = rMin; r <= rMax; r++) {
        const p = people[r];
        let row = [...(next[p.key] ?? blank())];
        if (value === "У") row = applyFired(row, cMin);
        else for (let c = cMin; c <= cMax; c++) if (!locked(r, c)) row[c] = value;
        next[p.key] = row;
      }
      return next;
    });
    // Одна клетка — дальше вправо: на телефоне так заполняют подряд «8, 8, 8…» кнопками.
    if (rMin === rMax && cMin === cMax && value !== "У") {
      let c = cMin + 1;
      while (c < days.length && locked(rMin, c)) c += 1;
      if (c < days.length) setSel({ r0: rMin, c0: c, r1: rMin, c1: c });
    }
    setDone("");
  }

  function fillSchedule() {
    const rows = sel ? new Set(Array.from({ length: Math.abs(sel.r1 - sel.r0) + 1 }, (_, i) => Math.min(sel.r0, sel.r1) + i)) : null;
    setCells((prev) => {
      const next = { ...prev };
      people.forEach((p, r) => {
        if (p.hourly || (rows && !rows.has(r))) return;
        next[p.key] = fillBySchedule(next[p.key] ?? blank(), days, workWeek, p.hiredAt, p.firedAt);
      });
      return next;
    });
    setDone("");
  }

  async function onSave() {
    if (badCount > 0) {
      setError(`Непонятных отметок: ${badCount} — они подсвечены красным. Пишите часы (до 24) или код.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const rows = people
        .filter((p) => dirtyKeys.includes(p.key))
        .map((p) => ({ employeeId: p.employeeId, shift: p.shift, cells: (cells[p.key] ?? []).map((v) => normalizeCell(v) ?? "") }));
      unwrapValue(await save(month, deptId, rows));
      const normalized = Object.fromEntries(people.map((p) => [p.key, (cells[p.key] ?? []).map((v) => normalizeCell(v) ?? "")]));
      setBase(normalized);
      setCells(normalized);
      setDone("Табель сохранён.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function onMove(m: TimesheetMove, text = "") {
    setSaving(true);
    setError("");
    try {
      unwrap(await move(month, deptId, m, text));
      setReturning(false);
      setReturnText("");
      setDone(m === "submit" ? "Табель отправлен бухгалтеру на проверку." : m === "approve" ? "Табель принят." : m === "return" ? "Табель возвращён начальнику." : "Табель снова открыт для правок.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
    } finally {
      setSaving(false);
    }
  }

  const dirty = dirtyKeys.length > 0;

  return (
    <div className="space-y-3" onMouseUp={() => setDragging(false)}>
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={clsx(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            status === "approved" ? "bg-status-good/10 text-status-good" : status === "submitted" ? "bg-[#fff4d6] text-[#8a5a00]" : status === "returned" ? "bg-[#fde8e8] text-[#a12b2b]" : "bg-surface-sunk text-ink-secondary"
          )}
        >
          {TIMESHEET_STATUS_LABELS[status]}
        </span>
        <span className="text-sm text-ink-secondary tabular-nums">
          Людей: {people.filter((p) => p.shift === "").length} · часов всего: {totalHours.toLocaleString("ru-RU")}
        </span>
        <div className="flex flex-wrap gap-2 ml-auto">
          {canSubmit && (status === "" || status === "returned") && (
            <button type="button" className="btn-primary !py-1.5" disabled={saving || dirty} title={dirty ? "Сначала сохраните изменения" : ""} onClick={() => onMove("submit")}>
              Отправить на проверку
            </button>
          )}
          {canReview && status !== "approved" && (
            <button type="button" className="btn-primary !py-1.5" disabled={saving || dirty} title={dirty ? "Сначала сохраните изменения" : ""} onClick={() => onMove("approve")}>
              Принять табель
            </button>
          )}
          {canReview && (status === "submitted" || status === "approved") && (
            <button type="button" className="btn !py-1.5" disabled={saving} onClick={() => setReturning((v) => !v)}>
              Вернуть начальнику
            </button>
          )}
          {canReview && status === "approved" && (
            <button type="button" className="btn !py-1.5" disabled={saving} onClick={() => onMove("reopen")}>
              Открыть снова
            </button>
          )}
        </div>
        {status === "returned" && comment && (
          <p className="w-full text-sm rounded-lg bg-[#fde8e8] text-[#a12b2b] px-3 py-2">Бухгалтер вернула табель: {comment}</p>
        )}
        {returning && (
          <div className="w-full flex flex-wrap gap-2 items-start">
            <textarea className="input flex-1 min-w-[16rem]" rows={2} placeholder="Что исправить — начальник увидит это над табелем" value={returnText} onChange={(e) => setReturnText(e.target.value)} />
            <button type="button" className="btn-primary !py-1.5" disabled={saving} onClick={() => onMove("return", returnText)}>
              Вернуть
            </button>
          </div>
        )}
        {!canEdit && editRefusal && <p className="w-full text-sm text-ink-muted">{editRefusal}</p>}
      </div>

      {canEdit && (
        <div className="card flex flex-wrap items-center gap-2 !py-2.5">
          <span className="text-xs text-ink-muted mr-1">{sel ? "В выделенное:" : "Выделите клетки мышью, потом нажмите отметку:"}</span>
          {PALETTE.map((v) => (
            <button
              key={v}
              type="button"
              disabled={!sel}
              title={TIMESHEET_CODES[v as keyof typeof TIMESHEET_CODES] ?? `${v} ч`}
              className={clsx("min-w-[2.25rem] rounded-md border border-line-hairline px-2 py-1 text-sm font-medium disabled:opacity-40", CODE_STYLE[v] ?? "bg-surface")}
              onClick={() => paint(v)}
            >
              {v}
            </button>
          ))}
          <button type="button" disabled={!sel} className="rounded-md border border-line-hairline px-2 py-1 text-sm disabled:opacity-40" onClick={() => paint("")}>
            стереть
          </button>
          <span className="mx-1 h-5 w-px bg-line-hairline" />
          <button type="button" className="btn !py-1 text-sm" onClick={fillSchedule} title="Пустые рабочие дни — часами по графику; выходные, праздники и заполненное не трогаются">
            {sel ? "По графику — выделенные строки" : "Заполнить пустые по графику"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-status-critical">{error}</p>}
      {done && <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>}

      <div className="card !p-0 overflow-x-auto">
        <table className="text-sm border-collapse select-none">
          <thead>
            <tr className="text-xs text-ink-muted">
              <th className="sticky left-0 z-10 bg-surface text-left font-medium px-3 py-2 min-w-[9rem] sm:min-w-[14rem] border-b border-line-hairline">Сотрудник</th>
              {days.map((d) => (
                <th
                  key={d.date}
                  title={d.holiday ? "праздник" : d.off ? "выходной" : ""}
                  className={clsx("font-medium px-0.5 py-1 border-b border-line-hairline text-center w-9", d.holiday ? "bg-[#fff1d6] text-[#8a5a00]" : d.off && "bg-surface-sunk")}
                >
                  <div className="tabular-nums text-ink-secondary">{d.day}</div>
                  <div className="text-[10px]">{d.weekday}</div>
                </th>
              ))}
              <th className="px-2 border-b border-line-hairline font-medium" title="Часы за месяц">Часы</th>
              <th className="px-2 border-b border-line-hairline font-medium" title="Часы в праздники (×1,5)">Празд.</th>
              {overtime && <th className="px-2 border-b border-line-hairline font-medium" title="Сверх нормы: часы − праздничные − норма">Сверх</th>}
              <th className="px-1.5 border-b border-line-hairline font-medium" title="Отпуск, дней">О</th>
              <th className="px-1.5 border-b border-line-hairline font-medium" title="Больничный, дней">Б</th>
              <th className="px-1.5 border-b border-line-hairline font-medium" title="Командировка, дней">К</th>
              <th className="px-1.5 border-b border-line-hairline font-medium" title="Прогул, дней">П</th>
              <th className="px-1.5 border-b border-line-hairline font-medium" title="Без содержания, дней">БС</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p, r) => {
              const s = summaries[p.key];
              const row = cells[p.key] ?? blank();
              const rowDirty = dirtyKeys.includes(p.key);
              return (
                <tr key={p.key} className={clsx("border-b border-line-hairline/60", p.shift === "night" && "bg-surface-sunk/40")}>
                  <td className={clsx("sticky left-0 z-10 px-3 py-1 min-w-[9rem] max-w-[9rem] sm:min-w-[14rem] sm:max-w-[16rem]", rowDirty ? "bg-[#fff8e6]" : "bg-surface")}>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        {p.shift === "night" ? (
                          <div className="text-xs text-ink-muted pl-3">ночь</div>
                        ) : (
                          <>
                            <div className="truncate font-medium" title={p.fullName}>
                              {p.fullName}
                            </div>
                            <div className="truncate text-xs text-ink-muted">
                              {p.position}
                              {p.hourly ? " · день" : ""}
                            </div>
                          </>
                        )}
                      </div>
                      {/* Часы за месяц видны сразу, без прокрутки до итогов справа. */}
                      <span className="shrink-0 text-xs tabular-nums text-ink-secondary" title="часов за месяц">
                        {s.hours ? `${s.hours.toLocaleString("ru-RU")} ч` : ""}
                      </span>
                    </div>
                  </td>
                  {days.map((d, c) => {
                    if (locked(r, c)) {
                      return (
                        <td key={d.date} className="text-center text-ink-muted/50 bg-surface-sunk" title="не работал в этот день">
                          ·
                        </td>
                      );
                    }
                    const raw = row[c] ?? "";
                    const n = normalizeCell(raw);
                    return (
                      <td
                        key={d.date}
                        className={clsx("p-0 border-l border-line-hairline/50", inSel(r, c) && "outline outline-2 -outline-offset-2 outline-section-payroll", d.holiday ? "bg-[#fffaf0]" : d.off && "bg-surface-sunk/60")}
                        onMouseDown={(e) => {
                          if (!canEdit) return;
                          if (e.shiftKey && sel) setSel({ ...sel, r1: r, c1: c });
                          else setSel({ r0: r, c0: c, r1: r, c1: c });
                          setDragging(true);
                        }}
                        onMouseEnter={() => dragging && sel && setSel({ ...sel, r1: r, c1: c })}
                      >
                        <input
                          ref={(el) => {
                            if (el) inputs.current.set(`${r}:${c}`, el);
                            else inputs.current.delete(`${r}:${c}`);
                          }}
                          value={raw}
                          disabled={!canEdit}
                          inputMode="text"
                          maxLength={5}
                          aria-label={`${p.fullName}${p.shift === "night" ? " ночь" : ""}, ${d.day} число`}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          onBlur={(e) => {
                            const v = normalizeCell(e.target.value);
                            if (v !== null && v !== e.target.value) setCell(r, c, v);
                          }}
                          onKeyDown={(e) => onKey(e, r, c)}
                          className={clsx(
                            "w-9 h-8 text-center bg-transparent tabular-nums focus:bg-white focus:outline-none focus:ring-2 focus:ring-section-payroll/50 disabled:text-ink-primary",
                            n === null ? "bg-[#fde8e8] text-status-critical font-semibold" : CODE_STYLE[n] ?? ""
                          )}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 text-right tabular-nums font-medium">{s.hours ? s.hours.toLocaleString("ru-RU") : "—"}</td>
                  <td className="px-2 text-right tabular-nums">{s.holidayHours || ""}</td>
                  {overtime && <td className="px-2 text-right tabular-nums">{p.hourly ? "" : s.overtime || ""}</td>}
                  <td className="px-1.5 text-right tabular-nums">{s.vacation || ""}</td>
                  <td className="px-1.5 text-right tabular-nums">{s.sick || ""}</td>
                  <td className="px-1.5 text-right tabular-nums">{s.trip || ""}</td>
                  <td className="px-1.5 text-right tabular-nums">{s.absent || ""}</td>
                  <td className="px-1.5 text-right tabular-nums">{s.unpaid || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-muted">
        Коды: часы цифрой (8, 7, 8,5, 24) · {Object.entries(TIMESHEET_CODES)
          .map(([k, v]) => `${k} — ${v.toLowerCase()}`)
          .join(" · ")}
        . «Д» считается как норма дня месяца — сейчас {dayShiftHours.toLocaleString("ru-RU")} ч. «У» ставит «уволен» до конца месяца.
      </p>

      {canEdit && <SaveBar count={dirtyKeys.length} what="строк" saving={saving} onSave={onSave} onReset={() => setCells(base)} />}
    </div>
  );
}
