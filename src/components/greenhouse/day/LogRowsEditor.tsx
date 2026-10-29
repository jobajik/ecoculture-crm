"use client";

import { useMemo, useRef } from "react";
import clsx from "clsx";
import { nextGrade } from "@/lib/greenhouse/day";
import { cleanLogRow, type LogKind } from "@/lib/greenhouse/production";
import { GRADE_COLORS } from "@/lib/greenhouse/views";

/**
 * Строки одного журнала (срезка, брак или черенкование) одного блока за день — внутри «Внести день». Управляемый:
 * строки живут у `DayBoard`. Ради скорости: сорта блока — кнопками «+ Altaj» (строка с этим сортом и первой ещё не
 * записанной категорией), новая строка берёт сорт у предыдущей и следующую категорию, Enter в штуках ведёт дальше.
 */

export interface LogRow {
  uid: number;
  id: string;
  cycle: string;
  block: string;
  variety: string;
  kind: string;
  qty: string;
  weightKg: string;
  part: string;
  line: string;
  note: string;
}

let uidSeq = 1;
export function logUid(): number {
  return uidSeq++;
}

/**
 * Пустая строка — не сохраняется и не мешает сохранить день. Новая строка без штук пустая, даже если сорт и категория
 * подставились сами («+ Altaj» нажали и не заполнили). Записанная строка пустая, только если стёрли и сорт, и штуки.
 */
export function isEmptyLog(r: LogRow): boolean {
  if (!r.qty.trim()) return !r.id || !r.variety.trim();
  return false;
}

export function logProblem(log: LogKind, r: LogRow, date: string, today: string, known: string[]): string {
  if (isEmptyLog(r)) return "";
  return cleanLogRow(log, { id: r.id, date, cycle: r.cycle, block: r.block, variety: r.variety, kind: r.kind, qty: r.qty, weightKg: r.weightKg, part: r.part, line: r.line, note: r.note }, today, known).error;
}

const KIND_TITLE: Record<LogKind, string> = { harvest: "Категория", waste: "Причина", cuttings: "Что записываем" };
const n0 = (n: number) => Math.round(n).toLocaleString("ru-RU");

