"use client";

import clsx from "clsx";
import type { PlanWeek } from "@/lib/constants";

/**
 * Переключатель недель внутри месяца.
 *
 * Под каждой неделей — её собственная цифра: сколько уже вбито. Это главное,
 * ради чего кнопки, а не выпадающий список: заполняя месяц понедельно, легко
 * пропустить неделю, и пустая подпись сразу видна, не заходя внутрь.
 */
export default function WeekTabs({
  weeks,
  active,
  onSelect,
  /** Подпись под номером недели: обычно «12 000 шт» или «не заполнено». */
  summary,
  disabled,
}: {
  weeks: PlanWeek[];
  active: string;
  onSelect: (code: string) => void;
  summary?: (week: PlanWeek) => { text: string; warn?: boolean };
  disabled?: boolean;
}) {
  if (weeks.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {weeks.map((week) => {
        const isActive = week.code === active;
        const info = summary?.(week);
        return (
          <button
            key={week.code}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(week.code)}
            className={clsx(
              "rounded-xl border px-3.5 py-2 text-left transition-colors disabled:opacity-50",
              isActive
                ? "border-accent bg-accent-soft"
                : "border-line-hairline bg-surface hover:bg-surface-plane"
            )}
          >
            <div className={clsx("text-sm font-medium", isActive && "text-accent")}>
              Неделя {week.index}
            </div>
            <div className="text-xs text-ink-muted">
              {week.shortLabel}
              {week.days < 7 && <span className="ml-1">· {week.days} дн.</span>}
            </div>
            {info && (
              <div
                className={clsx(
                  "text-xs tabular-nums mt-0.5",
                  info.warn ? "text-status-critical" : "text-ink-secondary"
                )}
              >
                {info.text}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
