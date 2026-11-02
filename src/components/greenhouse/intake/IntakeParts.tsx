import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import {
  INTAKE_FLOWER_LABELS,
  INTAKE_GRADE_COLORS,
  INTAKE_SPECS,
  changePct,
  gradeLabel,
  gradeShort,
  type DayStats,
  type GradeQty,
  type IntakeFlower,
  type IntakeStats,
  type ReasonStats,
  type VarietyStats,
} from "@/lib/greenhouse/intake";

/**
 * Кирпичи страниц приёмки Rose Farm без состояния (рисует сервер). Цвет цветка — только полоской и точкой, как везде:
 * означать что-то должны длины (темнее — длиннее) и брак (красный от 5 %).
 */

export const FLOWER_HEX: Record<IntakeFlower, string> = { rose: "#c2557a", eustoma: "#6b5ec4", chrysanthemum: "#2f7d94" };

export const n0 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("ru-RU"));
export const p1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`);
export const p0 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${Math.round(v)} %`);
const d1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }));

export function rejectTone(pct: number | null): string {
  if (pct === null) return "text-ink-muted";
  if (pct >= 5) return "text-[#a12b2b] font-semibold";
  if (pct >= 2.5) return "text-[#8a5a00]";
  return "text-ink-primary";
}

/** Длины/категории одной полосой. */
export function GradeStrip({ grades, height = "h-2.5", className }: { grades: GradeQty[]; height?: string; className?: string }) {
  const total = grades.reduce((s, g) => s + g.qty, 0);
  if (!total) return <div className={clsx(height, "rounded-full bg-surface-sunk", className)} />;
  return (
    <div className={clsx("flex rounded-full overflow-hidden bg-surface-sunk", height, className)}>
      {grades.map((g) => (
        <div key={g.grade} style={{ width: `${(g.qty * 100) / total}%`, background: INTAKE_GRADE_COLORS[g.grade] ?? "#bbb" }} title={`${g.grade}: ${n0(g.qty)} шт. (${Math.round((g.qty * 100) / total)} %)`} />
      ))}
    </div>
  );
}

/** Структура приёмки: длина/категория строкой — полоса, штук, доля. */
export function GradeRows({ flower, grades }: { flower: IntakeFlower; grades: GradeQty[] }) {
  const total = grades.reduce((s, g) => s + g.qty, 0);
  const max = Math.max(1, ...grades.map((g) => g.qty));
  if (!total) return <div className="text-sm text-ink-muted">Ничего не принято.</div>;
  return (
    <div className="space-y-1">
      {grades.map((g) => (
        <div key={g.grade} className="grid grid-cols-[5.5rem_1fr_4.5rem_2.75rem] sm:grid-cols-[7rem_1fr_5rem_3rem] items-center gap-2 text-sm">
          <span className="truncate text-ink-secondary">{gradeLabel(flower, g.grade)}</span>
          <div className="h-2 rounded-full bg-surface-sunk overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(g.qty * 100) / max}%`, background: INTAKE_GRADE_COLORS[g.grade] ?? "#bbb" }} />
          </div>
          <span className="text-right tabular-nums font-medium">{n0(g.qty)}</span>
          <span className="text-right tabular-nums text-xs text-ink-muted">{Math.round((g.qty * 100) / total)} %</span>
        </div>
      ))}
    </div>
  );
}

export function Delta({ now, before, invert, points }: { now: number | null; before: number | null; invert?: boolean; points?: boolean }) {
  if (now === null || before === null) return null;
  const v = points ? now - before : changePct(now, before);
  if (v === null || !Number.isFinite(v)) return null;
  if (Math.abs(v) < (points ? 0.3 : 1)) return <span className="text-[11px] text-ink-muted">≈ как было</span>;
  if (!points && Math.abs(v) > 200) return <span className="text-[11px] text-ink-muted">было {n0(before)}</span>;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={clsx("text-[11px] font-medium whitespace-nowrap", good ? "text-[#1f6b3a]" : "text-[#a12b2b]")}>
      {v > 0 ? "▲" : "▼"} {points ? `${Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} п.` : `${Math.round(Math.abs(v))} %`}
    </span>
  );
}