export default function LogRowsEditor({
  log,
  rows,
  setRows,
  block,
  cycle,
  blockVarieties,
  varieties,
  kinds,
  date,
  today,
  canEdit,
}: {
  log: LogKind;
  /** Строки этого журнала и этого блока. */
  rows: LogRow[];
  /** Изменить строки этого блока (остальные блоки `DayBoard` не трогает). */
  setRows: (fn: (rows: LogRow[]) => LogRow[]) => void;
  block: string;
  cycle: string;
  blockVarieties: string[];
  varieties: string[];
  kinds: { code: string; label: string }[];
  date: string;
  today: string;
  canEdit: boolean;
}) {
  const qtyRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const others = useMemo(() => varieties.filter((v) => !blockVarieties.includes(v)), [varieties, blockVarieties]);
  const kindLabel = (code: string) => kinds.find((k) => k.code === code)?.label ?? code;

  const blank = (patch: Partial<LogRow> = {}): LogRow => ({ uid: logUid(), id: "", cycle, block, variety: "", kind: "", qty: "", weightKg: "", part: "", line: "", note: "", ...patch });

  const usedGrades = (variety: string, list: LogRow[]) => list.filter((r) => r.variety === variety).map((r) => r.kind);

  const addFor = (variety: string) =>
    setRows((rs) => [...rs, blank({ variety, kind: log === "harvest" ? nextGrade("", usedGrades(variety, rs)) : "" })]);

  const addAfter = (prev?: LogRow) =>
    setRows((rs) => {
      const last = prev ?? rs[rs.length - 1];
      if (!last) return [...rs, blank({ variety: blockVarieties.length === 1 ? blockVarieties[0] : "" })];
      const kind = log === "harvest" ? nextGrade(last.kind, usedGrades(last.variety, rs)) : last.kind;
      return [...rs, blank({ variety: last.variety, kind, part: last.part, line: last.line })];
    });

  const update = (uid: number, patch: Partial<LogRow>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const remove = (uid: number) => setRows((rs) => rs.filter((r) => r.uid !== uid));

  const focusQty = (uid: number | undefined) => {
    if (uid === undefined) return;
    const el = qtyRefs.current.get(uid);
    el?.focus();
    el?.select();
  };

  const pickVariety = (uid: number, value: string) => {
    if (value === "__new") {
      const name = window.prompt("Название сорта (латиницей, как на коробке):", "");
      if (name && name.trim()) update(uid, { variety: name.trim() });
      return;
    }
    update(uid, { variety: value });
  };

  const totals = useMemo(() => {
    let qty = 0;
    let kg = 0;
    let kgQty = 0;
    let top = 0;
    for (const r of rows) {
      const q = Number(r.qty.replace(/\s/g, "").replace(",", ".")) || 0;
      const w = Number(r.weightKg.replace(/\s/g, "").replace(",", ".")) || 0;
      qty += q;
      if (w > 0 && q > 0) {
        kg += w;
        kgQty += q;
      }
      if (r.kind === "Высшая" || r.kind === "Первая") top += q;
    }
    return { qty, avgG: kgQty ? (kg * 1000) / kgQty : null, topPct: qty ? (top * 100) / qty : null };
  }, [rows]);

  // На компьютере — строка таблицы; на телефоне — две строки: сорт, ниже категория · штуки · вес · ✕.
  const grid =
    log === "harvest"
      ? "sm:grid-cols-[minmax(9rem,1.3fr)_minmax(8rem,1fr)_6rem_6rem_3.5rem_2.25rem]"
      : log === "cuttings"
        ? "sm:grid-cols-[minmax(9rem,1.3fr)_minmax(10rem,1.2fr)_6.5rem_4.5rem_4.5rem_2.25rem]"
        : "sm:grid-cols-[minmax(9rem,1.3fr)_minmax(9rem,1fr)_6.5rem_minmax(7rem,1fr)_2.25rem]";
  const mobileGrid = log === "harvest" ? "grid-cols-[minmax(0,1fr)_4.75rem_4.25rem_2.25rem]" : "grid-cols-[minmax(0,1fr)_5.5rem_2.25rem]";
  const fullRow = log === "harvest" ? "col-span-4" : "col-span-3";

  return (
    <div>
      {/* Сорта блока — одной кнопкой строка */}
      {canEdit && blockVarieties.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-4 pt-3">
          <span className="text-xs text-ink-muted mr-1">Сорта блока:</span>
          {blockVarieties.map((v) => {
            const n = rows.filter((r) => r.variety === v).length;
            return (
              <button
                key={v}
                type="button"
                onClick={() => addFor(v)}
                className={clsx("h-8 px-3 rounded-full text-sm border inline-flex items-center gap-1.5", n ? "border-section-greenhouse/40 bg-section-greenhouse-soft text-section-greenhouse" : "border-line-hairline bg-surface hover:bg-surface-plane")}
              >
                <span className="text-base leading-none">+</span>
                {v}
                {n > 0 && <span className="text-[11px] tabular-nums opacity-70">{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className={clsx("hidden sm:grid gap-2 px-4 pt-3 pb-1.5 text-xs text-ink-muted", grid)}>
        <div>Сорт</div>
        <div>{KIND_TITLE[log]}</div>
        <div className="text-right">Штук</div>
        {log === "harvest" && (
          <>
            <div className="text-right">Вес, кг</div>
            <div className="text-right">г/шт</div>
          </>
        )}
        {log === "cuttings" && (
          <>
            <div>Секция</div>
            <div>Линия</div>
          </>
        )}
        {log === "waste" && <div>Заметка</div>}
        <div />
      </div>

      {rows.length === 0 && (
        <div className="px-4 py-5 text-sm text-ink-secondary">
          {canEdit ? (blockVarieties.length ? "Нажмите сорт выше или добавьте строку." : "Добавьте строку.") : "Записей нет."}
        </div>
      )}

      <div className="divide-y divide-line-hairline/60">
        {rows.map((r, i) => {
          const problem = canEdit ? logProblem(log, r, date, today, varieties) : "";
          const q = Number(r.qty.replace(/\s/g, "").replace(",", ".")) || 0;
          const w = Number(r.weightKg.replace(/\s/g, "").replace(",", ".")) || 0;
          const gPerStem = q > 0 && w > 0 ? Math.round((w * 1000) / q) : null;
          const inList = !r.variety || blockVarieties.includes(r.variety) || others.includes(r.variety);
          return (
            <div key={r.uid} className={clsx("px-3 sm:px-4 py-2.5 sm:py-1.5", problem && "bg-[#fff4f4]")}>
              <div className={clsx("grid gap-2 items-center", mobileGrid, grid)}>
                <select className={clsx("input !py-1.5 sm:col-span-1", fullRow)} value={r.variety} disabled={!canEdit} onChange={(e) => pickVariety(r.uid, e.target.value)}>
                  <option value="">— сорт —</option>
                  {!inList && <option value={r.variety}>{r.variety}</option>}
                  {blockVarieties.length > 0 && (
                    <optgroup label="Сорта блока">
                      {blockVarieties.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={blockVarieties.length ? "Другие сорта" : "Сорта"}>
                    {others.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </optgroup>
                  <option value="__new">＋ новый сорт…</option>
                </select>
                <div className="flex items-center gap-1.5 min-w-0">
                  {log === "harvest" && <span className="w-2.5 h-2.5 rounded-sm flex-none" style={{ background: GRADE_COLORS[r.kind] ?? "transparent" }} />}
                  <select className="input !py-1.5 min-w-0" value={r.kind} disabled={!canEdit} onChange={(e) => update(r.uid, { kind: e.target.value })}>
                    <option value="">{KIND_TITLE[log]}…</option>
                    {kinds.map((k) => (
                      <option key={k.code} value={k.code}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  ref={(el) => {
                    if (el) qtyRefs.current.set(r.uid, el);
                    else qtyRefs.current.delete(r.uid);
                  }}
                  className="input !py-1.5 text-right tabular-nums font-medium"
                  inputMode="numeric"
                  placeholder="шт"
                  aria-label="Штук"
                  value={r.qty}
                  disabled={!canEdit}
                  onChange={(e) => update(r.uid, { qty: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (i === rows.length - 1) {
                      addAfter(r);
                      setTimeout(() => focusQty(Array.from(qtyRefs.current.keys()).pop()), 0);
                    } else focusQty(rows[i + 1]?.uid);
                  }}
                />
                {log === "harvest" && (
                  <>
                    <input className="input !py-1.5 text-right tabular-nums" inputMode="decimal" placeholder="кг" aria-label="Вес, кг" value={r.weightKg} disabled={!canEdit} onChange={(e) => update(r.uid, { weightKg: e.target.value })} />
                    <div className={clsx("hidden sm:block text-right text-xs tabular-nums", gPerStem !== null && (gPerStem < 10 || gPerStem > 400) ? "text-[#a12b2b]" : "text-ink-muted")} title={gPerStem !== null && (gPerStem < 10 || gPerStem > 400) ? "Похоже на опечатку в весе" : ""}>
                      {gPerStem ?? "—"}
                    </div>
                  </>
                )}
                {log === "cuttings" && (
                  <>
                    <input className="input !py-1.5 order-last sm:order-none" placeholder="Секция" value={r.part} disabled={!canEdit} onChange={(e) => update(r.uid, { part: e.target.value })} />
                    <input className="input !py-1.5 order-last sm:order-none col-span-2 sm:col-span-1" placeholder="Линия" value={r.line} disabled={!canEdit} onChange={(e) => update(r.uid, { line: e.target.value })} />
                  </>
                )}
                {log === "waste" && <input className="input !py-1.5 col-span-3 sm:col-span-1 order-last sm:order-none" placeholder="Заметка" value={r.note} disabled={!canEdit} onChange={(e) => update(r.uid, { note: e.target.value })} />}
                <div className="flex justify-end">
                  {canEdit && (
                    <button type="button" className="h-9 w-9 sm:h-8 sm:w-8 rounded-lg text-ink-muted hover:bg-[#fde8e8] hover:text-[#a12b2b]" title="Убрать строку" onClick={() => remove(r.uid)}>
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

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 sm:px-4 py-3 border-t border-line-hairline">
        {canEdit && (
          <button type="button" className="btn-secondary !py-1.5" onClick={() => addAfter()}>
            + Строка
          </button>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm ml-auto text-ink-secondary">
          <span>
            Блок: <b className="text-ink-primary tabular-nums">{n0(totals.qty)}</b> шт.
          </span>
          {log === "harvest" && totals.topPct !== null && (
            <span>
              высшая и 1-я <b className="text-ink-primary tabular-nums">{Math.round(totals.topPct)} %</b>
            </span>
          )}
          {log === "harvest" && totals.avgG !== null && (
            <span>
              вес <b className="text-ink-primary tabular-nums">{Math.round(totals.avgG)} г</b>
            </span>
          )}
          {log !== "harvest" &&
            Array.from(new Set(rows.map((r) => r.kind).filter(Boolean)))
              .slice(0, 4)
              .map((k) => (
                <span key={k}>
                  {kindLabel(k)}{" "}
                  <b className="text-ink-primary tabular-nums">{n0(rows.filter((r) => r.kind === k).reduce((s, r) => s + (Number(r.qty.replace(/\s/g, "")) || 0), 0))}</b>
                </span>
              ))}
        </div>
      </div>
    </div>
  );
}
