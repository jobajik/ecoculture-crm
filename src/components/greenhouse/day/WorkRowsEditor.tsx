"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { formatDay } from "@/lib/formatDate";
import { PARTS, WORK_TYPES, cleanWorkRow, workType, type WorkArea, type WorkRowDraft } from "@/lib/payroll/work";
import type { WorkPerson } from "@/lib/payroll/workData";

/**
 * Выработка участка за день — сетка «сотрудник · блок · вид работ · штуки · часы» внутри «Внести день». Управляемая:
 * строки живут у `DayBoard`, сохраняются вместе со срезкой и браком одной кнопкой. Удобства те же, что были у отдельной
 * страницы выработки: «повторить состав» прошлого дня, недавние сотрудники первыми, новая строка берёт блок и вид у
 * предыдущей, Enter в штуках — к следующей строке, вид «по часам» прячет штуки.
 */

export type WorkRow = WorkRowDraft & { uid: number; name?: string };

/** Значение списка у строки старого учёта без карточки. */
const LEGACY = "__legacy";

let uidSeq = 1;
export function workUid(): number {
  return uidSeq++;
}

export function workProblems(area: WorkArea, rows: WorkRow[]): Map<number, string> {
  const out = new Map<number, string>();
  const seen = new Map<string, number>();
  rows.forEach((r) => {
    if (isEmptyWork(r)) return;
    const { row, error } = cleanWorkRow(area, r);
    if (!row) {
      out.set(r.uid, error);
      return;
    }
    const key = `${row.employeeId || row.name}|${row.block}|${row.part}|${row.workType}`;
    if (seen.has(key)) out.set(r.uid, "такая строка уже есть выше — сложите в одну");
    else seen.set(key, r.uid);
  });
  return out;
}

export function isEmptyWork(r: WorkRow): boolean {
  return !r.employeeId && !(r.workId && r.name) && !String(r.qty).trim() && !String(r.hours).trim();
}

