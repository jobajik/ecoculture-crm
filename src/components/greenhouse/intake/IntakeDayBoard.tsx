"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import Icon from "@/components/Icon";
import { unwrapValue } from "@/lib/actionResult";
import { ghHref } from "@/lib/greenhouse/farm";
import {
  INTAKE_FLOWERS,
  INTAKE_FLOWER_LABELS,
  INTAKE_GRADE_COLORS,
  INTAKE_SPECS,
  REJECT_REASONS,
  gradeLabel,
  gradeShort,
  type IntakeDay,
  type IntakeDraft,
  type IntakeFlower,
  type MeasureKey,
} from "@/lib/greenhouse/intake";
import { shiftDay } from "@/lib/payroll/work";
import type { IntakeSavePayload } from "@/app/greenhouse/intake-actions";

/**
 * Приёмка Rose Farm за день (02.11.2026, владелец: «приёмка цветка по характеристикам… сделай удобную и понятную
 * систему»). Ответственный идёт сверху вниз:
 *   день → цветок (роза, эустома, хризантема — плитки с итогом дня) → сорта строками, длины/категории колонками →
 *   характеристики сорта (вес стебля, бутон) → брак с причиной,
 * и сохраняет всё одной кнопкой. Как в тетради приёмки: строка — сорт, в клетке — сколько стеблей этой длины.
 * Enter в клетке — та же длина у следующего сорта. «Как в прошлый раз» ставит сорта последнего дня приёмки.
 */

interface Line {
  uid: string;
  flower: IntakeFlower;
  block: string;
  variety: string;
  cells: Record<string, { id: string; qty: string }>;
  measure: { id: string; stemG: string; headCm: string; buds: string };
}
interface Reject {
  uid: string;
  id: string;
  flower: IntakeFlower;
  block: string;
  variety: string;
  reason: string;
  qty: string;
  note: string;
}

let seq = 0;
const uid = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;
const n = (s: string | number) => Number(String(s).replace(/[\s ]/g, "").replace(",", ".")) || 0;
const n0 = (v: number) => Math.round(v).toLocaleString("ru-RU");
const vkey = (v: string) => v.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const plural = (k: number, one: string, few: string, many: string) => {
  const a = Math.abs(k) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

const fmt = (v: number | undefined) => (v ? String(v).replace(".", ",") : "");

function fromDay(day: IntakeDay): { lines: Line[]; rejects: Reject[] } {
  return {
    lines: day.lines.map((l) => ({
      uid: uid(),
      flower: l.flower,
      block: l.block,
      variety: l.variety,
      cells: Object.fromEntries(Object.entries(l.cells).map(([g, c]) => [g, { id: c.id, qty: String(c.qty) }])),
      measure: { id: l.measure?.id ?? "", stemG: fmt(l.measure?.stemG), headCm: fmt(l.measure?.headCm), buds: fmt(l.measure?.buds) },
    })),
    rejects: day.rejects.map((r) => ({ uid: uid(), id: r.id, flower: r.flower, block: r.block, variety: r.variety, reason: r.reason, qty: String(r.qty), note: r.note })),
  };
}

/** Строки для сохранения — из того, что на экране. Пустые клетки и пустые замеры не уходят (удалятся, если были). */
function toDrafts(lines: Line[], rejects: Reject[]): IntakeDraft[] {
  const out: IntakeDraft[] = [];
  for (const l of lines) {
    if (!l.variety.trim()) continue;
    for (const [grade, c] of Object.entries(l.cells)) if (n(c.qty) > 0) out.push({ id: c.id, flower: l.flower, block: l.block, variety: l.variety, kind: "accept", grade, qty: c.qty.trim() });
    const m = l.measure;
    if (n(m.stemG) || n(m.headCm) || n(m.buds)) out.push({ id: m.id, flower: l.flower, block: l.block, variety: l.variety, kind: "measure", stemG: m.stemG, headCm: m.headCm, buds: m.buds });
  }
  for (const r of rejects) if (r.variety.trim() || n(r.qty) || r.reason) out.push({ id: r.id, flower: r.flower, block: r.block, variety: r.variety, kind: "reject", reason: r.reason, qty: r.qty.trim(), note: r.note });
  return out;
}
const draftKey = (d: IntakeDraft[]) =>
  JSON.stringify(d.map((x) => [x.id, x.flower, x.block, x.variety, x.kind, x.grade ?? "", String(x.qty ?? ""), String(x.stemG ?? ""), String(x.headCm ?? ""), String(x.buds ?? ""), x.reason ?? "", x.note ?? ""]).sort());

function problem(lines: Line[], rejects: Reject[]): { flower: IntakeFlower; text: string } | null {
  for (const l of lines) {
    const filled = Object.values(l.cells).some((c) => c.qty.trim()) || l.measure.stemG || l.measure.headCm || l.measure.buds;
    if (!l.variety.trim() && filled) return { flower: l.flower, text: "у строки нет сорта" };
    for (const [g, c] of Object.entries(l.cells)) {
      if (!c.qty.trim()) continue;
      const v = n(c.qty);
      if (!Number.isInteger(v) || v < 0 || !/^[\d\s ]+$/.test(c.qty.trim())) return { flower: l.flower, text: `${l.variety}, ${gradeLabel(l.flower, g)}: стебли — целым числом` };
    }
    for (const m of INTAKE_SPECS[l.flower].measures) {
      const raw = l.measure[m.key].trim();
      if (!raw) continue;
      const v = n(raw);
      if (!v || v < m.min || v > m.max) return { flower: l.flower, text: `${l.variety}: ${m.label.toLowerCase()} — от ${m.min} до ${m.max} ${m.unit}` };
    }
  }
  for (const r of rejects) {
    if (!r.variety.trim() && !n(r.qty) && !r.reason) continue;
    if (!r.variety.trim()) return { flower: r.flower, text: "брак: не указан сорт" };
    if (!r.reason) return { flower: r.flower, text: `брак ${r.variety}: выберите причину` };
    if (!Number.isInteger(n(r.qty)) || n(r.qty) <= 0) return { flower: r.flower, text: `брак ${r.variety}: сколько стеблей` };
  }
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.variety.trim()) continue;
    const k = `${l.flower}|${l.block}|${vkey(l.variety)}`;
    if (seen.has(k)) return { flower: l.flower, text: `${l.variety} в списке дважды — оставьте одну строку` };
    seen.add(k);
  }
  return null;
}

