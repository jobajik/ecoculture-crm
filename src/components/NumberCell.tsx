"use client";

/**
 * Поле для ввода количества или суммы.
 *
 * Цифры разделяются пробелами прямо при наборе: план на месяц — это шесть-семь
 * знаков, и «6000000» глазом от «600000» не отличить, а «6 000 000» отличить
 * можно. Хранится всё равно число.
 */
export function formatNumber(value: number): string {
  if (!value) return "";
  return value.toLocaleString("ru-RU").replace(/ /g, " ");
}

export function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const value = Number(digits);
  return Number.isFinite(value) ? value : 0;
}

export default function NumberCell({
  value,
  onChange,
  disabled,
  suffix,
  ariaLabel,
  className = "",
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  /** Показывается справа в поле: «шт», «₸». */
  suffix?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        disabled={disabled}
        value={formatNumber(value)}
        placeholder="0"
        onChange={(e) => onChange(parseNumber(e.target.value))}
        onFocus={(e) => e.target.select()}
        className={`input text-right tabular-nums disabled:opacity-60 ${
          suffix ? "pr-8" : ""
        } ${className}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">
          {suffix}
        </span>
      )}
    </div>
  );
}
