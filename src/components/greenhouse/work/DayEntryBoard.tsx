"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { unwrapValue } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";
import { decimal } from "@/lib/formatNumber";
import { ghHref } from "@/lib/greenhouse/farm";
import { PARTS, WORK_AREAS, WORK_TYPES, cleanWorkRow, shiftDay, workType, type WorkArea, type WorkRowDraft } from "@/lib/payroll/work";
import type { WorkPerson } from "@/lib/payroll/workData";

/**
 * Сетка ввода выработки за день (29.10.2026, владелец: «сделай очень удобную систему по учёту»). Что сделано ради
 * удобства, а не красоты:
 *  - дата и участок — в шапке, стрелками и плитками; на плитке видно, сколько строк на этот день уже есть;
 *  - «Повторить состав»: бригада вчерашнего (последнего записанного) дня встаёт в сетку с блоком и видом работ, остаётся
 *    вписать количество — так в книге и было: день за днём одни и те же люди;
 *  - в списке сотрудников первыми те, кто работал на этом участке последние полтора месяца;
 *  - новая строка берёт блок и вид работ у предыдущей; Enter в количестве ведёт в количество следующей строки;
 *  - вид «по часам» (уборка, центр-бутон) прячет количество — путаница «часы в штуки» из книги здесь невозможна;
 *  - итоги дня по видам работ считаются на лету; сохранение — одной кнопкой, пустые строки отбрасываются сами.
 * Правила проверяет сервер (`cleanWorkDay`), здесь — та же проверка ради подсказки до нажатия (грабли 1.11).
 */

type Row = WorkRowDraft & { uid: number };

/** Значение списка у строки старого учёта без карточки: своя метка, чтобы не путать с «не выбран». */
const LEGACY = "__legacy";

export interface DayEntryBoardProps {
  farm: string;
  date: string;
  today: string;
  area: WorkArea;
  areaLabels: Record<WorkArea, string>;
  counts: Record<WorkArea, number>;
  people: WorkPerson[];
  /** Карточки тех, кто работал на участке недавно — первыми в списке. */
  recent: string[];
  blocks: string[];
  initial: (WorkRowDraft & { name: string })[];
  crew: { date: string; rows: { employeeId: string; block: string; part: string; workType: string }[] } | null;
  canEdit: boolean;
  save: (farm: string, area: string, date: string, drafts: WorkRowDraft[]) => Promise<unknown>;
}

let uidSeq = 1;

function draftOf(rows: Row[]): WorkRowDraft[] {
  return rows.map(({ uid: _u, ...r }) => r);
}

/** Крупное число с пробелами тысяч: 19130 → «19 130». */
function big(n: number, digits = 0): string {
  return Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: digits }) : "—";
}

