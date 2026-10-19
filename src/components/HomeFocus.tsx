import Link from "next/link";
import clsx from "clsx";
import Hint from "@/components/Hint";
import type { HomeFocus as Focus } from "@/lib/homeFocus";

/**
 * Блок «что у вас сегодня» в начале главной.
 *
 * Рисует то, что посчитала чистая функция `homeFocus()`. Своей логики здесь нет
 * намеренно: цифры, по которым человек принимает решение, должны проверяться
 * тестом, а не глазами на боевых данных.
 *
 * Каждая плитка и каждая строка «Требует внимания» — ссылка на УЖЕ
 * отфильтрованный список (`/orders?stage=late`), а не на общий: иначе цифра
 * «опаздывают: 5» вела бы к списку из двухсот заявок, и эти пять пришлось бы
 * искать глазами.
 */
const TONE: Record<string, string> = {
  default: "text-ink-primary",
  good: "text-status-good",
  warn: "text-[#8a5a00]",
  critical: "text-status-critical",
};

export default function HomeFocusBoard({ focus }: { focus: Focus }) {
  const attention = focus.attention ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {focus.title}
          {focus.subtitle && <Hint>{focus.subtitle}</Hint>}
        </h2>
        {focus.action && (
          <Link href={focus.action.href} className="btn-primary">
            {focus.action.label}
          </Link>
        )}
      </div>

      {attention.length > 0 && (
        <ul className="card !p-0 divide-y divide-line-hairline">
          {attention.map((a) => (
            <li key={a.label}>
              <Link
                href={a.href}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-plane transition-colors"
              >
                <span
                  aria-hidden
                  className={clsx(
                    "w-2 h-2 rounded-full shrink-0",
                    a.tone === "critical" ? "bg-status-critical" : "bg-status-warning"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-sm">{a.label}</span>
                  <span className="block text-xs text-ink-secondary">{a.detail}</span>
                </span>
                <span aria-hidden className="text-ink-muted">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {focus.stats.map((s) => {
          const body = (
            <>
              <div className="text-xs text-ink-secondary mb-1">{s.label}</div>
              <div className={clsx("font-display text-2xl font-extrabold tabular-nums", TONE[s.tone ?? "default"])}>
                {s.value}
              </div>
              {s.hint && <div className="text-xs text-ink-muted mt-1">{s.hint}</div>}
            </>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="card !p-4 hover:shadow-md transition-shadow">
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

/** Плитки главной (новый вид, 19.10.2026): одна строка цифр своей работы. */
export function HomeStats({ focus }: { focus: Focus }) {
  if (focus.stats.length === 0) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {focus.stats.map((s) => {
        const body = (
          <>
            <div className="text-xs text-ink-muted mb-1.5">{s.label}</div>
            <div className={clsx("font-display text-[22px] sm:text-[26px] leading-none font-extrabold tabular-nums", TONE[s.tone ?? "default"])}>
              {s.value}
            </div>
            {s.hint && <div className="text-xs text-ink-secondary mt-2">{s.hint}</div>}
          </>
        );
        return s.href ? (
          <Link key={s.label} href={s.href} className="card !p-4 sm:!p-5 hover:shadow-card-hover transition-shadow">
            {body}
          </Link>
        ) : (
          <div key={s.label} className="card !p-4 sm:!p-5">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** «Требует внимания» — карточкой рядом со складом, каждая строка ведёт в отфильтрованный список. */
export function HomeAttention({ focus }: { focus: Focus }) {
  const attention = focus.attention ?? [];
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-line-hairline">
        <h2 className="font-display text-[15px] font-bold">{focus.title}</h2>
        {focus.subtitle && <Hint>{focus.subtitle}</Hint>}
      </div>
      {attention.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-muted">Всё спокойно — срочного нет.</p>
      ) : (
        <ul className="divide-y divide-line-hairline">
          {attention.map((a) => (
            <li key={a.label}>
              <Link href={a.href} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-plane transition-colors">
                <span
                  aria-hidden
                  className={clsx("w-2 h-2 rounded-full shrink-0", a.tone === "critical" ? "bg-status-critical" : "bg-status-warning")}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-sm">{a.label}</span>
                  <span className="block text-xs text-ink-secondary">{a.detail}</span>
                </span>
                <span aria-hidden className="text-ink-muted">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Одна строка над складом — у зав. складом (`focus.strip`). */
export function HomeFocusStrip({ focus }: { focus: Focus }) {
  if (!focus.strip) return null;
  return (
    <Link
      href={focus.strip.href}
      className={clsx(
        "card !py-3 flex items-center justify-between gap-3 text-sm font-medium hover:shadow-md transition-shadow",
        focus.strip.tone === "critical" && "border-status-critical/40 text-status-critical"
      )}
    >
      <span>{focus.strip.text}</span>
      <span className="text-series-1 whitespace-nowrap">Очередь →</span>
    </Link>
  );
}
