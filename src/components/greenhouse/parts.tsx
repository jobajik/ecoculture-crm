import clsx from "clsx";
import type { ReactNode } from "react";
import type { BlockStatus } from "@/lib/greenhouse/production";
import { GRADE_COLORS, GRADE_SHORT, STATUS_TONE } from "@/lib/greenhouse/views";

/**
 * Мелкие кирпичи «Теплицы» без состояния (без "use client" — их рисуют и серверные страницы, и клиентские доски).
 */

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «16 янв», с годом — если не текущий: «16 янв 25». */
export function dm(iso: string, thisYear?: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  const base = `${Number(d)} ${MONTHS[Number(m) - 1]}`;
  return thisYear && y !== thisYear ? `${base} ${y.slice(2)}` : base;
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("ru-RU");
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 })} %`;
}

export function grams(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${Math.round(n)} г`;
}

export function StatusChip({ status, label, className }: { status: BlockStatus; label: string; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", STATUS_TONE[status], className)}>
      {status === "harvest" && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {label}
    </span>
  );
}

/** Полоска «срезано из посаженного». Больше 100 % — честно до края и красной отметкой (в книге бывает недоучёт посадки). */
export function YieldBar({ value, className }: { value: number | null; className?: string }) {
  const v = value ?? 0;
  const w = Math.max(0, Math.min(100, v));
  const tone = value === null ? "bg-line-hairline" : v > 100 ? "bg-[#c9584e]" : v >= 80 ? "bg-[#2f8a55]" : v >= 60 ? "bg-[#8cc56f]" : "bg-[#e2c14a]";
  return (
    <div className={clsx("h-1.5 rounded-full bg-surface-sunk overflow-hidden", className)}>
      <div className={clsx("h-full rounded-full", tone)} style={{ width: `${w}%` }} />
    </div>
  );
}

/** Стопка категорий срезки одной полосой. */
export function GradeBar({ grades, className, height = "h-2" }: { grades: { grade: string; qty: number }[]; className?: string; height?: string }) {
  const total = grades.reduce((s, g) => s + g.qty, 0);
  if (!total) return <div className={clsx(height, "rounded-full bg-surface-sunk", className)} />;
  return (
    <div className={clsx("flex rounded-full overflow-hidden bg-surface-sunk", height, className)}>
      {grades.map((g) => (
        <div key={g.grade} style={{ width: `${(g.qty * 100) / total}%`, background: GRADE_COLORS[g.grade] ?? "#bbb" }} title={`${g.grade}: ${num(g.qty)} шт. (${Math.round((g.qty * 100) / total)} %)`} />
      ))}
    </div>
  );
}

export function GradeLegend({ grades, className }: { grades: string[]; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-secondary", className)}>
      {grades.map((g) => (
        <span key={g} className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: GRADE_COLORS[g] ?? "#bbb" }} />
          {g}
        </span>
      ))}
    </div>
  );
}

export function gradeShort(g: string): string {
  return GRADE_SHORT[g] ?? g;
}

/** Цифра с подписью — для строк внутри карточек. */
export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={clsx("min-w-0", className)}>
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="font-display font-bold tabular-nums text-[15px] leading-tight mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-ink-secondary mt-0.5">{hint}</div>}
    </div>
  );
}

/** Заголовок блока страницы — тихий, без карточки. */
export function SectionTitle({ title, hint, actions }: { title: ReactNode; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
      <div className="mr-auto">
        <h2 className="font-display font-extrabold text-[17px] tracking-tight">{title}</h2>
        {hint && <div className="text-xs text-ink-muted mt-0.5">{hint}</div>}
      </div>
      {actions}
    </div>
  );
}
