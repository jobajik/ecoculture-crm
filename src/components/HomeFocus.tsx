import Link from "next/link";
import clsx from "clsx";
import type { HomeFocus as Focus } from "@/lib/homeFocus";

/**
 * Блок «что у вас сегодня» в начале главной.
 *
 * Рисует то, что посчитала чистая функция `homeFocus()`. Своей логики здесь нет
 * намеренно: цифры, по которым человек принимает решение, должны проверяться
 * тестом, а не глазами на боевых данных.
 */
const TONE: Record<string, string> = {
  default: "text-ink-primary",
  good: "text-status-good",
  warn: "text-[#8a5a00]",
  critical: "text-status-critical",
};

export default function HomeFocusBoard({ focus }: { focus: Focus }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold">{focus.title}</h2>
          <p className="text-sm text-ink-secondary">{focus.subtitle}</p>
        </div>
        {focus.action && (
          <Link href={focus.action.href} className="btn-primary">
            {focus.action.label}
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {focus.stats.map((s) => {
          const body = (
            <>
              <div className="text-xs text-ink-secondary mb-1">{s.label}</div>
              <div className={clsx("text-2xl font-semibold tabular-nums", TONE[s.tone ?? "default"])}>
                {s.value}
              </div>
              {s.hint && <div className="text-xs text-ink-muted mt-1">{s.hint}</div>}
            </>
          );
          return s.href ? (
            <Link
              key={s.label}
              href={s.href}
              className="card !p-4 hover:shadow-md transition-shadow"
            >
              {body}
            </Link>
          ) : (
            <div key={s.label} className="card !p-4">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