/** Карточка цветка: сколько принято, структура, брак и характеристики — с изменением к прошлому периоду. */
export function FlowerCard({ flower, now, prev, prevLabel, href }: { flower: IntakeFlower; now: IntakeStats; prev: IntakeStats | null; prevLabel?: string; href?: string }) {
  const spec = INTAKE_SPECS[flower];
  const topLabel = flower === "rose" ? "80 см и длиннее" : flower === "chrysanthemum" ? "Высшая" : "Стандарт";
  const facts: { label: string; value: string; delta?: ReactNode }[] = [];
  if (flower === "rose") facts.push({ label: "Средняя длина", value: now.avgLength ? `${Math.round(now.avgLength)} см` : "—", delta: <Delta now={now.avgLength} before={prev?.avgLength ?? null} points /> });
  facts.push({ label: topLabel, value: p0(now.topPct), delta: <Delta now={now.topPct} before={prev?.topPct ?? null} points /> });
  if (spec.more.length) facts.push({ label: flower === "rose" ? "2 сорт и B" : "Нераскрывшийся", value: p0(now.secondPct), delta: <Delta now={now.secondPct} before={prev?.secondPct ?? null} points invert /> });
  for (const m of spec.measures) {
    const v = now.measures[m.key];
    facts.push({ label: m.label, value: v === null ? "—" : `${d1(v)} ${m.unit}`, delta: <Delta now={v} before={prev?.measures[m.key] ?? null} points={false} /> });
  }
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: FLOWER_HEX[flower] }} />
        <span className="font-display font-extrabold text-[16px]">{INTAKE_FLOWER_LABELS[flower]}</span>
        {flower === "chrysanthemum" && <span className="text-[11px] text-ink-muted">своя, Rose Farm</span>}
      </div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="font-display font-extrabold text-[26px] tabular-nums leading-none">{n0(now.accepted)}</span>
        <span className="text-sm text-ink-muted">шт.</span>
        {prev && <Delta now={now.accepted} before={prev.accepted} />}
      </div>
      <GradeStrip grades={now.byGrade} className="mt-3" />
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[10.5px] text-ink-muted">
        {now.byGrade.slice(0, 9).map((g) => (
          <span key={g.grade} className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: INTAKE_GRADE_COLORS[g.grade] ?? "#bbb" }} />
            {gradeShort(g.grade)} {Math.round((g.qty * 100) / Math.max(1, now.accepted))}%
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-sm">
        <div>
          <div className="text-[11px] text-ink-muted">Брак</div>
          <div className={clsx("tabular-nums", rejectTone(now.rejectPct))}>
            {p1(now.rejectPct)} <span className="text-xs text-ink-muted font-normal">· {n0(now.rejected)} шт.</span>
          </div>
          <Delta now={now.rejectPct} before={prev?.rejectPct ?? null} points invert />
        </div>
        {facts.map((f) => (
          <div key={f.label}>
            <div className="text-[11px] text-ink-muted truncate">{f.label}</div>
            <div className="tabular-nums font-medium">{f.value}</div>
            {f.delta}
          </div>
        ))}
      </div>
      {prevLabel && prev && <div className="text-[10.5px] text-ink-muted mt-2">▲▼ — к {prevLabel}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card block hover:border-section-greenhouse/40 transition-colors">
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}

/** Приёмка по дням столбиками по цветкам; день без приёмки — пустое место, а не схлопнутый столбик. */
export function DayBars({ days, height = 120, hrefFor }: { days: DayStats[]; height?: number; hrefFor?: (date: string) => string }) {
  const max = Math.max(1, ...days.map((d) => d.accepted + d.rejected));
  const many = days.length > 31;
  return (
    <div>
      <div className="flex items-end gap-[2px] sm:gap-1" style={{ height }}>
        {days.map((d) => {
          const total = d.accepted + d.rejected;
          const bar = (
            <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: `${(total * 100) / max}%` }}>
              {(["rose", "eustoma", "chrysanthemum"] as IntakeFlower[]).map((f) => (d.byFlower[f] ? <div key={f} style={{ height: `${(d.byFlower[f] * 100) / total}%`, background: FLOWER_HEX[f] }} /> : null))}
              {d.rejected ? <div style={{ height: `${(d.rejected * 100) / total}%`, background: "#e3a39b" }} /> : null}
            </div>
          );
          const title = `${d.date.split("-").reverse().join(".")}: принято ${n0(d.accepted)}${d.rejected ? `, брак ${n0(d.rejected)}` : ""}`;
          return hrefFor && total ? (
            <Link key={d.date} href={hrefFor(d.date)} className="flex-1 h-full flex items-end hover:opacity-80" title={title}>
              {bar}
            </Link>
          ) : (
            <div key={d.date} className="flex-1 h-full flex items-end" title={title}>
              {total ? bar : <div className="w-full h-[2px] bg-surface-sunk rounded" />}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px] sm:gap-1 mt-1 text-[9.5px] text-ink-muted tabular-nums">
        {days.map((d, i) => (
          <div key={d.date} className="flex-1 text-center overflow-hidden">
            {!many || i % 7 === 0 || i === days.length - 1 ? String(Number(d.date.slice(8, 10))) : ""}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-ink-secondary">
        {(["rose", "eustoma", "chrysanthemum"] as IntakeFlower[])
          .filter((f) => days.some((d) => d.byFlower[f]))
          .map((f) => (
            <span key={f} className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FLOWER_HEX[f] }} />
              {INTAKE_FLOWER_LABELS[f]}
            </span>
          ))}
        {days.some((d) => d.rejected) && (
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#e3a39b" }} />
            брак
          </span>
        )}
      </div>
    </div>
  );
}

/** Сорта: штук, доля, длина/высшая, брак и характеристики. На телефоне — компактный список. */
export function VarietyTable({ rows, hrefFor }: { rows: VarietyStats[]; hrefFor?: (v: VarietyStats) => string }) {
  if (!rows.length) return <div className="text-sm text-ink-muted">Нет данных.</div>;
  const mixed = new Set(rows.map((r) => r.flower)).size > 1;
  const name = (r: VarietyStats) => (hrefFor ? <Link href={hrefFor(r)} className="hover:underline">{r.variety}</Link> : r.variety);
  const quality = (r: VarietyStats) => (r.flower === "rose" ? (r.avgLength ? `${Math.round(r.avgLength)} см` : "—") : p0(r.topPct));
  const measure = (r: VarietyStats) => {
    const m = INTAKE_SPECS[r.flower].measures.find((x) => x.key !== "stemG");
    const v = m ? r.measures[m.key] : null;
    return m && v !== null ? `${d1(v)} ${m.unit === "шт." ? "" : m.unit}`.trim() : "—";
  };
  return (
    <>
      <table className="hidden sm:table w-full text-sm">
        <thead>
          <tr className="text-[11px] text-ink-muted border-b border-line-hairline">
            <th className="text-left font-medium py-2 pr-2">Сорт</th>
            <th className="text-right font-medium py-2 px-2">Принято</th>
            <th className="text-right font-medium py-2 px-2">Доля</th>
            <th className="font-medium py-2 px-2 w-[24%]">Длина / категория</th>
            <th className="text-right font-medium py-2 px-2" title="Роза — средняя длина; эустома и хризантема — доля высшей">
              Длина · высш.
            </th>
            <th className="text-right font-medium py-2 px-2">Брак</th>
            <th className="text-right font-medium py-2 px-2">Вес стебля</th>
            <th className="text-right font-medium py-2 pl-2" title="Роза — высота бутона; эустома — бутонов, хризантема — цветков на стебле">
              Бутон
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.flower}|${r.variety}`} className="border-b border-line-hairline/60">
              <td className="py-1.5 pr-2">
                <span className="inline-flex items-center gap-1.5">
                  {mixed && <span className="w-2 h-2 rounded-full flex-none" style={{ background: FLOWER_HEX[r.flower] }} />}
                  <span className="font-medium">{name(r)}</span>
                </span>
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{n0(r.accepted)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-ink-secondary">{p0(r.share)}</td>
              <td className="py-1.5 px-2">
                <GradeStrip grades={r.byGrade} height="h-2" />
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">{quality(r)}</td>
              <td className={clsx("py-1.5 px-2 text-right tabular-nums", rejectTone(r.rejectPct))}>{r.rejected ? p1(r.rejectPct) : "—"}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{r.measures.stemG === null ? "—" : `${Math.round(r.measures.stemG)} г`}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{measure(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sm:hidden divide-y divide-line-hairline/70">
        {rows.map((r) => (
          <div key={`${r.flower}|${r.variety}`} className="py-2">
            <div className="flex items-baseline gap-2">
              {mixed && <span className="w-2 h-2 rounded-full flex-none self-center" style={{ background: FLOWER_HEX[r.flower] }} />}
              <span className="font-medium truncate">{name(r)}</span>
              <span className="ml-auto tabular-nums font-semibold">{n0(r.accepted)}</span>
              <span className="tabular-nums text-xs text-ink-muted w-9 text-right">{p0(r.share)}</span>
            </div>
            <GradeStrip grades={r.byGrade} height="h-1.5" className="mt-1.5" />
            <div className="flex flex-wrap gap-x-3 text-[11px] text-ink-secondary mt-1">
              <span>{r.flower === "rose" ? "длина" : "высш."} {quality(r)}</span>
              <span className={rejectTone(r.rejectPct)}>брак {r.rejected ? p1(r.rejectPct) : "—"}</span>
              {r.measures.stemG !== null && <span>{Math.round(r.measures.stemG)} г</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function ReasonRows({ reasons }: { reasons: ReasonStats[] }) {
  if (!reasons.length) return <div className="text-sm text-ink-muted">Брака не было.</div>;
  const max = Math.max(1, ...reasons.map((r) => r.qty));
  return (
    <div className="space-y-1">
      {reasons.map((r) => (
        <div key={r.reason} className="grid grid-cols-[1fr_5rem_4rem_2.75rem] sm:grid-cols-[14rem_1fr_5rem_3rem] items-center gap-2 text-sm">
          <span className="truncate text-ink-secondary col-span-4 sm:col-span-1">{r.label}</span>
          <div className="h-2 rounded-full bg-surface-sunk overflow-hidden col-span-2 sm:col-span-1">
            <div className="h-full rounded-full bg-[#d9776b]" style={{ width: `${(r.qty * 100) / max}%` }} />
          </div>
          <span className="text-right tabular-nums font-medium">{n0(r.qty)}</span>
          <span className="text-right tabular-nums text-xs text-ink-muted">{Math.round(r.share)} %</span>
        </div>
      ))}
    </div>
  );
}

export function FlowerChips({ value, hrefFor, flowers }: { value: IntakeFlower | ""; hrefFor: (f: IntakeFlower | "") => string; flowers: IntakeFlower[] }) {
  const chip = (on: boolean) => clsx("text-xs px-3 py-1.5 rounded-full border whitespace-nowrap", on ? "bg-section-greenhouse text-white border-section-greenhouse" : "border-line-hairline bg-surface hover:bg-surface-plane");
  return (
    <>
      <Link href={hrefFor("")} className={chip(!value)}>
        Все цветы
      </Link>
      {flowers.map((f) => (
        <Link key={f} href={hrefFor(f)} className={chip(value === f)}>
          {INTAKE_FLOWER_LABELS[f]}
        </Link>
      ))}
    </>
  );
}