export default function IntakeDayBoard({
  farm,
  date,
  today,
  day,
  initialFlower,
  varieties,
  recent,
  last,
  canEdit,
  save,
}: {
  farm: string;
  date: string;
  today: string;
  day: IntakeDay;
  initialFlower: IntakeFlower;
  varieties: Record<IntakeFlower, string[]>;
  recent: Record<IntakeFlower, { variety: string; block: string }[]>;
  last: Record<IntakeFlower, { date: string; lines: { variety: string; block: string }[] } | null>;
  canEdit: boolean;
  save: (farm: string, date: string, payload: IntakeSavePayload) => Promise<unknown>;
}) {
  const router = useRouter();
  const [base, setBase] = useState<IntakeDay>(day);
  const [lines, setLines] = useState<Line[]>(() => fromDay(day).lines);
  const [rejects, setRejects] = useState<Reject[]>(() => fromDay(day).rejects);
  const [flower, setFlower] = useState<IntakeFlower>(initialFlower);
  const [showMore, setShowMore] = useState<Record<IntakeFlower, boolean>>(() => ({
    rose: day.lines.some((l) => l.flower === "rose" && INTAKE_SPECS.rose.more.some((g) => l.cells[g])),
    eustoma: false,
    chrysanthemum: day.lines.some((l) => l.flower === "chrysanthemum" && INTAKE_SPECS.chrysanthemum.more.some((g) => l.cells[g])),
  }));
  const [showBlock, setShowBlock] = useState(() => day.lines.some((l) => l.block) || day.rejects.some((r) => r.block));
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const focusRef = useRef<string | null>(null);

  const baseState = useMemo(() => fromDay(base), [base]);
  const known = useMemo(() => [...base.lines.flatMap((l) => [...Object.values(l.cells).map((c) => c.id), l.measure?.id ?? ""]), ...base.rejects.map((r) => r.id)].filter(Boolean), [base]);
  const flowerKey = (f: IntakeFlower, ls: Line[], rs: Reject[]) => draftKey(toDrafts(ls.filter((l) => l.flower === f), rs.filter((r) => r.flower === f)));
  const dirtyFlowers = INTAKE_FLOWERS.filter((f) => flowerKey(f, lines, rejects) !== flowerKey(f, baseState.lines, baseState.rejects));
  const dirty = dirtyFlowers.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!focusRef.current) return;
    const el = document.querySelector<HTMLInputElement>(`[data-focus='${focusRef.current}']`);
    focusRef.current = null;
    el?.focus();
  });

  const go = (d: string) => {
    if (dirty && !window.confirm("Есть несохранённая приёмка. Уйти без сохранения?")) return;
    router.push(ghHref("/greenhouse/day", farm, { date: d, flower }));
  };

  const spec = INTAKE_SPECS[flower];
  const cols = showMore[flower] ? [...spec.grades, ...spec.more] : spec.grades;
  const myLines = lines.filter((l) => l.flower === flower);
  const myRejects = rejects.filter((r) => r.flower === flower);

  const totals = (f: IntakeFlower) => {
    let acc = 0;
    let rej = 0;
    for (const l of lines) if (l.flower === f) for (const c of Object.values(l.cells)) acc += n(c.qty);
    for (const r of rejects) if (r.flower === f) rej += n(r.qty);
    return { acc, rej, sorts: lines.filter((l) => l.flower === f && Object.values(l.cells).some((c) => n(c.qty) > 0)).length };
  };

  const setLine = (u: string, fn: (l: Line) => Line) => setLines((all) => all.map((l) => (l.uid === u ? fn(l) : l)));
  const setCell = (u: string, grade: string, qty: string) => setLine(u, (l) => ({ ...l, cells: { ...l.cells, [grade]: { id: l.cells[grade]?.id ?? "", qty } } }));
  const setMeasure = (u: string, k: MeasureKey, v: string) => setLine(u, (l) => ({ ...l, measure: { ...l.measure, [k]: v } }));

  const addLines = (items: { variety: string; block: string }[]) => {
    const have = new Set(lines.filter((l) => l.flower === flower).map((l) => `${l.block}|${vkey(l.variety)}`));
    const add: Line[] = [];
    for (const it of items) {
      const k = `${it.block}|${vkey(it.variety)}`;
      if (!it.variety.trim() || have.has(k)) continue;
      have.add(k);
      add.push({ uid: uid(), flower, block: it.block, variety: it.variety.trim(), cells: {}, measure: { id: "", stemG: "", headCm: "", buds: "" } });
    }
    if (add.length) {
      setLines((all) => [...all, ...add]);
      if (add.some((a) => a.block)) setShowBlock(true);
      focusRef.current = `${add[0].uid}|${cols[0]}`;
    }
    return add.length;
  };
  const addOne = () => {
    const v = adding.trim();
    if (!v) return;
    const canon = varieties[flower].find((x) => vkey(x) === vkey(v)) ?? v;
    const existing = myLines.find((l) => !l.block && vkey(l.variety) === vkey(canon));
    if (existing) {
      focusRef.current = `${existing.uid}|${cols[0]}`;
      setAdding("");
      setLines((all) => [...all]);
      return;
    }
    addLines([{ variety: canon, block: "" }]);
    setAdding("");
  };
  const removeLine = (l: Line) => {
    const filled = Object.values(l.cells).some((c) => n(c.qty) > 0);
    if (filled && !window.confirm(`Убрать ${l.variety} из приёмки этого дня?`)) return;
    setLines((all) => all.filter((x) => x.uid !== l.uid));
  };

  // Enter — та же колонка у следующего сорта (как вниз по тетради).
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = myLines[row + 1];
    const target = next ? `${next.uid}|${cols[col]}` : `${myLines[0]?.uid}|${cols[col + 1] ?? cols[0]}`;
    document.querySelector<HTMLInputElement>(`[data-focus='${target}']`)?.focus();
  };

  const varietyChips = useMemo(() => {
    const have = new Set(myLines.map((l) => `${l.block}|${vkey(l.variety)}`));
    return recent[flower].filter((r) => !have.has(`${r.block}|${vkey(r.variety)}`)).slice(0, 12);
  }, [recent, flower, myLines]);
  const lastDay = last[flower];
  const lastSorts = lastDay ? new Set(lastDay.lines.map((x) => vkey(x.variety))).size : 0;

  async function onSave() {
    setMsg(null);
    const bad = problem(lines, rejects);
    if (bad) {
      setFlower(bad.flower);
      setMsg({ ok: false, text: `${INTAKE_FLOWER_LABELS[bad.flower]}: ${bad.text}${/[.!?]$/.test(bad.text) ? "" : "."}` });
      return;
    }
    setBusy(true);
    try {
      const res = unwrapValue(await save(farm, date, { rows: toDrafts(lines, rejects), known })) as { added: number; changed: number; removed: number; day: IntakeDay };
      const parts = [res.added ? `добавлено ${res.added}` : "", res.changed ? `изменено ${res.changed}` : "", res.removed ? `удалено ${res.removed}` : ""].filter(Boolean);
      const next = fromDay(res.day);
      setBase(res.day);
      setLines(next.lines);
      setRejects(next.rejects);
      setMsg({ ok: true, text: parts.length ? `Приёмка сохранена: ${parts.join(", ")}.` : "Изменений не было." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не получилось сохранить." });
    } finally {
      setBusy(false);
    }
  }
  const reset = () => {
    if (!window.confirm("Отменить все несохранённые правки приёмки?")) return;
    setLines(baseState.lines);
    setRejects(baseState.rejects);
    setMsg(null);
  };

  const isToday = date === today;
  const longDate = new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const t = totals(flower);
  const colTotal = (g: string) => myLines.reduce((s, l) => s + n(l.cells[g]?.qty ?? ""), 0);
  const lineTotal = (l: Line) => Object.values(l.cells).reduce((s, c) => s + n(c.qty), 0);
  const listId = `iv-${flower}`;

  return (
    <div className="space-y-4 pb-28">
      {/* День */}
      <div className="card !p-3 sm:!p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-secondary !px-3 !h-10" onClick={() => go(shiftDay(date, -1))} aria-label="Предыдущий день">
            ‹
          </button>
          <label className="relative h-10 px-4 rounded-xl border border-line-hairline bg-surface inline-flex items-center gap-2 cursor-pointer hover:bg-surface-plane">
            <Icon name="calendar" className="w-4 h-4 text-section-greenhouse" />
            <span className="font-display font-extrabold text-[16px] first-letter:uppercase whitespace-nowrap">{longDate}</span>
            <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" value={date} max={today} onChange={(e) => e.target.value && e.target.value <= today && go(e.target.value)} aria-label="Выбрать день" />
          </label>
          <button type="button" className="btn-secondary !px-3 !h-10" disabled={isToday} onClick={() => go(shiftDay(date, 1))} aria-label="Следующий день">
            ›
          </button>
        </div>
        {isToday ? (
          <span className="text-xs rounded-full px-2.5 py-1 bg-section-greenhouse-soft text-section-greenhouse font-medium">сегодня</span>
        ) : (
          <button type="button" className="text-sm underline text-ink-secondary" onClick={() => go(today)}>
            к сегодня
          </button>
        )}
        <Link href={ghHref("/greenhouse/records", farm, { period: "day", date })} className="ml-auto text-sm text-ink-secondary hover:text-ink-primary underline-offset-2 hover:underline">
          Записи за день →
        </Link>
      </div>

      {/* Цветок */}
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
        {INTAKE_FLOWERS.map((f) => {
          const on = f === flower;
          const tt = totals(f);
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFlower(f)}
              className={clsx(
                "relative text-left rounded-2xl border p-3 sm:p-4 transition-all min-w-0",
                on ? "border-section-greenhouse bg-section-greenhouse-soft shadow-card ring-1 ring-section-greenhouse/30" : "border-line-hairline bg-surface hover:border-section-greenhouse/40 hover:bg-surface-plane",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-[14px] sm:text-[15px] truncate">{INTAKE_FLOWER_LABELS[f]}</span>
                {dirtyFlowers.includes(f) && <span className="ml-auto w-2 h-2 rounded-full bg-[#d9902b] flex-none" title="Не сохранено" />}
              </div>
              <div className="font-display font-extrabold text-[19px] sm:text-[22px] tabular-nums mt-1.5 leading-none">{tt.acc ? n0(tt.acc) : "—"}</div>
              <div className="text-[11px] sm:text-xs text-ink-muted mt-1 truncate">
                {tt.acc || tt.rej ? `${tt.sorts} ${plural(tt.sorts, "сорт", "сорта", "сортов")}${tt.rej ? ` · брак ${n0(tt.rej)}` : ""}` : f === "chrysanthemum" ? "своя, Rose Farm" : "не внесено"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Принято */}
      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 sm:px-4 py-3 border-b border-line-hairline bg-surface-plane/50">
          <h2 className="font-display font-extrabold text-[17px]">
            {INTAKE_FLOWER_LABELS[flower]} · принято{t.acc ? <span className="text-ink-secondary font-semibold"> {n0(t.acc)} шт.</span> : null}
          </h2>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs sm:ml-auto">
            {spec.more.length > 0 && (
              <label className="inline-flex items-center gap-1.5 text-ink-secondary cursor-pointer">
                <input type="checkbox" checked={showMore[flower]} onChange={(e) => setShowMore((s) => ({ ...s, [flower]: e.target.checked }))} />
                {flower === "rose" ? "2 сорт и B" : "нераскрывшийся"}
              </label>
            )}
            <label className="inline-flex items-center gap-1.5 text-ink-secondary cursor-pointer">
              <input type="checkbox" checked={showBlock} onChange={(e) => setShowBlock(e.target.checked)} />
              по блокам
            </label>
          </div>
        </div>

        {myLines.length === 0 ? (
          <div className="px-3 sm:px-4 py-5 text-sm text-ink-secondary">
            {canEdit ? "Добавьте сорт — ниже. В строке сорта вписывается, сколько стеблей пришло каждой длины." : "За этот день приёмки нет."}
          </div>
        ) : (
          <>
            {/* Компьютер: таблица «сорт × длина» */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-ink-muted border-b border-line-hairline">
                    <th className="text-left font-medium px-3 py-2 min-w-[9rem]">Сорт</th>
                    {showBlock && <th className="text-left font-medium px-1 py-2 w-20">Блок</th>}
                    {cols.map((g) => (
                      <th key={g} className="font-medium px-0.5 py-2 w-[3.6rem] text-center" title={gradeLabel(flower, g)}>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-sm" style={{ background: INTAKE_GRADE_COLORS[g] ?? "#bbb" }} />
                          {gradeShort(g)}
                        </span>
                      </th>
                    ))}
                    <th className="font-medium px-2 py-2 text-right w-16">Всего</th>
                    {spec.measures.map((m) => (
                      <th key={m.key} className="font-medium px-0.5 py-2 w-[3.9rem] text-center bg-surface-plane/60" title={`${m.label}, ${m.unit} — средний по сорту`}>
                        {m.short}, {m.unit}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {myLines.map((l, ri) => (
                    <tr key={l.uid} className="border-b border-line-hairline/70 hover:bg-surface-plane/40">
                      <td className="px-3 py-1 font-medium truncate max-w-[12rem]" title={l.variety}>
                        {l.variety}
                      </td>
                      {showBlock && (
                        <td className="px-1 py-1">
                          <input className="input !h-8 !py-0 !px-1.5 text-center w-full" value={l.block} disabled={!canEdit} onChange={(e) => setLine(l.uid, (x) => ({ ...x, block: e.target.value.slice(0, 30) }))} placeholder="—" />
                        </td>
                      )}
                      {cols.map((g, ci) => (
                        <td key={g} className="px-0.5 py-1">
                          <input
                            data-focus={`${l.uid}|${g}`}
                            className={clsx("input !h-8 !py-0 !px-1 text-center tabular-nums w-full", l.cells[g]?.qty && "font-semibold bg-section-greenhouse-soft/50")}
                            inputMode="numeric"
                            value={l.cells[g]?.qty ?? ""}
                            disabled={!canEdit}
                            onChange={(e) => setCell(l.uid, g, e.target.value.replace(/[^\d\s]/g, ""))}
                            onKeyDown={(e) => onCellKey(e, ri, ci)}
                            aria-label={`${l.variety}, ${gradeLabel(flower, g)}`}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-semibold">{lineTotal(l) ? n0(lineTotal(l)) : ""}</td>
                      {spec.measures.map((m) => (
                        <td key={m.key} className="px-0.5 py-1 bg-surface-plane/60">
                          <input className="input !h-8 !py-0 !px-1 text-center tabular-nums w-full" inputMode="decimal" value={l.measure[m.key]} disabled={!canEdit} onChange={(e) => setMeasure(l.uid, m.key, e.target.value.replace(/[^\d.,]/g, ""))} aria-label={`${l.variety}: ${m.label}`} />
                        </td>
                      ))}
                      <td className="px-1 text-center">
                        {canEdit && (
                          <button type="button" className="text-ink-muted hover:text-[#a12b2b] px-1" onClick={() => removeLine(l)} aria-label={`Убрать ${l.variety}`}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-xs text-ink-secondary">
                    <td className="px-3 py-2">Итого</td>
                    {showBlock && <td />}
                    {cols.map((g) => (
                      <td key={g} className="px-0.5 py-2 text-center tabular-nums font-medium">
                        {colTotal(g) ? n0(colTotal(g)) : ""}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right tabular-nums font-bold text-ink-primary">{t.acc ? n0(t.acc) : ""}</td>
                    <td colSpan={spec.measures.length + 1} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Телефон: карточка на сорт */}
            <div className="sm:hidden divide-y divide-line-hairline">
              {myLines.map((l) => (
                <div key={l.uid} className="px-3 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{l.variety}</span>
                    {lineTotal(l) > 0 && <span className="text-sm tabular-nums text-ink-secondary whitespace-nowrap">{n0(lineTotal(l))} шт.</span>}
                    {showBlock && (
                      <input className="input !h-8 !py-0 !px-1.5 !w-20 ml-auto text-center text-sm" value={l.block} disabled={!canEdit} placeholder="блок" aria-label="Блок" onChange={(e) => setLine(l.uid, (x) => ({ ...x, block: e.target.value.slice(0, 30) }))} />
                    )}
                    {canEdit && (
                      <button type="button" className={clsx("text-ink-muted px-2", !showBlock && "ml-auto")} onClick={() => removeLine(l)} aria-label={`Убрать ${l.variety}`}>
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {cols.map((g) => (
                      <label key={g} className="block">
                        <span className="flex items-center gap-1 text-[10.5px] text-ink-muted mb-0.5">
                          <span className="w-2 h-2 rounded-sm" style={{ background: INTAKE_GRADE_COLORS[g] ?? "#bbb" }} />
                          {gradeShort(g)}
                        </span>
                        <input
                          className={clsx("input !h-10 !px-1 text-center tabular-nums", l.cells[g]?.qty && "font-semibold bg-section-greenhouse-soft/50")}
                          inputMode="numeric"
                          value={l.cells[g]?.qty ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => setCell(l.uid, g, e.target.value.replace(/[^\d\s]/g, ""))}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {spec.measures.map((m) => (
                      <label key={m.key} className="block">
                        <span className="text-[10.5px] text-ink-muted">
                          {m.label}, {m.unit}
                        </span>
                        <input className="input !h-10 text-center tabular-nums" inputMode="decimal" value={l.measure[m.key]} disabled={!canEdit} onChange={(e) => setMeasure(l.uid, m.key, e.target.value.replace(/[^\d.,]/g, ""))} />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {canEdit && (
          <div className="px-3 sm:px-4 py-3 border-t border-line-hairline space-y-2.5 bg-surface-plane/30">
            <div className="flex gap-2">
              <input
                className="input !h-10 flex-1 sm:flex-none sm:!w-72"
                list={listId}
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOne();
                  }
                }}
                placeholder="Сорт — начните вводить"
              />
              <datalist id={listId}>
                {varieties[flower].map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <button type="button" className="btn-primary !h-10 !px-4" onClick={addOne} disabled={!adding.trim()}>
                + Сорт
              </button>
            </div>
            {(varietyChips.length > 0 || lastDay) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {lastDay && lastDay.lines.some((x) => !myLines.some((l) => l.block === x.block && vkey(l.variety) === vkey(x.variety))) && (
                  <button type="button" className="text-xs px-3 py-1.5 rounded-full bg-section-greenhouse text-white" onClick={() => addLines(lastDay.lines)}>
                    Как {lastDay.date.split("-").reverse().slice(0, 2).join(".")}: {lastSorts} {plural(lastSorts, "сорт", "сорта", "сортов")}
                  </button>
                )}
                {varietyChips.map((c) => (
                  <button key={`${c.block}|${c.variety}`} type="button" className="text-xs px-2.5 py-1.5 rounded-full border border-line-hairline bg-surface hover:border-section-greenhouse/50" onClick={() => addLines([c])}>
                    + {c.variety}
                    {c.block ? <span className="text-ink-muted"> · {c.block}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Брак */}
      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-3 border-b border-line-hairline bg-surface-plane/50">
          <h2 className="font-display font-extrabold text-[17px]">Брак при приёмке</h2>
          {t.rej > 0 && (
            <span className="text-sm text-ink-secondary">
              {n0(t.rej)} шт. · <b className={clsx(t.rej / (t.acc + t.rej) >= 0.05 ? "text-[#a12b2b]" : "text-ink-primary")}>{((t.rej * 100) / (t.acc + t.rej)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %</b> от пришедшего
            </span>
          )}
        </div>
        {myRejects.length > 0 && (
          <div className="divide-y divide-line-hairline/70">
            {myRejects.map((r) => (
              <div key={r.uid} className="grid grid-cols-[1fr_5.5rem_2rem] sm:grid-cols-[minmax(8rem,12rem)_minmax(10rem,1fr)_5.5rem_minmax(6rem,1fr)_2rem] gap-1.5 px-3 sm:px-4 py-2 items-center">
                <input
                  className="input !h-9 order-1 sm:order-none"
                  list={listId}
                  value={r.variety}
                  disabled={!canEdit}
                  placeholder="Сорт"
                  onChange={(e) => setRejects((all) => all.map((x) => (x.uid === r.uid ? { ...x, variety: e.target.value } : x)))}
                />
                <select className="input !h-9 order-4 sm:order-none col-span-3 sm:col-span-1" value={r.reason} disabled={!canEdit} onChange={(e) => setRejects((all) => all.map((x) => (x.uid === r.uid ? { ...x, reason: e.target.value } : x)))}>
                  <option value="">Причина…</option>
                  {REJECT_REASONS.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input !h-9 text-center tabular-nums order-2 sm:order-none"
                  inputMode="numeric"
                  value={r.qty}
                  disabled={!canEdit}
                  placeholder="шт."
                  onChange={(e) => setRejects((all) => all.map((x) => (x.uid === r.uid ? { ...x, qty: e.target.value.replace(/[^\d\s]/g, "") } : x)))}
                />
                <input
                  className="input !h-9 order-5 sm:order-none col-span-3 sm:col-span-1"
                  value={r.note}
                  disabled={!canEdit}
                  placeholder="Заметка"
                  onChange={(e) => setRejects((all) => all.map((x) => (x.uid === r.uid ? { ...x, note: e.target.value.slice(0, 200) } : x)))}
                />
                {canEdit && (
                  <button type="button" className="order-3 sm:order-none text-ink-muted hover:text-[#a12b2b] px-1" onClick={() => setRejects((all) => all.filter((x) => x.uid !== r.uid))} aria-label="Убрать строку брака">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="px-3 sm:px-4 py-3 flex flex-wrap items-center gap-2">
          {canEdit && (
            <button
              type="button"
              className="btn-secondary !h-9 !py-0 text-sm"
              onClick={() => {
                const v = myLines.length === 1 ? myLines[0].variety : "";
                setRejects((all) => [...all, { uid: uid(), id: "", flower, block: "", variety: v, reason: "", qty: "", note: "" }]);
              }}
            >
              + Брак
            </button>
          )}
          {myRejects.length === 0 && <span className="text-sm text-ink-muted">Брака не было — ничего вносить не нужно.</span>}
        </div>
      </div>

      {msg && !dirty && <div className={clsx("text-sm", msg.ok ? "text-status-good" : "text-[#a12b2b]")}>{msg.text}</div>}

      {(dirty || busy) && (
        <div className="no-print fixed inset-x-0 lg:left-[248px] bottom-4 sm:bottom-5 z-30 flex justify-center px-3 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-2xl flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line-hairline bg-surface px-4 py-3 shadow-card-hover">
            <div className="min-w-0 mr-auto">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#d9902b]" /> Не сохранено
              </div>
              <div className="text-xs text-ink-muted truncate">{dirtyFlowers.map((f) => INTAKE_FLOWER_LABELS[f]).join(" · ")}</div>
              {msg && !msg.ok && <div className="text-xs text-[#a12b2b] mt-0.5">{msg.text}</div>}
            </div>
            <button type="button" className="btn !py-2 text-ink-secondary" onClick={reset} disabled={busy}>
              Отменить
            </button>
            <button type="button" className="btn-primary !py-2 !px-5" onClick={onSave} disabled={busy}>
              {busy ? "Сохраняю…" : "Сохранить приёмку"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
