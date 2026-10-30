"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import Icon, { type IconName } from "@/components/Icon";
import { unwrapValue } from "@/lib/actionResult";
import { ghHref } from "@/lib/greenhouse/farm";
import { DAY_SECTION_LABELS, type DayBlock, type DayLogRow, type DaySection } from "@/lib/greenhouse/day";
import type { LogKind } from "@/lib/greenhouse/production";
import { shiftDay, WORK_AREAS, type WorkArea, type WorkRowDraft } from "@/lib/payroll/work";
import type { WorkPerson } from "@/lib/payroll/workData";
import type { DayWorkRow } from "@/lib/greenhouse/dayData";
import type { DayPayload } from "@/app/greenhouse/actions";
import LogRowsEditor, { isEmptyLog, logProblem, logUid, type LogRow } from "./LogRowsEditor";
import WorkRowsEditor, { isEmptyWork, workProblems, workUid, type WorkRow } from "./WorkRowsEditor";

/**
 * «Внести день» (29.10.2026, владелец: «не нравятся эти вкладки — переделать и визуально, и по логике ведения»;
 * выбрал «один ввод за день»). Раньше срезка, брак, черенкование и выработка вносились на четырёх разных страницах,
 * каждая со своей формой и своей кнопкой. Теперь ответственный открывает день и идёт сверху вниз:
 *   дата → что вносим (четыре плитки с итогом дня) → блок → строки,
 * а сохраняет всё одной кнопкой внизу экрана. Несохранённое помечено на плитке и на блоке — переключаться между ними
 * можно, ничего не теряя. Удаляется только то, что человек видел и убрал (`known`, `planDayRows`).
 */

const LOGS: LogKind[] = ["harvest", "waste", "cuttings"];
const SECTION_ICON: Record<DaySection, IconName> = { harvest: "leaf", waste: "alert", cuttings: "tag", people: "client" };
const SECTION_HINT: Record<DaySection, string> = {
  harvest: "что срезали с блоков",
  waste: "повилика, клещ, тех брак",
  cuttings: "приход, факт, выбраковка",
  people: "кто сколько сделал",
};

export interface DayWorkData {
  areaLabels: Record<WorkArea, string>;
  people: WorkPerson[];
  blocks: string[];
  areas: Record<WorkArea, { rows: DayWorkRow[]; crew: { date: string; rows: { employeeId: string; block: string; part: string; workType: string }[] } | null; recent: string[] }>;
}

function toLogRow(r: DayLogRow): LogRow {
  return { uid: logUid(), id: r.id, cycle: String(r.cycle || ""), block: r.block, variety: r.variety, kind: r.kind, qty: r.qty ? String(r.qty) : "", weightKg: r.weightKg ? String(r.weightKg) : "", part: r.part, line: r.line, note: r.note };
}
function toWorkRow(r: WorkRowDraft & { name: string }): WorkRow {
  return { ...r, uid: workUid(), qty: r.qty ? String(r.qty) : "", hours: r.hours ? String(r.hours) : "" };
}
const logKey = (rows: LogRow[]) => JSON.stringify(rows.filter((r) => !isEmptyLog(r)).map(({ uid: _u, ...r }) => r));
const workKey = (rows: WorkRow[]) =>
  JSON.stringify(rows.filter((r) => !isEmptyWork(r)).map((r) => [r.workId, r.employeeId, r.name ?? "", r.block, r.part, r.workType, String(r.qty), String(r.hours), r.note]));
const num = (s: string | number) => Number(String(s).replace(/\s/g, "").replace(",", ".")) || 0;
const n0 = (n: number) => Math.round(n).toLocaleString("ru-RU");
const blockName = (b: string) => (b === "—" ? "Без блока" : /^\d+$/.test(b) ? `Блок ${b}` : b);