export default function WorkRowsEditor({
  area,
  rows,
  setRows,
  people,
  recent,
  crew,
  blocks,
  defaultBlock,
  canEdit,
}: {
  area: WorkArea;
  rows: WorkRow[];
  setRows: (fn: (rows: WorkRow[]) => WorkRow[]) => void;
  people: WorkPerson[];
  recent: string[];
  crew: { date: string; rows: { employeeId: string; block: string; part: string; workType: string }[] } | null;
  blocks: string[];
  defaultBlock: string;
  canEdit: boolean;
}) {
  const types = WORK_TYPES[area];
  const mainType = types.find((t) => t.main) ?? types[0];
  const [fillBlock, setFillBlock] = useState("");
  const [fillType, setFillType] = useState("");
  const qtyRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const personById = useMemo(() => new Map(people.map((p) => [p.employeeId, p])), [people]);
  const recentSet = useMemo(() => new Set(recent), [recent]);
  const recentPeople = useMemo(() => recent.map((id) => personById.get(id)).filter((p): p is WorkPerson => !!p), [recent, personById]);
  const otherPeople = useMemo(() => people.filter((p) => !recentSet.has(p.employeeId)), [people, recentSet]);
  const problems = useMemo(() => workProblems(area, rows), [area, rows]);

  const update = (uid: number, patch: Partial<WorkRow>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const remove = (uid: number) => setRows((rs) => rs.filter((r) => r.uid !== uid));

  const addRow = (from?: WorkRow) => {
    const last = from ?? rows[rows.length - 1];
    const row: WorkRow = {
      uid: workUid(),
      workId: "",
      employeeId: "",
      block: last?.block ?? (area === "pack" ? "" : defaultBlock),
      part: last?.part ?? (area === "prep" ? "1" : ""),
      workType: last?.workType ?? mainType.code,
      qty: area === "prep" ? 1 : "",
      hours: "",
      note: "",
    };
    setRows((rs) => [...rs, row]);
  };

  const repeatCrew = () => {
    if (!crew) return;
    setRows((rs) => {
      const have = new Set(rs.map((r) => `${r.employeeId}|${r.block}|${r.part}|${r.workType}`));
      const add: WorkRow[] = crew.rows
        .filter((c) => personById.has(c.employeeId) && !have.has(`${c.employeeId}|${c.block}|${c.part}|${c.workType}`))
        .map((c) => ({ uid: workUid(), workId: "", employeeId: c.employeeId, block: c.block, part: c.part, workType: c.workType, qty: area === "prep" ? 1 : "", hours: "", note: "" }));
      return [...rs, ...add];
    });
  };

  const focusQty = (index: number) => {
    const row = rows[index];
    if (!row) return;
    const el = qtyRefs.current.get(row.uid);
    el?.focus();
    el?.select();
  };

  const listId = `work-blocks-${area}`;
  const grid = "sm:grid-cols-[minmax(13rem,2fr)_6.5rem_minmax(9rem,1.3fr)_6rem_5rem_2.25rem]";

  return (
    <div>
      <div className={clsx("hidden sm:grid gap-2 px-4 py-2 text-xs text-ink-muted border-b border-line-hairline", grid)}>
        <div>Сотрудник</div>
        <div>{area === "prep" ? "Блок · секция" : "Блок"}</div>
        <div>Вид работ</div>
        <div className="text-right">{area === "prep" ? "Блок-секц." : "Штук"}</div>
        <div className="text-right">Часов</div>
        <div />
      </div>
      {rows.length === 0 && (
        <div className="px-4 py-6 text-sm text-ink-secondary">
          Записей нет.
          {canEdit && crew && (
            <>
              {" "}
              <button type="button" className="underline font-medium text-ink-primary" onClick={repeatCrew}>
                Повторить состав от {formatDay(crew.date)}
              </button>{" "}
              — та же бригада с блоками и видами работ, останется вписать штуки.
            </>
          )}
        </div>
      )}
      <div className="divide-y divide-line-hairline/60">
        {rows.map((r, i) => {
          const t = workType(area, r.workType);
          const hoursOnly = t?.basis === "hours";
          const problem = problems.get(r.uid);
          const person = personById.get(r.employeeId);
          return (
            <div key={r.uid} className={clsx("px-3 sm:px-4 py-2.5 sm:py-1.5", problem && "bg-[#fff4f4]")}>
              <div className={clsx("grid grid-cols-2 gap-2 items-center", grid)}>
                <div className="col-span-2 sm:col-span-1 flex items-center gap-1.5">
                  <select
                    className="input !py-1.5"
                    value={r.employeeId || (r.workId && r.name ? LEGACY : "")}
                    disabled={!canEdit}
                    onChange={(e) => update(r.uid, { employeeId: e.target.value === LEGACY ? "" : e.target.value })}
                  >
                    <option value="">— сотрудник —</option>
                    {!r.employeeId && r.workId && r.name && <option value={LEGACY}>{r.name} · без карточки</option>}
                    {r.employeeId && !person && <option value={r.employeeId}>{r.name || r.employeeId} (не в штате)</option>}
                    {recentPeople.length > 0 && (
                      <optgroup label="Работали здесь недавно">
                        {recentPeople.map((p) => (
                          <option key={p.employeeId} value={p.employeeId}>
                            {p.fullName}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={recentPeople.length ? "Остальные" : "Сотрудники"}>
                      {otherPeople.map((p) => (
                        <option key={p.employeeId} value={p.employeeId}>
                          {p.fullName} · {p.deptName}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {canEdit && (
                    <button type="button" className="sm:hidden h-9 w-9 shrink-0 rounded-lg text-ink-muted hover:bg-[#fde8e8] hover:text-[#a12b2b]" title="Убрать строку" onClick={() => remove(r.uid)}>
                      ✕
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <input list={listId} className="input !py-1.5 min-w-0" placeholder="Блок" value={r.block} disabled={!canEdit} onChange={(e) => update(r.uid, { block: e.target.value })} />
                  {area === "prep" && (
                    <select className="input !py-1.5 !w-[4.4rem] shrink-0" value={r.part} disabled={!canEdit} onChange={(e) => update(r.uid, { part: e.target.value })}>
                      {PARTS.map((p) => (
                        <option key={p} value={p}>
                          {p} с.
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <select className="input !py-1.5" value={r.workType} disabled={!canEdit} onChange={(e) => update(r.uid, { workType: e.target.value })}>
                  {types.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 sm:block">
                  <span className="sm:hidden text-xs text-ink-muted w-12">{area === "prep" ? "Секц." : "Шт"}</span>
                  <input
                    ref={(el) => {
                      if (el) qtyRefs.current.set(r.uid, el);
                      else qtyRefs.current.delete(r.uid);
                    }}
                    type="text"
                    inputMode="decimal"
                    className={clsx("input !py-1.5 text-right tabular-nums", hoursOnly && "opacity-40")}
                    placeholder={hoursOnly ? "—" : "0"}
                    value={hoursOnly ? "" : r.qty}
                    disabled={!canEdit || hoursOnly}
                    title={hoursOnly ? `«${t?.label}» считается по часам` : ""}
                    onChange={(e) => update(r.uid, { qty: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (i === rows.length - 1) {
                        addRow(r);
                        setTimeout(() => focusQty(i + 1), 0);
                      } else focusQty(i + 1);
                    }}
                  />
                </label>
                <label className="flex items-center gap-1 sm:block">
                  <span className="sm:hidden text-xs text-ink-muted w-12">Часов</span>
                  <input type="text" inputMode="decimal" className="input !py-1.5 text-right tabular-nums" placeholder="0" value={r.hours} disabled={!canEdit} onChange={(e) => update(r.uid, { hours: e.target.value })} />
                </label>
                <div className="hidden sm:flex justify-end">
                  {canEdit && (
                    <button type="button" className="h-8 w-8 rounded-lg text-ink-muted hover:bg-[#fde8e8] hover:text-[#a12b2b]" title="Убрать строку" onClick={() => remove(r.uid)}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
              {problem && <div className="text-xs text-[#a12b2b] mt-1">{problem}</div>}
            </div>
          );
        })}
      </div>
      <datalist id={listId}>
        {blocks.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-t border-line-hairline">
          <button type="button" className="btn-secondary !py-1.5" onClick={() => addRow()}>
            + Сотрудник
          </button>
          {crew && rows.length > 0 && (
            <button type="button" className="btn-secondary !py-1.5" onClick={repeatCrew}>
              Повторить состав от {formatDay(crew.date)}
            </button>
          )}
          {rows.length > 1 && (
            <div className="hidden sm:flex items-center gap-1.5 text-sm ml-auto">
              <span className="text-ink-muted text-xs">Всем:</span>
              <input list={listId} className="input !py-1 !w-20 text-sm" placeholder="блок" value={fillBlock} onChange={(e) => setFillBlock(e.target.value)} />
              <select className="input !py-1 !w-auto text-sm" value={fillType} onChange={(e) => setFillType(e.target.value)}>
                <option value="">вид работ</option>
                {types.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary !py-1 text-sm"
                disabled={!fillBlock && !fillType}
                onClick={() => setRows((rs) => rs.map((r) => ({ ...r, block: fillBlock || r.block, workType: fillType || r.workType })))}
              >
                Применить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
