"use client";

import clsx from "clsx";

/**
 * Фильтры кнопками со счётчиком (новый вид по прототипу владельца): выбранная — тёмная, остальные — белые с рамкой.
 * На телефоне ряд листается пальцем, на компьютере переносится.
 */
export interface ChipItem {
  value: string;
  label: string;
  count?: number;
  /** Счётчик красным — «опаздывают», «просрочено». */
  alarm?: boolean;
}

export default function Chips({
  items,
  value,
  onChange,
  className,
}: {
  items: ChipItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={clsx("flex gap-2 overflow-x-auto scroll-x-hidden lg:flex-wrap -mx-1 px-1", className)}>
      {items.map((c) => {
        const on = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            className={clsx(
              "h-9 sm:h-8 px-3 rounded-lg border text-[13px] whitespace-nowrap flex items-center gap-1.5 transition-colors flex-none",
              on ? "bg-accent-soft text-accent border-accent/25 font-medium" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary hover:border-line-strong"
            )}
          >
            {c.label}
            {c.count !== undefined && (
              <b className={clsx("font-medium tabular-nums", on ? "" : c.alarm && c.count > 0 ? "text-status-critical" : "text-ink-muted")}>
                {c.count.toLocaleString("ru-RU")}
              </b>
            )}
          </button>
        );
      })}
    </div>
  );
}