export default function DayBoard({
  farm,
  date,
  today,
  initialSection,
  initialBlock,
  canLogs,
  canWork,
  blocks,
  varieties,
  kinds,
  logs,
  work,
  save,
}: {
  farm: string;
  date: string;
  today: string;
  initialSection: DaySection;
  initialBlock: string;
  canLogs: boolean;
  canWork: boolean;
  blocks: DayBlock[];
  varieties: string[];
  kinds: Record<LogKind, { code: string; label: string }[]>;
  logs: Record<LogKind, DayLogRow[]>;
  work: DayWorkData | null;
  save: (farm: string, date: string, payload: DayPayload) => Promise<unknown>;
}) {
  const router = useRouter();
  const sections = useMemo(() => [...(canLogs ? (["harvest", "waste", "cuttings"] as DaySection[]) : []), ...(canWork && work ? (["people"] as DaySection[]) : [])], [canLogs, canWork, work]);
  const [section, setSection] = useState<DaySection>(sections.includes(initialSection) ? initialSection : sections[0] ?? "harvest");
  const [block, setBlock] = useState(initialBlock);
  const [area, setArea] = useState<WorkArea>(() => (work ? WORK_AREAS.find((a) => work.areas[a].rows.length) ?? "cut" : "cut"));

  // «Как в таблице» — слепок дня с сервера: при открытии из страницы, после сохранения — из ответа действия (там
  // номера новых строк). От него считается «не сохранено» и какие строки человек видел (`known`).
  const [base, setBase] = useState<{ logs: Record<LogKind, DayLogRow[]>; work: Record<WorkArea, DayWorkRow[]> }>(() => ({
    logs,
    work: Object.fromEntries(WORK_AREAS.map((a) => [a, work ? work.areas[a].rows : []])) as Record<WorkArea, DayWorkRow[]>,
  }));
  const fromBase = (b: typeof base) => ({
    logs: Object.fromEntries(LOGS.map((k) => [k, b.logs[k].map(toLogRow)])) as Record<LogKind, LogRow[]>,
    work: Object.fromEntries(WORK_AREAS.map((a) => [a, b.work[a].map(toWorkRow)])) as Record<WorkArea, WorkRow[]>,
  });
  const [logRows, setLogRows] = useState(() => fromBase(base).logs);
  const [workRows, setWorkRows] = useState(() => fromBase(base).work);
  const [cycleOverride, setCycleOverride] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const baseLogs = useMemo(() => Object.fromEntries(LOGS.map((k) => [k, logKey(base.logs[k].map(toLogRow))])) as Record<LogKind, string>, [base]);
  const baseWork = useMemo(() => Object.fromEntries(WORK_AREAS.map((a) => [a, workKey(base.work[a].map(toWorkRow))])) as Record<WorkArea, string>, [base]);
  const knownLogs = useMemo(() => Object.fromEntries(LOGS.map((k) => [k, base.logs[k].map((r) => r.id)])) as Record<LogKind, string[]>, [base]);
  const knownWork = useMemo(() => Object.fromEntries(WORK_AREAS.map((a) => [a, base.work[a].map((r) => r.workId).filter(Boolean)])) as Record<WorkArea, string[]>, [base]);

  const dirtyLogs = LOGS.filter((k) => logKey(logRows[k]) !== baseLogs[k]);
  const dirtyAreas = WORK_AREAS.filter((a) => workKey(workRows[a]) !== baseWork[a]);
  const dirty = dirtyLogs.length > 0 || dirtyAreas.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const go = (d: string) => {
    if (dirty && !window.confirm("Есть несохранённые записи. Уйти без сохранения?")) return;
    router.push(ghHref("/greenhouse/day", farm, { date: d, section, block }));
  };

  const blockInfo = (b: string) => blocks.find((x) => x.block === b);
  const logKind: LogKind | null = section === "people" ? null : (section as LogKind);
  const cycleFor = (kind: LogKind, b: string) => cycleOverride[`${kind}|${b}`] ?? logRows[kind].find((r) => r.block === b && r.cycle)?.cycle ?? String(blockInfo(b)?.cycle || "");

  const setBlockRows = (kind: LogKind, b: string) => (fn: (rows: LogRow[]) => LogRow[]) =>
    setLogRows((all) => {
      const mine = all[kind].filter((r) => r.block === b);
      const rest = all[kind].filter((r) => r.block !== b);
      return { ...all, [kind]: [...rest, ...fn(mine)] };
    });

  const changeCycle = (kind: LogKind, b: string, value: string) => {
    setCycleOverride((o) => ({ ...o, [`${kind}|${b}`]: value }));
    setLogRows((all) => ({ ...all, [kind]: all[kind].map((r) => (r.block === b ? { ...r, cycle: value } : r)) }));
  };

  // --- итоги для плиток ---
  const tile = (s: DaySection): { value: string; sub: string } => {
    if (s === "people") {
      const people = new Set<string>();
      let n = 0;
      for (const a of WORK_AREAS)
        for (const r of workRows[a]) {
          if (isEmptyWork(r)) continue;
          n += 1;
          people.add(r.employeeId || `n:${r.name}`);
        }
      return { value: people.size ? `${people.size} чел.` : "—", sub: n ? `${n} ${plural(n, "строка", "строки", "строк")}` : "не внесено" };
    }
    const rows = logRows[s as LogKind].filter((r) => !isEmptyLog(r));
    // В черенковании инвойс, факт и брак — разные вещи об одних черенках: складывать их в одно число нельзя.
    const qty = s === "cuttings" ? 0 : rows.reduce((t, r) => t + num(r.qty), 0);
    const bl = Array.from(new Set(rows.map((r) => r.block)));
    const names = bl.sort((a, b) => (Number(a) || 999) - (Number(b) || 999)).map((b) => (b === "—" ? "без блока" : b)).join(", ");
    if (s === "cuttings") return { value: rows.length ? `${rows.length} ${plural(rows.length, "запись", "записи", "записей")}` : "—", sub: bl.length ? `${bl.length === 1 ? "блок" : "блоки"} ${names}` : "не внесено" };
    return { value: qty ? `${n0(qty)} шт.` : "—", sub: bl.length ? `${bl.length === 1 ? "блок" : "блоки"} ${names}` : "не внесено" };
  };
  const sectionDirty = (s: DaySection) => (s === "people" ? dirtyAreas.length > 0 : dirtyLogs.includes(s as LogKind));

  // --- блоки для ленты ---
  const blockCount = (kind: LogKind, b: string) => logRows[kind].filter((r) => r.block === b && !isEmptyLog(r)).length;
  const blockDirty = (kind: LogKind, b: string) => logKey(logRows[kind].filter((r) => r.block === b)) !== logKey(base.logs[kind].filter((r) => r.block === b).map(toLogRow));
  const stripBlocks = useMemo(() => {
    if (!logKind) return blocks;
    const extra = Array.from(new Set(logRows[logKind].map((r) => r.block))).filter((b) => b && !blocks.some((x) => x.block === b));
    return [...blocks, ...extra.map((b) => ({ block: b, cycle: 0, status: "", statusLabel: "", varieties: [] }))];
  }, [blocks, logKind, logRows]);

  // Выбранный блок — всегда в видимой части ленты (на телефоне блок 10 иначе прячется за краем).
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>("[data-on='1']");
    if (strip && chip) strip.scrollLeft = Math.max(0, chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2);
  }, [block, section]);

  // --- сохранение ---
  async function onSave() {
    setMsg(null);
    for (const k of dirtyLogs) {
      const bad = logRows[k].find((r) => logProblem(k, r, date, today, varieties));
      if (bad) {
        setSection(k);
        setBlock(bad.block);
        setMsg({ ok: false, text: `${DAY_SECTION_LABELS[k]}, ${blockName(bad.block).toLowerCase()}: ${logProblem(k, bad, date, today, varieties)}.` });
        return;
      }
    }
    for (const a of dirtyAreas) {
      const problems = workProblems(a, workRows[a]);
      if (problems.size) {
        setSection("people");
        setArea(a);
        setMsg({ ok: false, text: `Выработка, ${work?.areaLabels[a] ?? a}: ${Array.from(problems.values())[0]}.` });
        return;
      }
    }
    const payload: DayPayload = { logs: {}, work: {} };
    for (const k of dirtyLogs)
      payload.logs![k] = {
        rows: logRows[k].filter((r) => !isEmptyLog(r)).map((r) => ({ id: r.id, date, cycle: r.cycle, block: r.block, variety: r.variety, kind: r.kind, qty: r.qty, weightKg: r.weightKg, part: r.part, line: r.line, note: r.note })),
        known: knownLogs[k],
      };
    for (const a of dirtyAreas)
      payload.work![a] = {
        rows: workRows[a].filter((r) => !isEmptyWork(r)).map(({ uid: _u, ...r }) => r),
        known: knownWork[a],
      };
    setBusy(true);
    try {
      const res = unwrapValue(await save(farm, date, payload)) as { added: number; changed: number; removed: number; logs: Record<LogKind, DayLogRow[]>; work: Record<WorkArea, DayWorkRow[]> | null };
      const parts = [res.added ? `добавлено ${res.added}` : "", res.changed ? `изменено ${res.changed}` : "", res.removed ? `удалено ${res.removed}` : ""].filter(Boolean);
      const next = { logs: res.logs, work: res.work ?? base.work };
      const rows = fromBase(next);
      setBase(next);
      setLogRows(rows.logs);
      // Участки, которые не сохраняли, остаются как были на экране (их и не меняли).
      if (res.work) setWorkRows(rows.work);
      setCycleOverride({});
      setMsg({ ok: true, text: parts.length ? `День сохранён: ${parts.join(", ")}.` : "Изменений не было." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не получилось сохранить." });
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    if (!window.confirm("Отменить все несохранённые правки этого дня?")) return;
    const rows = fromBase(base);
    setLogRows(rows.logs);
    setWorkRows(rows.work);
    setCycleOverride({});
    setMsg(null);
  };

  const isToday = date === today;
  const longDate = new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const dirtyNames = [...dirtyLogs.map((k) => DAY_SECTION_LABELS[k]), ...(dirtyAreas.length ? [DAY_SECTION_LABELS.people] : [])];
  const info = blockInfo(block);

  return (
    <div className="space-y-4 pb-24">
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
          Все записи за день →
        </Link>
      </div>

      {/* Что вносим */}
      <div className={clsx("grid gap-2.5", sections.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : sections.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1")}>
        {sections.map((s) => {
          const t = tile(s);
          const on = s === section;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={clsx(
                "relative text-left rounded-2xl border p-3.5 sm:p-4 transition-all",
                on ? "border-section-greenhouse bg-section-greenhouse-soft shadow-card ring-1 ring-section-greenhouse/30" : "border-line-hairline bg-surface hover:border-section-greenhouse/40 hover:bg-surface-plane",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={clsx("w-8 h-8 rounded-lg grid place-items-center flex-none", on ? "bg-section-greenhouse text-white" : "bg-section-greenhouse-soft text-section-greenhouse")}>
                  <Icon name={SECTION_ICON[s]} className="w-4 h-4" />
                </span>
                <span className="font-medium text-[15px]">{DAY_SECTION_LABELS[s]}</span>
                {sectionDirty(s) && <span className="ml-auto w-2 h-2 rounded-full bg-[#d9902b]" title="Не сохранено" />}
              </div>
              <div className="font-display font-extrabold text-[22px] tabular-nums mt-2 leading-none">{t.value}</div>
              <div className="text-xs text-ink-muted mt-1 truncate">{t.value === "—" ? SECTION_HINT[s] : t.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Блоки — для срезки, брака и черенкования */}
      {logKind && (
        <div>
          <div className="text-xs text-ink-muted mb-1.5">Блок</div>
          <div ref={stripRef} className="relative flex gap-1.5 overflow-x-auto scroll-x-hidden -mx-1 px-1 pb-1">
            {stripBlocks.map((b) => {
              const on = b.block === block;
              const n = blockCount(logKind, b.block);
              const changed = blockDirty(logKind, b.block);
              return (
                <button
                  key={b.block}
                  type="button"
                  data-on={on ? "1" : undefined}
                  onClick={() => setBlock(b.block)}
                  className={clsx(
                    "relative flex-none min-w-[4.25rem] rounded-xl border px-2.5 pt-1.5 pb-1 text-left transition-colors",
                    on ? "bg-section-greenhouse border-section-greenhouse text-white" : "bg-surface border-line-hairline hover:border-section-greenhouse/40",
                  )}
                >
                  <div className="flex items-baseline gap-1">
                    <span className="font-display font-extrabold text-[17px] leading-tight">{/^\d+$/.test(b.block) ? b.block : b.block === "—" ? "—" : b.block}</span>
                    {n > 0 && <span className={clsx("text-[11px] tabular-nums rounded-full px-1.5", on ? "bg-white/20" : "bg-section-greenhouse-soft text-section-greenhouse")}>{n}</span>}
                  </div>
                  <div className={clsx("text-[10.5px] whitespace-nowrap", on ? "text-white/80" : b.status === "harvest" ? "text-[#1f6b3a] font-medium" : "text-ink-muted")}>
                    {b.statusLabel || (b.cycle ? `ц. ${b.cycle}` : " ")}
                  </div>
                  {changed && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#d9902b]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Строки */}
      {logKind && block && (
        <div className="card !p-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-3 border-b border-line-hairline bg-surface-plane/50">
            <h2 className="font-display font-extrabold text-[17px]">
              {DAY_SECTION_LABELS[logKind]} · {blockName(block)}
            </h2>
            <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
              цикл
              <input className="input !py-1 !h-8 !w-16 text-center tabular-nums" inputMode="numeric" value={cycleFor(logKind, block)} disabled={!canLogs} onChange={(e) => changeCycle(logKind, block, e.target.value.replace(/\D/g, ""))} />
            </label>
            {info?.cycle && cycleFor(logKind, block) !== String(info.cycle) && (
              <button type="button" className="text-xs underline text-ink-muted" onClick={() => changeCycle(logKind, block, String(info.cycle))}>
                текущий — {info.cycle}
              </button>
            )}
            {info?.statusLabel && <span className="text-xs text-ink-muted">{info.statusLabel}</span>}
          </div>
          <LogRowsEditor
            key={`${logKind}-${block}`}
            log={logKind}
            rows={logRows[logKind].filter((r) => r.block === block)}
            setRows={setBlockRows(logKind, block)}
            block={block}
            cycle={cycleFor(logKind, block)}
            blockVarieties={info?.varieties ?? []}
            varieties={varieties}
            kinds={kinds[logKind]}
            date={date}
            today={today}
            canEdit={canLogs}
          />
        </div>
      )}

      {/* Выработка */}
      {section === "people" && work && (
        <div className="card !p-0 overflow-hidden">
          <div className="flex gap-1.5 overflow-x-auto scroll-x-hidden px-3 sm:px-4 py-3 border-b border-line-hairline bg-surface-plane/50">
            {WORK_AREAS.map((a) => {
              const on = a === area;
              const n = workRows[a].filter((r) => !isEmptyWork(r)).length;
              const changed = dirtyAreas.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setArea(a)}
                  className={clsx(
                    "relative h-9 px-3.5 rounded-full text-sm whitespace-nowrap inline-flex items-center gap-2 transition-colors",
                    on ? "bg-section-greenhouse text-white font-medium" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane",
                  )}
                >
                  {work.areaLabels[a]}
                  <span className={clsx("text-xs tabular-nums", on ? "text-white/75" : n ? "text-section-greenhouse font-semibold" : "text-ink-muted")}>{n || "—"}</span>
                  {changed && <span className="w-1.5 h-1.5 rounded-full bg-[#d9902b]" />}
                </button>
              );
            })}
          </div>
          <WorkRowsEditor
            key={area}
            area={area}
            rows={workRows[area]}
            setRows={(fn) => setWorkRows((all) => ({ ...all, [area]: fn(all[area]) }))}
            people={work.people}
            recent={work.areas[area].recent}
            crew={work.areas[area].crew}
            blocks={work.blocks}
            defaultBlock={block}
            canEdit={canWork}
          />
          <WorkTotals area={area} rows={workRows[area]} />
        </div>
      )}

      {msg && !dirty && <div className={clsx("text-sm", msg.ok ? "text-status-good" : "text-[#a12b2b]")}>{msg.text}</div>}

      {/* Сохранить день — одной кнопкой */}
      {(dirty || busy) && (
        <div className="no-print fixed inset-x-0 lg:left-[248px] bottom-4 sm:bottom-5 z-30 flex justify-center px-3 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-2xl flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line-hairline bg-surface px-4 py-3 shadow-card-hover">
            <div className="min-w-0 mr-auto">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#d9902b]" /> Не сохранено
              </div>
              <div className="text-xs text-ink-muted truncate">{dirtyNames.join(" · ")}</div>
              {msg && !msg.ok && <div className="text-xs text-[#a12b2b] mt-0.5">{msg.text}</div>}
            </div>
            <button type="button" className="btn !py-2 text-ink-secondary" onClick={reset} disabled={busy}>
              Отменить
            </button>
            <button type="button" className="btn-primary !py-2 !px-5" onClick={onSave} disabled={busy}>
              {busy ? "Сохраняю…" : "Сохранить день"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkTotals({ area, rows }: { area: WorkArea; rows: WorkRow[] }) {
  const filled = rows.filter((r) => !isEmptyWork(r));
  if (!filled.length) return null;
  const qty = filled.reduce((t, r) => t + num(r.qty), 0);
  const hours = filled.reduce((t, r) => t + num(r.hours), 0);
  const people = new Set(filled.map((r) => r.employeeId || r.name)).size;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 px-3 sm:px-4 py-2.5 border-t border-line-hairline text-sm text-ink-secondary">
      <span>
        <b className="text-ink-primary tabular-nums">{people}</b> {plural(people, "человек", "человека", "человек")}
      </span>
      {area !== "prep" && qty > 0 && (
        <span>
          <b className="text-ink-primary tabular-nums">{n0(qty)}</b> шт.
        </span>
      )}
      {hours > 0 && (
        <span>
          <b className="text-ink-primary tabular-nums">{hours.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}</b> ч
          {qty > 0 && area !== "prep" && <span className="text-ink-muted"> · {n0(qty / hours)} шт/ч</span>}
        </span>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
