"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { shortName } from "@/lib/payroll/rules";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import SaveBar from "@/components/SaveBar";
import {
  TIMESHEET_CODES,
  TIMESHEET_STATUS_LABELS,
  applyFired,
  employedOn,
  fillBySchedule,
  missingWorkDays,
  normalizeCell,
  scheduleHours,
  summarizeRow,
  type DayInfo,
  type TimesheetMove,
  type TimesheetPerson,
  type TimesheetStatus,
} from "@/lib/payroll/timesheet";

/** Цвет отметки: код — свой оттенок, часы — зелёный, чем больше, тем гуще. */
// 28.10.2026, владелец: «сделай обозначения менее массивными, но заметными» — сплошные тёмные плашки «У» и «П» на
// весь месяц читались как чёрная полоса. Теперь у всех кодов светлый фон и ЦВЕТНАЯ рамка: заметно по цвету, не по массе.
const CODE_STYLE: Record<string, string> = {
  "Б": "bg-[#fff1f1] text-[#a12b2b] ring-1 ring-inset ring-[#e8b4b4]",
  "БС": "bg-[#f4f4f4] text-[#666] ring-1 ring-inset ring-[#d4d4d4]",
  "О": "bg-[#eef5ff] text-[#1f5fa8] ring-1 ring-inset ring-[#b7cff0]",
  "К": "bg-[#f4eefc] text-[#6a3fb0] ring-1 ring-inset ring-[#d2c2ee]",
  "П": "bg-[#fff1f1] text-[#b42f2f] ring-1 ring-inset ring-[#d9797a] font-bold",
  "В": "bg-transparent text-ink-muted",
  "У": "bg-[#f3f3f3] text-[#555] ring-1 ring-inset ring-[#bdbdbd]",
  "Д": "bg-[#eef8f1] text-[#2d6b3a] ring-1 ring-inset ring-[#b5dcc1]",
};
const CODE_HINT: Record<string, string> = {
  "Б": "Больничный",
  "БС": "Без содержания",
  "О": "Отпуск",
  "К": "Командировка",
  "П": "Прогул",
  "В": "Выходной",
  "У": "Уволен — до конца месяца",
  "Д": "Дневная смена",
};
const CODES_ORDER = ["О", "Б", "К", "П", "БС", "В", "Д", "У"];

function hoursStyle(h: number): string {
  if (h >= 20) return "bg-[#cfeeda] text-[#124a2b] ring-1 ring-inset ring-[#7fc49a] font-semibold";
  if (h >= 11) return "bg-[#d9efe1] text-[#15502f]";
  if (h >= 8) return "bg-[#e3f3e8] text-[#1e5a38]";
  return "bg-[#f1f8f3] text-[#2f6b47]";
}
function cellStyle(v: string): string {
  if (v === "") return "";
  if (CODE_STYLE[v]) return CODE_STYLE[v];
  const n = Number(v);
  return Number.isFinite(n) ? hoursStyle(n) : "bg-[#fde3e3] text-status-critical";
}

type Cells = Record<string, string[]>;
type Target = { kind: "cell"; r: number; c: number } | { kind: "day"; c: number } | { kind: "row"; r: number };
type Menu = { target: Target; x: number; y: number; up: boolean };

