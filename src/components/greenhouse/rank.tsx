import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { GRADE_COLORS, type QualitySplit, type RankRow } from "@/lib/greenhouse/views";
import { num } from "./parts";

/**
 * Простые блоки «Теплицы» без состояния: рейтинг строками с полосой, качество тремя группами, изменение к прошлому.
 * Без "use client" — рисуют серверные страницы.
 */

export type RankMetric = "yield" | "top" | "weight";
export const RANK_METRICS: { key: RankMetric; label: string; unit: string }[] = [
  { key: "yield", label: "Выход", unit: "%" },
  { key: "top", label: "Высшая и 1-я", unit: "%" },
  { key: "weight", label: "Вес стебля", unit: "г" },
];

export function metricValue(r: RankRow, m: RankMetric): number | null {
  return m === "yield" ? r.yieldPct : m === "top" ? r.topShare : r.avgWeight;
}

/** Изменение в пунктах: зелёным лучше, красным хуже. */
export function Delta({ value, unit = "п.", invert, neutral, className }: { value: number | null; unit?: string; invert?: boolean; neutral?: boolean; className?: string }) {
  if (value === null) return null;
  const good = invert ? value < 0 : value > 0;
  const zero = Math.abs(value) < 0.5;
  return (
    <span className={clsx("text-xs font-semibold tabular-nums whitespace-nowrap", zero || neutral ? "text-ink-muted" : good ? "text-status-good" : "text-[#a12b2b]", className)}>
      {zero ? "≈" : value > 0 ? "▲" : "▼"} {Math.abs(Math.round(value))} {unit}
    </span>
  );
}

/** Качество срезки: три группы строками, а не стопка из девяти цветов. */
export function QualityRows({ split, prev, total }: { split: QualitySplit[]; prev?: QualitySplit[] | null; total: number }) {
  return (
    <div className="space-y-3">
      {split.map((q) => {
        const before = prev?.find((p) => p.key === q.key);
        return (
          <div key={q.key}>
            <div className="flex items-baseline gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-sm flex-none self-center" style={{ background: q.color }} />
              <span className="font-medium">{q.label}</span>
              <span className="ml-auto font-display font-extrabold text-[17px] tabular-nums">{Math.round(q.pct)} %</span>
              {before && total > 0 && <Delta value={q.pct - before.pct} invert={q.key === "low"} neutral={q.key === "mid"} className="w-12 text-right" />}
            </div>
            <div className="mt-1 h-2 rounded-full bg-surface-sunk overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${q.pct}%`, background: q.color }} />
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">{num(q.qty)} шт.</div>
          </div>
        );
      })}
    </div>
  );
}

/** Все категории списком — под «подробнее». */
export function GradeList({ grades }: { grades: { grade: string; qty: number }[] }) {
  const total = grades.reduce((s, g) => s + g.qty, 0);
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
      {grades.map((g) => (
        <div key={g.grade} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: GRADE_COLORS[g.grade] ?? "#bbb" }} />
          <span className="text-ink-secondary">{g.grade}</span>
          <span className="ml-auto tabular-nums">{num(g.qty)}</span>
          <span className="tabular-nums text-ink-muted w-9 text-right">{total ? Math.round((g.qty * 100) / total) : 0} %</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Рейтинг строками: место, имя, полоса по выбранной мере, значение и маленькая полоса качества. Лучший и отстающий
 * подсвечены. Строки без значения (идёт срезка, нет посадки) — внизу серым, с пометкой.
 */
export function RankList({
  rows,
  metric,
  href,
  limit,
  extra,
  compactRest,
}: {
  rows: RankRow[];
  metric: RankMetric;
  href?: (r: RankRow) => string | undefined;
  limit?: number;
  extra?: (r: RankRow) => ReactNode;
  /** Строки без значения — одной строкой списком имён, а не каждая отдельно. */
  compactRest?: string;
}) {
  const unit = RANK_METRICS.find((m) => m.key === metric)!.unit;
  const ranked = rows.filter((r) => metricValue(r, metric) !== null).sort((a, b) => metricValue(b, metric)! - metricValue(a, metric)!);
  const rest = rows.filter((r) => metricValue(r, metric) === null);
  const shown = limit ? ranked.slice(0, limit) : ranked;
  const values = ranked.map((r) => metricValue(r, metric)!);
  const max = Math.max(...values, 1);
  // Полосы начинаются не с нуля, а чуть ниже худшего: при выходе 70–88 % от нуля все полосы почти одинаковые.
  // Точное число стоит рядом, так что разницу видно, а не придумано.
  const lowest = Math.min(...values, max);
  const min = Math.max(0, Math.floor(lowest / 10) * 10 - 10);
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  const row = (r: RankRow, i: number | null) => {
    const v = metricValue(r, metric);
    const w = v === null ? 0 : Math.max(3, ((v - min) * 100) / (max - min || 1));
    const first = i === 0 && ranked.length > 2;
    const last = i !== null && i === ranked.length - 1 && ranked.length > 2;
    const link = href?.(r);
    const body = (
      <>
        <span className="w-5 text-[11px] text-ink-muted tabular-nums text-right">{i !== null ? i + 1 : ""}</span>
        <span className={clsx("w-36 sm:w-44 truncate text-sm", v === null && "text-ink-muted")}>{r.label}</span>
        <span className="flex-1 min-w-0">
          {v !== null ? (
            <span className="block h-2.5 rounded-full bg-surface-sunk overflow-hidden">
              <span className={clsx("block h-full rounded-full", first ? "bg-[#2f8a55]" : last ? "bg-[#d9826b]" : "bg-section-greenhouse/60")} style={{ width: `${w}%` }} />
            </span>
          ) : (
            <span className="text-xs text-ink-muted">{r.note}</span>
          )}
        </span>
        <span className="w-14 text-right font-display font-bold tabular-nums text-[15px]">{v !== null ? `${Math.round(v)}${unit === "%" ? " %" : " г"}` : ""}</span>
        {extra && <span className="hidden sm:block w-28 text-right text-xs text-ink-muted">{extra(r)}</span>}
      </>
    );
    return (
      <li key={r.key}>
        {link ? (
          <Link href={link} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-surface-plane">
            {body}
          </Link>
        ) : (
          <div className="flex items-center gap-3 py-1.5">{body}</div>
        )}
      </li>
    );
  };
  return (
    <div>
      <ul className="space-y-0.5">{shown.map((r, i) => row(r, i))}</ul>
      {rest.length > 0 &&
        (compactRest ? (
          <div className="mt-2 pt-2 border-t border-line-hairline text-xs text-ink-muted">
            {compactRest}: {rest.map((r) => r.label).join(", ")}.
          </div>
        ) : (
          <ul className="mt-2 pt-2 border-t border-line-hairline space-y-0.5">{rest.map((r) => row(r, null))}</ul>
        ))}
      {avg !== null && ranked.length > 2 && (
        <div className="text-[11px] text-ink-muted mt-2">
          Среднее — {Math.round(avg)}
          {unit === "%" ? " %" : " г"}.
        </div>
      )}
    </div>
  );
}

/** Выводы словами — короткий список сверху раздела. */
export function Insights({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="space-y-1.5">
      {lines.map((l) => (
        <li key={l} className="flex gap-2 text-sm">
          <span className="text-section-greenhouse mt-0.5">●</span>
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}