export default function DayEntryBoard({ farm, date, today, area, areaLabels, counts, people, recent, blocks, initial, crew, canEdit, save }: DayEntryBoardProps) {
  const router = useRouter();
  const types = WORK_TYPES[area];
  const mainType = types.find((t) => t.main) ?? types[0];
  const [rows, setRows] = useState<Row[]>(() => initial.map((r) => ({ ...r, uid: uidSeq++ })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [fillBlock, setFillBlock] = useState("");
  const [fillType, setFillType] = useState("");
  const qtyRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const initialJson = useMemo(() => JSON.stringify(draftOf(initial.map((r) => ({ ...r, uid: 0 })))), [initial]);
  const dirty = JSON.stringify(draftOf(rows)) !== initialJson;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const personName = useMemo(() => new Map(people.map((p) => [p.employeeId, p])), [people]);
  const recentSet = useMemo(() => new Set(recent), [recent]);
  const recentPeople = useMemo(() => recent.map((id) => personName.get(id)).filter((p): p is WorkPerson => !!p), [recent, personName]);
  const otherPeople = useMemo(() => people.filter((p) => !recentSet.has(p.employeeId)), [people, recentSet]);

  const go = (next: { date?: string; area?: string }) => {
    if (dirty && !window.confirm("Есть несохранённые строки. Уйти без сохранения?")) return;
    router.push(ghHref("/greenhouse/work", farm, { date: next.date ?? date, area: next.area ?? area }));
  };

  const update = (uid: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
    setSaved("");
  };

  const addRow = (from?: Row) => {
    const last = from ?? rows[rows.length - 1];
    const row: Row = {
      uid: uidSeq++,
      workId: "",
      employeeId: "",
      block: last?.block ?? "",
      part: last?.part ?? (area === "prep" ? "1" : ""),
      workType: last?.workType ?? mainType.code,
      qty: area === "prep" ? 1 : "",
      hours: "",
      note: "",
    };
    setRows((rs) => [...rs, row]);
    return row;
  };

  const repeatCrew = () => {
    if (!crew) return;
    const have = new Set(rows.map((r) => `${r.employeeId}|${r.block}|${r.part}|${r.workType}`));
    const add: Row[] = crew.rows
      .filter((c) => personName.has(c.employeeId) && !have.has(`${c.employeeId}|${c.block}|${c.part}|${c.workType}`))
      .map((c) => ({ uid: uidSeq++, workId: "", employeeId: c.employeeId, block: c.block, part: c.part, workType: c.workType, qty: area === "prep" ? 1 : "", hours: "", note: "" }));
    setRows((rs) => [...rs, ...add]);
    setSaved("");
  };

  const applyFill = () => {
    setRows((rs) => rs.map((r) => ({ ...r, block: fillBlock || r.block, workType: fillType || r.workType })));
    setSaved("");
  };

  const problems = useMemo(() => {
    const out = new Map<number, string>();
    const seen = new Map<string, number>();
    rows.forEach((r) => {
      const empty = !r.employeeId && !String(r.qty).trim() && !String(r.hours).trim();
      if (empty) return;
      const { row, error } = cleanWorkRow(area, r);
      if (!row) {
        out.set(r.uid, error);
        return;
      }
      const key = `${row.employeeId}|${row.block}|${row.part}|${row.workType}`;
      if (seen.has(key)) out.set(r.uid, "такая строка уже есть выше — сложите в одну");
      else seen.set(key, r.uid);
    });
    return out;
  }, [rows, area]);

  const totals = useMemo(() => {
    const byType = new Map<string, { qty: number; hours: number; people: Set<string> }>();
    const peopleAll = new Set<string>();
    for (const r of rows) {
      const who = r.employeeId || (r.workId && r.name ? `name:${r.name}` : "");
      if (!who) continue;
      const t = workType(area, r.workType);
      if (!t) continue;
      const q = Number(String(r.qty).replace(",", ".")) || 0;
      const h = Number(String(r.hours).replace(",", ".")) || 0;
      const acc = byType.get(t.code) ?? { qty: 0, hours: 0, people: new Set<string>() };
      acc.qty += t.basis === "qty" ? q : 0;
      acc.hours += h;
      acc.people.add(who);
      byType.set(t.code, acc);
      peopleAll.add(who);
    }
    return { byType, people: peopleAll.size };
  }, [rows, area]);

  const onSave = async () => {
    setError("");
    setSaved("");
    const nonEmpty = rows.filter((r) => r.employeeId || String(r.qty).trim() || String(r.hours).trim());
    if (nonEmpty.some((r) => problems.has(r.uid))) {
      setError("В сетке есть строки с ошибками — они подсвечены.");
      return;
    }
    setBusy(true);
    try {
      const res = unwrapValue(await save(farm, area, date, draftOf(nonEmpty))) as { added: number; changed: number; removed: number };
      const parts = [res.added ? `добавлено ${res.added}` : "", res.changed ? `изменено ${res.changed}` : "", res.removed ? `удалено ${res.removed}` : ""].filter(Boolean);
      setSaved(parts.length ? `Сохранено: ${parts.join(", ")}.` : "Изменений не было.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось сохранить.");
    } finally {
      setBusy(false);
    }
  };

  const focusQty = (index: number) => {
    const row = rows[index];
    if (!row) return;
    const el = qtyRefs.current.get(row.uid);
    el?.focus();
    el?.select();
  };

  const isToday = date === today;
  const weekday = new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "long" });

  return (
    <div className="space-y-4">
      {/* Дата и участок */}
      <div className="card !p-3 sm:!p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary !px-3" onClick={() => go({ date: shiftDay(date, -1) })} aria-label="Предыдущий день">
            ‹
          </button>
          <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => e.target.value && e.target.value <= today && go({ date: e.target.value })} />
          <button type="button" className="btn-secondary !px-3" disabled={isToday} onClick={() => go({ date: shiftDay(date, 1) })} aria-label="Следующий день">
            ›
          </button>
          <span className="text-sm text-ink-secondary capitalize">{weekday}</span>
          {!isToday && (
            <button type="button" className="text-sm underline text-ink-secondary" onClick={() => go({ date: today })}>
              сегодня
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-1 px-1">
          {WORK_AREAS.map((a) => {
            const on = a === area;
            return (
              <button
                key={a}
                type="button"
                onClick={() => !on && go({ area: a })}
                className={clsx(
                  "h-9 px-3.5 rounded-full text-sm whitespace-nowrap inline-flex items-center gap-2 transition-colors",
                  on ? "bg-ink-primary text-white font-medium" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane",
                )}
              >
                {areaLabels[a]}
                <span className={clsx("text-xs tabular-nums", on ? "text-white/70" : counts[a] ? "text-status-good font-semibold" : "text-ink-muted")}>{counts[a] || "—"}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Сетка */}
      <div className="card !p-0 overflow-hidden">
        <div className="hidden sm:grid grid-cols-[minmax(14rem,2fr)_6rem_minmax(9rem,1.3fr)_6.5rem_5.5rem_2.5rem] gap-2 px-4 py-2 text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
          <div>Сотрудник</div>
          <div>{area === "prep" ? "Блок · секция" : "Блок"}</div>
          <div>Вид работ</div>
          <div className="text-right">{area === "prep" ? "Блок-секц." : "Кол-во, шт"}</div>
          <div className="text-right">Часов</div>
          <div />
        </div>
        {rows.length === 0 && (
          <div className="px-4 py-6 text-sm text-ink-secondary">
            На {formatDay(date)} по участку «{areaLabels[area]}» записей нет.
            {canEdit && crew && (
              <>
                {" "}
                Можно <button type="button" className="underline font-medium" onClick={repeatCrew}>повторить состав</button> от {formatDay(crew.date)} ({crew.rows.length}{" "}
                {crew.rows.length === 1 ? "строка" : crew.rows.length < 5 ? "строки" : "строк"}) или добавить строки вручную.
              </>
            )}
          </div>
        )}
        <div className="divide-y divide-line-hairline/60">
          {rows.map((r, i) => {
            const t = workType(area, r.workType);
            const hoursOnly = t?.basis === "hours";
            const problem = problems.get(r.uid);
            const person = personName.get(r.employeeId);
            return (
              <div key={r.uid} className={clsx("px-3 sm:px-4 py-2.5 sm:py-1.5", problem && "bg-[#fff4f4]")}>
                <div className="grid grid-cols-2 sm:grid-cols-[minmax(14rem,2fr)_6rem_minmax(9rem,1.3fr)_6.5rem_5.5rem_2.5rem] gap-2 items-center">
                  <div className="col-span-2 sm:col-span-1 flex items-center gap-1.5">
                    {canEdit && (
                      <button
                        type="button"
                        className="sm:hidden h-9 w-9 shrink-0 rounded-lg text-ink-muted hover:bg-[#fde8e8] hover:text-[#a12b2b] order-last"
                        title="Убрать строку"
                        onClick={() => {
                          setRows((rs) => rs.filter((x) => x.uid !== r.uid));
                          setSaved("");
                        }}
                      >
                        ✕
                      </button>
                    )}
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
                        <optgroup label="Работали на участке недавно">
                          {recentPeople.map((p) => (
                            <option key={p.employeeId} value={p.employeeId}>
                              {p.fullName}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label={recentPeople.length ? "Остальные сотрудники" : "Сотрудники"}>
                        {otherPeople.map((p) => (
                          <option key={p.employeeId} value={p.employeeId}>
                            {p.fullName} · {p.deptName}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  <div className="flex gap-1.5">
                    <input list={`blocks-${area}`} className="input !py-1.5 min-w-0" placeholder="Блок" value={r.block} disabled={!canEdit} onChange={(e) => update(r.uid, { block: e.target.value })} />
                    {area === "prep" && (
                      <select className="input !py-1.5 !w-[4.6rem] shrink-0" value={r.part} disabled={!canEdit} onChange={(e) => update(r.uid, { part: e.target.value })}>
                        {PARTS.map((p) => (
                          <option key={p} value={p}>
                            {p} с.
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <select className="input !py-1.5" value={r.workType} disabled={!canEdit} onChange={(e) => update(r.uid, { workType: e.target.value })}>
                      {types.map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1 sm:block">
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
                  </div>
                  <div className="flex items-center gap-1 sm:block">
                    <span className="sm:hidden text-xs text-ink-muted w-12">Часов</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input !py-1.5 text-right tabular-nums"
                      placeholder="0"
                      value={r.hours}
                      disabled={!canEdit}
                      onChange={(e) => update(r.uid, { hours: e.target.value })}
                    />
                  </div>
                  <div className="hidden sm:flex text-right justify-end">
                    {canEdit && (
                      <button
                        type="button"
                        className="h-8 w-8 rounded-lg text-ink-muted hover:bg-[#fde8e8] hover:text-[#a12b2b]"
                        title="Убрать строку"
                        onClick={() => {
                          setRows((rs) => rs.filter((x) => x.uid !== r.uid));
                          setSaved("");
                        }}
                      >
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
        <datalist id={`blocks-${area}`}>
          {blocks.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-t border-line-hairline bg-surface-plane/40">
            <button type="button" className="btn-secondary !py-1.5" onClick={() => addRow()}>
              + Строка
            </button>
            {crew && (
              <button type="button" className="btn-secondary !py-1.5" onClick={repeatCrew} title={`Состав от ${formatDay(crew.date)}`}>
                Повторить состав от {formatDay(crew.date)}
              </button>
            )}
            {rows.length > 1 && (
              <div className="hidden sm:flex items-center gap-1.5 text-sm ml-auto">
                <span className="text-ink-muted text-xs">Всем:</span>
                <input list={`blocks-${area}`} className="input !py-1 !w-20 text-sm" placeholder="блок" value={fillBlock} onChange={(e) => setFillBlock(e.target.value)} />
                <select className="input !py-1 !w-auto text-sm" value={fillType} onChange={(e) => setFillType(e.target.value)}>
                  <option value="">вид работ</option>
                  {types.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-secondary !py-1 text-sm" disabled={!fillBlock && !fillType} onClick={applyFill}>
                  Применить
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Итоги дня и сохранение */}
      <div className="card !p-4 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mr-auto">
          <div>
            <div className="text-xs text-ink-muted">Человек</div>
            <div className="font-display font-extrabold text-xl tabular-nums">{totals.people || "—"}</div>
          </div>
          {types
            .filter((t) => totals.byType.has(t.code))
            .map((t) => {
              const v = totals.byType.get(t.code)!;
              return (
                <div key={t.code}>
                  <div className="text-xs text-ink-muted">{t.label}</div>
                  <div className="font-display font-extrabold text-xl tabular-nums">
                    {t.basis === "qty" ? `${big(v.qty, 2)} ${t.unit}` : `${decimal(v.hours, 2)} ч`}
                    {t.basis === "qty" && v.hours > 0 && <span className="text-sm font-normal text-ink-secondary"> · {decimal(v.hours, 1)} ч · {big(v.qty / v.hours)}/ч</span>}
                  </div>
                </div>
              );
            })}
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-status-good">{saved}</span>}
            {error && <span className="text-sm text-[#a12b2b] max-w-[24rem]">{error}</span>}
            <button type="button" className="btn-primary" disabled={busy || (!dirty && !error)} onClick={onSave}>
              {busy ? "Сохраняю…" : "Сохранить день"}
            </button>
          </div>
        )}
        {!canEdit && (
          <Link href={ghHref("/greenhouse/work/journal", farm, { from: date, to: date })} className="text-sm underline">
            В журнал
          </Link>
        )}
      </div>
    </div>
  );
}