/**
 * Табель подразделения за месяц. Клетка — кнопка: нажатие открывает меню с крупными отметками (часы, отпуск,
 * больничный…) и полем «по какое число» — отпуск с 5 по 18 ставится одним нажатием. Заголовок дня — отметка всем сразу
 * («всем выходной 26-го»), имя — строка целиком («по графику», «очистить»). С клавиатуры тоже можно: стрелки ходят
 * по сетке, цифры и буквы ставят отметку, Backspace стирает, Ctrl+Z отменяет. На телефоне — «По людям»: календарь
 * одного сотрудника, где в клетку попадает палец. Итоги считаются сразу теми же правилами, что на сервере.
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
  today,
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
  /** ГГГГ-ММ-ДД по Алматы — отметка «сегодня» и граница «по графику». */
  today: string;
  save: (month: string, deptId: string, rows: { employeeId: string; shift: string; cells: string[] }[]) => Promise<unknown>;
  move: (month: string, deptId: string, move: TimesheetMove, comment: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const blank = useCallback(() => days.map(() => ""), [days]);
  const [base, setBase] = useState<Cells>(() => Object.fromEntries(people.map((p) => [p.key, initial[p.key] ?? blank()])));
  const [cells, setCells] = useState<Cells>(base);
  const [history, setHistory] = useState<Cells[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [view, setView] = useState<"grid" | "person">("grid");
  const [personIdx, setPersonIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [returnText, setReturnText] = useState("");
  const [returning, setReturning] = useState(false);
  const buttons = useRef<Map<string, HTMLButtonElement>>(new Map());
  const typed = useRef<{ key: string; text: string; at: number }>({ key: "", text: "", at: 0 });

  // Телефон — сразу «По людям»: 31 узкая колонка под палец не годится.
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) setView("person");
  }, []);

  const monthIsCurrent = today.slice(0, 7) === month;
  const until = monthIsCurrent ? today : month < today.slice(0, 7) ? "" : today;
  const futureMonth = month > today.slice(0, 7);

  const dirtyKeys = people.filter((p) => (cells[p.key] ?? []).some((v, i) => v !== (base[p.key]?.[i] ?? ""))).map((p) => p.key);
  const dirty = dirtyKeys.length > 0;

  const summaries = useMemo(
    () =>
      Object.fromEntries(
        people.map((p) => [
          p.key,
          summarizeRow(cells[p.key] ?? [], days, { workWeek, overtime: overtime && !p.hourly, dayShiftHours, hiredAt: p.hiredAt, firedAt: p.firedAt }),
        ])
      ),
    [cells, people, days, workWeek, overtime, dayShiftHours]
  );
  const totalHours = Math.round(people.reduce((s, p) => s + summaries[p.key].hours, 0) * 100) / 100;
  const perDay = useMemo(
    () => days.map((_, c) => people.filter((p) => p.shift === "" && cellHoursOf(cells[p.key]?.[c] ?? "", dayShiftHours) > 0).length),
    [cells, people, days, dayShiftHours]
  );
  const missing = useMemo(
    () =>
      futureMonth
        ? 0
        : people.filter((p) => p.shift === "").reduce((n, p) => n + missingWorkDays(cells[p.key] ?? [], days, p.hiredAt, p.firedAt, until || undefined), 0),
    [cells, people, days, until, futureMonth]
  );

  const locked = useCallback(
    (r: number, c: number) => {
      const p = people[r];
      return !p || !days[c] || !employedOn(days[c].date, p.hiredAt, p.firedAt);
    },
    [people, days]
  );

  function commit(next: (prev: Cells) => Cells) {
    setCells((prev) => {
      const n = next(prev);
      if (n === prev) return prev;
      setHistory((h) => [...h.slice(-49), prev]);
      return n;
    });
    setDone("");
  }

  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setCells(last);
      return h.slice(0, -1);
    });
  }

  /** Поставить отметку в строке с клетки c по клетку cEnd (включительно). «У» — всегда до конца месяца. */
  function setRange(r: number, c: number, cEnd: number, value: string) {
    const p = people[r];
    if (!p) return;
    commit((prev) => {
      let row = [...(prev[p.key] ?? blank())];
      if (value === "У") row = applyFired(row, c);
      else for (let i = c; i <= Math.min(cEnd, days.length - 1); i++) if (!locked(r, i)) row[i] = value;
      return { ...prev, [p.key]: row };
    });
  }

  /** Всем сотрудникам в один день. «schedule» — часы режима каждому (почасовым — нет). */
  function setDayForAll(c: number, value: string | "schedule") {
    commit((prev) => {
      const next = { ...prev };
      people.forEach((p, r) => {
        if (locked(r, c)) return;
        if (value === "schedule" && p.hourly) return;
        const row = [...(next[p.key] ?? blank())];
        row[c] = value === "schedule" ? String(scheduleHours(days[c].date, workWeek)) : value;
        next[p.key] = row;
      });
      return next;
    });
  }

  function fillRow(r: number) {
    const p = people[r];
    if (!p || p.hourly) return;
    commit((prev) => ({ ...prev, [p.key]: fillBySchedule(prev[p.key] ?? blank(), days, workWeek, p.hiredAt, p.firedAt, until) }));
  }
  function clearRow(r: number) {
    const p = people[r];
    if (!p) return;
    commit((prev) => ({ ...prev, [p.key]: blank() }));
  }
  function fillAll() {
    commit((prev) => {
      const next = { ...prev };
      people.forEach((p) => {
        if (p.hourly) return;
        next[p.key] = fillBySchedule(next[p.key] ?? blank(), days, workWeek, p.hiredAt, p.firedAt, until);
      });
      return next;
    });
  }

  function openMenu(target: Target, el: HTMLElement) {
    if (!canEdit) return;
    const rect = el.getBoundingClientRect();
    const up = rect.bottom + 330 > window.innerHeight && rect.top > 330;
    setMenu({ target, x: Math.min(Math.max(8, rect.left), window.innerWidth - 300), y: up ? rect.top : rect.bottom, up });
  }

  function focusCell(r: number, c: number) {
    const el = buttons.current.get(`${r}:${c}`);
    if (el) el.focus();
  }

  /** Клавиатура на клетке: цифры и буквы ставят отметку сразу, стрелки ходят, Enter — меню. */
  function onCellKey(e: KeyboardEvent<HTMLButtonElement>, r: number, c: number) {
    const moves: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      focusCell(Math.max(0, Math.min(people.length - 1, r + dr)), Math.max(0, Math.min(days.length - 1, c + dc)));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (!canEdit || locked(r, c)) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu({ kind: "cell", r, c }, e.currentTarget);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      setRange(r, c, c, "");
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const ch = e.key;
    const now = Date.now();
    const same = typed.current.key === `${r}:${c}` && now - typed.current.at < 900;
    const text = (same ? typed.current.text : "") + ch;
    const v = normalizeCell(text);
    if (v === null) {
      // «Б» потом «С» — это БС; незнакомая буква просто игнорируется.
      const single = normalizeCell(ch);
      if (single === null) return;
      typed.current = { key: `${r}:${c}`, text: ch, at: now };
      e.preventDefault();
      setRange(r, c, c, single);
      return;
    }
    e.preventDefault();
    typed.current = { key: `${r}:${c}`, text, at: now };
    setRange(r, c, c, v);
  }

  async function onSave() {
    setSaving(true);
    setError("");
    try {
      const rows = people.filter((p) => dirtyKeys.includes(p.key)).map((p) => ({ employeeId: p.employeeId, shift: p.shift, cells: cells[p.key] ?? [] }));
      unwrapValue(await save(month, deptId, rows));
      setBase(cells);
      setHistory([]);
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

  const statusTone =
    status === "approved" ? "bg-status-good/10 text-status-good" : status === "submitted" ? "bg-[#fff4d6] text-[#8a5a00]" : status === "returned" ? "bg-[#fde8e8] text-[#a12b2b]" : "bg-surface-sunk text-ink-secondary";

  return (
    <div className="space-y-3">
      {/* Шапка: состояние, итоги, ход табеля */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", statusTone)}>{TIMESHEET_STATUS_LABELS[status]}</span>
          <span className="text-sm text-ink-secondary tabular-nums">
            {people.filter((p) => p.shift === "").length} чел. · <b className="text-ink-primary">{totalHours.toLocaleString("ru-RU")}</b> ч за месяц
          </span>
          {canEdit && (
            <div className="flex items-center gap-1 ml-auto rounded-lg bg-surface-sunk p-0.5 text-xs">
              {(["grid", "person"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className={clsx("rounded-md px-2.5 py-1 font-medium", view === v ? "bg-surface shadow-sm text-ink-primary" : "text-ink-secondary")}>
                  {v === "grid" ? "Сетка" : "По людям"}
                </button>
              ))}
            </div>
          )}
        </div>
        {status === "returned" && comment && <p className="text-sm rounded-lg bg-[#fde8e8] text-[#a12b2b] px-3 py-2">Бухгалтер вернула табель: {comment}</p>}
        {!canEdit && editRefusal && <p className="text-sm text-ink-muted">{editRefusal}</p>}
        {canEdit && missing > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#fff4d6] px-3 py-2 text-sm text-[#8a5a00]">
            <span>
              Пустых рабочих дней до сегодня: <b>{missing}</b>. Если люди работали как обычно —
            </span>
            <button type="button" className="rounded-md bg-white/80 px-2.5 py-1 font-medium hover:bg-white" onClick={fillAll}>
              заполнить всем по графику
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <>
              <button type="button" className="btn !py-1.5 text-sm" onClick={fillAll} title={`Пустые рабочие дни — часами режима (${workWeek === 6 ? "7, в субботу 5" : "8"}); выходные, праздники и заполненное не трогаются`}>
                Всем по графику
              </button>
              <button type="button" className="btn !py-1.5 text-sm" disabled={history.length === 0} onClick={undo} title="Ctrl+Z">
                ↶ Отменить
              </button>
            </>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
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
        </div>
        {returning && (
          <div className="flex flex-wrap gap-2 items-start">
            <textarea className="input flex-1 min-w-[16rem]" rows={2} placeholder="Что исправить — начальник увидит это над табелем" value={returnText} onChange={(e) => setReturnText(e.target.value)} />
            <button type="button" className="btn-primary !py-1.5" disabled={saving} onClick={() => onMove("return", returnText)}>
              Вернуть
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-status-critical">{error}</p>}
      {done && <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>}

      {view === "grid" || !canEdit ? (
        <GridView
          days={days}
          people={people}
          cells={cells}
          summaries={summaries}
          perDay={perDay}
          overtime={overtime}
          today={today}
          canEdit={canEdit}
          locked={locked}
          register={(r, c, el) => (el ? buttons.current.set(`${r}:${c}`, el) : buttons.current.delete(`${r}:${c}`))}
          onCellKey={onCellKey}
          openMenu={openMenu}
          active={menu?.target.kind === "cell" ? [menu.target.r, menu.target.c] : null}
        />
      ) : (
        <PersonView
          days={days}
          people={people}
          cells={cells}
          summaries={summaries}
          overtime={overtime}
          today={today}
          idx={personIdx}
          setIdx={setPersonIdx}
          locked={locked}
          openMenu={openMenu}
        />
      )}

      <Legend dayShiftHours={dayShiftHours} />

      {menu && (
        <CellMenu
          menu={menu}
          days={days}
          people={people}
          cells={cells}
          workWeek={workWeek}
          locked={locked}
          onClose={() => setMenu(null)}
          onCell={(r, c, cEnd, v) => {
            setRange(r, c, cEnd, v);
            setMenu(null);
          }}
          onDay={(c, v) => {
            setDayForAll(c, v);
            setMenu(null);
          }}
          onRow={(r, what) => {
            if (what === "fill") fillRow(r);
            else clearRow(r);
            setMenu(null);
          }}
        />
      )}

      {canEdit && <SaveBar count={dirtyKeys.length} what="строк" saving={saving} onSave={onSave} onReset={() => { setCells(base); setHistory([]); }} />}
    </div>
  );
}

function cellHoursOf(v: string, dayShift: number): number {
  if (v === "Д") return dayShift;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// --- Сетка ------------------------------------------------------------------------

function GridView({
  days,
  people,
  cells,
  summaries,
  perDay,
  overtime,
  today,
  canEdit,
  locked,
  register,
  onCellKey,
  openMenu,
  active,
}: {
  days: DayInfo[];
  people: TimesheetPerson[];
  cells: Cells;
  summaries: Record<string, ReturnType<typeof summarizeRow>>;
  perDay: number[];
  overtime: boolean;
  today: string;
  canEdit: boolean;
  /** Клетка, для которой открыто меню, — [строка, день]. */
  active: [number, number] | null;
  locked: (r: number, c: number) => boolean;
  register: (r: number, c: number, el: HTMLButtonElement | null) => void;
  onCellKey: (e: KeyboardEvent<HTMLButtonElement>, r: number, c: number) => void;
  openMenu: (t: Target, el: HTMLElement) => void;
}) {
  const weekStart = (d: DayInfo) => d.weekday === "пн";
  return (
    <div className="card !p-0 overflow-x-auto">
      <table className="text-sm border-collapse select-none">
        <thead className="sticky top-0 z-20">
          <tr className="text-xs text-ink-muted bg-surface">
            <th className="sticky left-0 z-30 bg-surface text-left font-medium px-3 py-2 min-w-[11rem] border-b border-line-hairline">Сотрудник</th>
            {days.map((d, c) => {
              const isToday = d.date === today;
              const future = d.date > today;
              return (
                <th
                  key={d.date}
                  className={clsx(
                    "p-0 border-b border-line-hairline w-[34px]",
                    weekStart(d) && "border-l-2 border-l-line-strong",
                    d.holiday ? "bg-[#fff1d6]" : d.off ? "bg-surface-sunk" : "bg-surface",
                    future && "opacity-60"
                  )}
                >
                  <button
                    type="button"
                    disabled={!canEdit}
                    title={canEdit ? `${d.day} число: отметить всем сразу` : d.holiday ? "праздник" : d.off ? "выходной" : ""}
                    onClick={(e) => openMenu({ kind: "day", c }, e.currentTarget)}
                    className={clsx("w-[34px] py-1 leading-tight rounded-md", canEdit && "hover:bg-section-payroll/10")}
                  >
                    <div className={clsx("tabular-nums font-semibold", isToday ? "mx-auto w-6 rounded-full bg-section-payroll text-white" : d.holiday ? "text-[#8a5a00]" : "text-ink-secondary")}>{d.day}</div>
                    <div className="text-[10px]">{d.weekday}</div>
                  </button>
                </th>
              );
            })}
            <th className="px-2 border-b border-line-hairline font-medium text-right">Часы</th>
            <th className="px-1.5 border-b border-line-hairline font-medium text-right" title="К норме: меньше — красным, сверх — синим">±</th>
            <th className="px-1.5 border-b border-line-hairline font-medium text-right" title="Часы в праздники (×1,5)">Пр.</th>
            {overtime && <th className="px-1.5 border-b border-line-hairline font-medium text-right" title="Сверхурочные">Св.</th>}
            <th className="px-1.5 border-b border-line-hairline font-medium text-right whitespace-nowrap" title="Отпуск · больничный · командировка · прогул · без содержания, дней">О·Б·К·П·БС</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p, r) => {
            const s = summaries[p.key];
            const row = cells[p.key] ?? [];
            const delta = p.hourly ? 0 : Math.round((s.hours - s.holidayHours - s.normHours) * 100) / 100;
            return (
              <tr key={p.key} className={clsx("border-b border-line-hairline/60", p.shift === "night" && "bg-surface-sunk/40")}>
                <td className="sticky left-0 z-10 bg-surface p-0 min-w-[8.5rem] max-w-[9rem] sm:min-w-[11rem] sm:max-w-[13rem]">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={(e) => openMenu({ kind: "row", r }, e.currentTarget)}
                    className={clsx("w-full text-left px-3 py-1 rounded-md", canEdit && "hover:bg-section-payroll/10")}
                    title={canEdit ? "Строка целиком: по графику, очистить" : ""}
                  >
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        {p.shift === "night" ? (
                          <div className="text-xs text-ink-muted pl-3">ночь</div>
                        ) : (
                          <>
                            <div className="truncate text-xs font-medium leading-tight" title={`${p.fullName}${p.position ? ` — ${p.position}` : ""}`}>
                              {shortName(p.fullName)}
                            </div>
                            <div className="truncate text-[10px] leading-tight text-ink-muted">
                              {p.position}
                              {p.hourly ? " · день" : ""}
                            </div>
                          </>
                        )}
                      </div>
                      {/* Часы видны и без прокрутки к итогам справа. */}
                      <span className="shrink-0 text-xs tabular-nums text-ink-secondary">{s.hours ? `${s.hours.toLocaleString("ru-RU")} ч` : ""}</span>
                    </div>
                  </button>
                </td>
                {days.map((d, c) => {
                  const v = row[c] ?? "";
                  const isLocked = locked(r, c);
                  return (
                    <td
                      key={d.date}
                      className={clsx(
                        "p-0",
                        weekStart(d) && "border-l-2 border-l-line-strong",
                        d.holiday ? "bg-[#fffaf0]" : d.off && "bg-surface-sunk/60",
                        d.date > today && "opacity-60"
                      )}
                    >
                      {isLocked ? (
                        <div className="h-8 w-[34px] flex items-center justify-center text-ink-muted/40" title="не работал в этот день">
                          ·
                        </div>
                      ) : (
                        <button
                          type="button"
                          ref={(el) => register(r, c, el)}
                          disabled={!canEdit}
                          aria-label={`${p.fullName}${p.shift === "night" ? ", ночь" : ""}, ${d.day} число: ${v || "пусто"}`}
                          onClick={(e) => openMenu({ kind: "cell", r, c }, e.currentTarget)}
                          onKeyDown={(e) => onCellKey(e, r, c)}
                          className={clsx(
                            "block mx-auto my-[2px] h-7 w-[30px] rounded-md text-center text-sm font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-section-payroll/70 disabled:cursor-default",
                            v === "" ? "text-ink-muted/30" : cellStyle(v),
                            canEdit && v === "" && "hover:bg-section-payroll/10",
                            // Клетка, для которой открыто меню, помечена рамкой ВНУТРИ своих границ (раньше кольцо вылезало за край и
                            // пряталось под прилипшей колонкой имени — 28.10.2026, владелец: «выделение заходит за край»).
                            active && active[0] === r && active[1] === c && "ring-2 ring-inset ring-section-payroll/70"
                          )}
                        >
                          {v === "" ? (d.off ? "" : "·") : v}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 text-right tabular-nums font-semibold">{s.hours ? s.hours.toLocaleString("ru-RU") : "—"}</td>
                <td className={clsx("px-1.5 text-right tabular-nums text-xs", delta < 0 ? "text-status-critical" : delta > 0 ? "text-[#1f5fa8]" : "text-ink-muted")}>
                  {p.hourly || delta === 0 || s.hours === 0 ? "" : delta > 0 ? `+${delta}` : delta}
                </td>
                <td className="px-1.5 text-right tabular-nums text-xs">{s.holidayHours || ""}</td>
                {overtime && <td className="px-1.5 text-right tabular-nums text-xs">{p.hourly ? "" : s.overtime || ""}</td>}
                <td className="px-1.5 text-right tabular-nums text-xs text-ink-secondary">
                  {[s.vacation, s.sick, s.trip, s.absent, s.unpaid].some(Boolean) ? [s.vacation, s.sick, s.trip, s.absent, s.unpaid].map((n) => n || "–").join("·") : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="text-[11px] text-ink-muted bg-surface-plane">
            <td className="sticky left-0 z-10 bg-surface-plane px-3 py-1.5">Работало, чел.</td>
            {days.map((d, c) => (
              <td key={d.date} className={clsx("text-center tabular-nums py-1.5", weekStart(d) && "border-l-2 border-l-line-strong")}>
                {perDay[c] || ""}
              </td>
            ))}
            <td colSpan={overtime ? 5 : 4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// --- По людям: календарь одного сотрудника ---------------------------------------------------

function PersonView({
  days,
  people,
  cells,
  summaries,
  overtime,
  today,
  idx,
  setIdx,
  locked,
  openMenu,
}: {
  days: DayInfo[];
  people: TimesheetPerson[];
  cells: Cells;
  summaries: Record<string, ReturnType<typeof summarizeRow>>;
  overtime: boolean;
  today: string;
  idx: number;
  setIdx: (i: number) => void;
  locked: (r: number, c: number) => boolean;
  openMenu: (t: Target, el: HTMLElement) => void;
}) {
  // Почасовой — две строки (день и ночь), но человек один: листаем по сотрудникам, смены показываем рядом.
  const persons = people.filter((p) => p.shift === "");
  const cur = persons[Math.min(idx, persons.length - 1)];
  if (!cur) return null;
  const rowsOf = people.map((p, r) => ({ p, r })).filter((x) => x.p.employeeId === cur.employeeId);
  const lead = (["пн", "вт", "ср", "чт", "пт", "сб", "вс"].indexOf(days[0].weekday) + 7) % 7;

  return (
    <div className="space-y-3">
      <div className="card flex items-center gap-2">
        <button type="button" className="btn !py-1.5 !px-3" disabled={idx <= 0} onClick={() => setIdx(idx - 1)}>
          ‹
        </button>
        <select className="input flex-1 min-w-0" value={cur.employeeId} onChange={(e) => setIdx(persons.findIndex((p) => p.employeeId === e.target.value))}>
          {persons.map((p, i) => (
            <option key={p.key} value={p.employeeId}>
              {i + 1}. {p.fullName}
            </option>
          ))}
        </select>
        <button type="button" className="btn !py-1.5 !px-3" disabled={idx >= persons.length - 1} onClick={() => setIdx(idx + 1)}>
          ›
        </button>
      </div>
      {rowsOf.map(({ p, r }) => {
        const s = summaries[p.key];
        const row = cells[p.key] ?? [];
        return (
          <div key={p.key} className="card space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {p.fullName}
                  {p.hourly ? (p.shift === "night" ? " · ночь" : " · день") : ""}
                </div>
                <div className="text-xs text-ink-muted truncate">{p.position}</div>
              </div>
              <button type="button" className="text-xs text-section-payroll shrink-0" onClick={(e) => openMenu({ kind: "row", r }, e.currentTarget)}>
                строка ▾
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-[10px] text-ink-muted text-center">
              {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((w) => (
                <div key={w}>{w}</div>
              ))}
              {Array.from({ length: lead }).map((_, i) => (
                <div key={`b${i}`} />
              ))}
              {days.map((d, c) => {
                const v = row[c] ?? "";
                const isLocked = locked(r, c);
                return (
                  <button
                    key={d.date}
                    type="button"
                    disabled={isLocked}
                    onClick={(e) => openMenu({ kind: "cell", r, c }, e.currentTarget)}
                    className={clsx(
                      "h-12 rounded-lg flex flex-col items-center justify-center leading-none border",
                      d.date === today ? "border-section-payroll" : "border-transparent",
                      isLocked ? "bg-surface-sunk/50 text-ink-muted/40" : v === "" ? (d.holiday ? "bg-[#fff1d6]" : d.off ? "bg-surface-sunk" : "bg-surface-plane") : cellStyle(v),
                      d.date > today && "opacity-60"
                    )}
                  >
                    <span className="text-[10px] text-ink-muted">{d.day}</span>
                    <span className="text-sm font-semibold tabular-nums">{isLocked ? "·" : v || (d.off ? "" : "·")}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary tabular-nums pt-1">
              <span>
                Часы: <b className="text-ink-primary">{s.hours.toLocaleString("ru-RU")}</b>
                {!p.hourly && s.normHours > 0 && <span className="text-ink-muted"> / норма {s.normHours}</span>}
              </span>
              {s.holidayHours > 0 && <span>праздничных {s.holidayHours}</span>}
              {overtime && !p.hourly && s.overtime > 0 && <span>сверх {s.overtime}</span>}
              {s.vacation > 0 && <span>отпуск {s.vacation}</span>}
              {s.sick > 0 && <span>больничный {s.sick}</span>}
              {s.trip > 0 && <span>командировка {s.trip}</span>}
              {s.absent > 0 && <span className="text-status-critical">прогул {s.absent}</span>}
              {s.unpaid > 0 && <span>без содержания {s.unpaid}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Меню отметки -------------------------------------------------------------------------
//
// 29.10.2026, владелец со снимком меню клетки: «сделай это окошко удобнее и красивее», а на первую переделку (крупные
// плитки с подписями, три раздела с заголовками, окно в полэкрана) — «ещё хуже стало; компактно, удобно и красиво».
// Поэтому окно маленькое (18 rem): часы одной строкой, коды — восемь плиток «буква + слово» в два ряда (легенда не
// нужна), период — четыре кнопки одной строкой, «стереть» — внизу. Без заголовков разделов и без лишнего текста.

const CODE_LABEL: Record<string, string> = {
  "О": "Отпуск",
  "Б": "Больничный",
  "К": "Командир.",
  "П": "Прогул",
  "БС": "Без содерж.",
  "В": "Выходной",
  "Д": "Дн. смена",
  "У": "Уволен",
};

function CellMenu({
  menu,
  days,
  people,
  cells,
  workWeek,
  locked,
  onClose,
  onCell,
  onDay,
  onRow,
}: {
  menu: Menu;
  days: DayInfo[];
  people: TimesheetPerson[];
  cells: Cells;
  workWeek: 5 | 6;
  locked: (r: number, c: number) => boolean;
  onClose: () => void;
  onCell: (r: number, c: number, cEnd: number, v: string) => void;
  onDay: (c: number, v: string | "schedule") => void;
  onRow: (r: number, what: "fill" | "clear") => void;
}) {
  const t = menu.target;
  const [endC, setEndC] = useState(t.kind === "cell" ? t.c : 0);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // На телефоне — лист снизу во всю ширину: палец попадает, календарь сверху виден.
  // На компьютере окно не уходит за край: не дальше правого края, ниже клетки, а не влезает — выше или к низу.
  const sheet = typeof window !== "undefined" && window.innerWidth < 640;
  const MENU_W = 288;
  const MENU_H = 300;
  const style = sheet
    ? { left: 0, right: 0, bottom: 0 }
    : (() => {
        const left = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_W - 8));
        if (menu.up) return { left, bottom: Math.max(8, window.innerHeight - menu.y + 4) };
        const top = menu.y + 4 + MENU_H > window.innerHeight ? Math.max(8, window.innerHeight - MENU_H - 8) : menu.y + 4;
        return { left, top };
      })();

  const chipBase = "rounded-lg font-semibold transition active:scale-95 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-section-payroll/60";
  const hourChip = (h: number, isNorm: boolean, onClick: () => void, title: string) => (
    <button key={h} type="button" title={title} onClick={onClick} className={clsx(chipBase, "h-9 flex-1 min-w-[2.5rem] text-sm leading-none flex flex-col items-center justify-center gap-0.5", hoursStyle(h))}>
      <span>{h}</span>
      {isNorm && <span className="text-[8px] font-normal opacity-75 leading-none">норма</span>}
    </button>
  );
  const codeChip = (code: string, onClick: () => void) => (
    <button
      key={code}
      type="button"
      title={CODE_HINT[code]}
      onClick={onClick}
      className={clsx(chipBase, "h-9 flex flex-col items-center justify-center leading-none", CODE_STYLE[code], code === "В" && "bg-surface-sunk ring-1 ring-inset ring-line-hairline")}
    >
      <span className="text-[13px]">{code}</span>
      <span className="text-[9px] font-normal opacity-80 mt-0.5 whitespace-nowrap">{CODE_LABEL[code]}</span>
    </button>
  );
  const eraseBtn = (label: string, onClick: () => void, disabled = false) => (
    <button type="button" disabled={disabled} onClick={onClick} className="text-xs text-status-critical hover:underline disabled:opacity-40 disabled:no-underline whitespace-nowrap">
      {label}
    </button>
  );

  let title: React.ReactNode;
  let subtitle: React.ReactNode;
  let body: React.ReactNode;

  if (t.kind === "cell") {
    const p = people[t.r];
    const d = days[t.c];
    const current = cells[p.key]?.[t.c] ?? "";
    const sched = scheduleHours(d.date, workWeek);
    const hours = Array.from(new Set([sched, 8, 12, 24].filter((h) => h > 0))).sort((a, b) => a - b);
    const apply = (v: string) => onCell(t.r, t.c, endC, v);
    const dayLabel = (c: number) => `${days[c].day} ${days[c].weekday}`;
    let weekEnd = t.c;
    while (weekEnd + 1 < days.length && days[weekEnd].weekday.toLowerCase() !== "вс") weekEnd++;
    const monthEnd = days.length - 1;
    const periodBtn = (label: string, c: number, hint: string) => (
      <button
        key={label}
        type="button"
        title={hint}
        onClick={() => setEndC(c)}
        className={clsx("h-7 px-1.5 rounded-md text-[11px] font-medium whitespace-nowrap", endC === c ? "bg-ink-primary text-white" : "bg-surface-sunk text-ink-secondary hover:bg-surface-plane")}
      >
        {label}
      </button>
    );
    const customSelected = endC !== t.c && endC !== weekEnd && endC !== monthEnd;
    title = (
      <>
        {shortName(p.fullName)}
        {p.shift === "night" ? <span className="font-normal text-ink-muted"> · ночь</span> : null}
      </>
    );
    subtitle = (
      <>
        {d.day} {d.weekday}
        {d.holiday ? " · праздник" : d.off ? " · выходной" : ""}
        {current ? (
          <>
            {" · "}
            <span className={clsx("inline-block rounded px-1 text-[10px] font-semibold", cellStyle(current))}>{CODE_LABEL[current] ? `${current} · ${CODE_LABEL[current]}` : `${current} ч`}</span>
          </>
        ) : null}
      </>
    );
    body = (
      <>
        <div className="flex gap-1.5">
          {hours.map((h) => hourChip(h, h === sched && !d.off, () => apply(String(h)), h === sched && !d.off ? `${h} ч — норма дня по графику` : `${h} ч`))}
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const v = normalizeCell(custom);
              if (v !== null && v !== "") apply(v);
            }}
          >
            <input
              className="input !h-9 !py-0 !px-1 w-[3.2rem] text-center !text-sm !rounded-lg"
              inputMode="decimal"
              placeholder="своё"
              aria-label="Своё число часов"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            {custom.trim() && (
              <button type="submit" className="h-9 w-9 rounded-lg bg-ink-primary text-white text-sm font-semibold" aria-label="Поставить">
                ✓
              </button>
            )}
          </form>
        </div>

        <div className="grid grid-cols-4 gap-1.5">{CODES_ORDER.map((code) => codeChip(code, () => apply(code)))}</div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] text-ink-muted mr-0.5">на</span>
          {periodBtn("день", t.c, "Только этот день")}
          {weekEnd > t.c && periodBtn("неделя", weekEnd, `До конца недели — по ${dayLabel(weekEnd)}`)}
          {monthEnd > t.c && periodBtn("месяц", monthEnd, `До конца месяца — по ${dayLabel(monthEnd)}`)}
          {monthEnd > t.c && (
            <label className={clsx("h-7 flex items-center gap-0.5 rounded-md pl-1.5 pr-0.5 text-[11px] font-medium cursor-pointer", customSelected ? "bg-ink-primary text-white" : "bg-surface-sunk text-ink-secondary")}>
              по
              <select className="bg-transparent text-[11px] font-medium outline-none cursor-pointer max-w-[4.5rem]" value={endC} onChange={(e) => setEndC(Number(e.target.value))} aria-label="По какое число">
                {days.map((dd, c) => (
                  <option key={dd.date} value={c} disabled={c < t.c} className="text-ink-primary">
                    {dd.day} {dd.weekday}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line-hairline pt-2">
          {eraseBtn("Стереть", () => apply(""), !current && endC === t.c)}
          <span className="text-[10px] text-ink-muted text-right">{endC > t.c ? `${endC - t.c + 1} дн.: ${dayLabel(t.c)} — ${dayLabel(endC)}, часы — в рабочие` : ""}</span>
        </div>
      </>
    );
  } else if (t.kind === "day") {
    const d = days[t.c];
    const working = people.filter((_, r) => !locked(r, t.c)).length;
    const sched = scheduleHours(d.date, workWeek);
    title = (
      <>
        {d.day} {d.weekday}
        {d.holiday ? <span className="font-normal text-[#8a5a00]"> · праздник</span> : d.off ? <span className="font-normal text-ink-muted"> · выходной</span> : null}
      </>
    );
    subtitle = <>всем сразу — {working} чел.</>;
    body = (
      <>
        <div className="flex gap-1.5">
          {sched > 0 && (
            <button type="button" title={`${sched} ч каждому (кроме почасовых)`} onClick={() => onDay(t.c, "schedule")} className={clsx(chipBase, "h-9 flex-1 text-sm leading-none flex flex-col items-center justify-center gap-0.5 bg-[#e3f3e8] text-[#1e5a38] ring-1 ring-inset ring-[#b5dcc1]")}>
              <span>{sched}</span>
              <span className="text-[8px] font-normal opacity-75 leading-none">по графику</span>
            </button>
          )}
          {[8, 12, 24].filter((h) => h !== sched).map((h) => hourChip(h, false, () => onDay(t.c, String(h)), `${h} ч всем`))}
          {codeChip("В", () => onDay(t.c, "В"))}
        </div>
        <div className="border-t border-line-hairline pt-2">{eraseBtn("Стереть день у всех", () => onDay(t.c, ""))}</div>
      </>
    );
  } else {
    const p = people[t.r];
    title = (
      <>
        {shortName(p.fullName)}
        {p.shift === "night" ? <span className="font-normal text-ink-muted"> · ночь</span> : null}
      </>
    );
    subtitle = <>вся строка за месяц</>;
    body = (
      <>
        {!p.hourly && (
          <button type="button" title="Пустые рабочие дни до сегодня — часами режима" onClick={() => onRow(t.r, "fill")} className={clsx(chipBase, "h-9 w-full text-sm bg-[#e3f3e8] text-[#1e5a38] ring-1 ring-inset ring-[#b5dcc1]")}>
            Заполнить по графику
          </button>
        )}
        <div className="border-t border-line-hairline pt-2">{eraseBtn("Очистить строку", () => onRow(t.r, "clear"))}</div>
      </>
    );
  }

  return (
    <div
      ref={ref}
      style={style}
      className={clsx(
        "fixed z-50 border border-line-hairline bg-surface shadow-card-hover space-y-2",
        sheet ? "rounded-t-2xl p-3 pb-5 max-h-[85vh] overflow-y-auto" : "w-[18rem] max-h-[calc(100vh-1rem)] overflow-y-auto rounded-xl p-3"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-display font-bold text-[13.5px] truncate">{title}</div>
          <div className="text-[11px] text-ink-secondary mt-0.5">{subtitle}</div>
        </div>
        <button type="button" className="-mr-1.5 -mt-1.5 h-6 w-6 rounded-full text-ink-muted hover:bg-surface-sunk text-base leading-none" onClick={onClose} aria-label="закрыть">
          ×
        </button>
      </div>
      {body}
    </div>
  );
}

function Legend({ dayShiftHours }: { dayShiftHours: number }) {
  return (
    <p className="text-xs text-ink-muted">
      Нажмите на клетку — откроется выбор отметки; на число в шапке — отметка всем в этот день; на имя — строка целиком. С клавиатуры: стрелки,
      цифры и буквы ({Object.keys(TIMESHEET_CODES).join(", ")}), Backspace, Ctrl+Z. «Д» = норма дня, сейчас {dayShiftHours.toLocaleString("ru-RU")} ч.
    </p>
  );
}
