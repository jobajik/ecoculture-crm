import Link from "next/link";
import clsx from "clsx";
import { canStepForward, isCurrentRange, stepAnchor, type StepPeriod } from "@/lib/periodNav";

const NOUN: Record<StepPeriod, [string, string]> = {
  day: ["Предыдущий день", "Следующий день"],
  week: ["Предыдущая неделя", "Следующая неделя"],
  month: ["Предыдущий месяц", "Следующий месяц"],
};
const BACK: Record<StepPeriod, string> = { day: "к сегодня", week: "к текущей неделе", month: "к текущему месяцу" };

/**
 * ‹ сентябрь 2026 › — листание показанного дня, недели или месяца. Ссылки, а не
 * кнопки: период живёт в адресе, его можно переслать и обновить страницу.
 * Без «use client», поэтому годится и серверной странице, и клиентскому компоненту.
 */
export default function PeriodStepper({
  basePath,
  period,
  from,
  to,
  label,
  today,
  extra,
}: {
  basePath: string;
  period: StepPeriod;
  /** Первый и последний день показанного отрезка (из снимка). */
  from: string;
  to: string;
  label: string;
  /** Сегодня по Алматы. */
  today: string;
  /** Что ещё сохранить в адресе (фильтры). */
  extra?: Record<string, string>;
}) {
  const href = (date: string | null) => {
    const q = new URLSearchParams(extra ?? {});
    q.set("period", period);
    if (date) q.set("date", date);
    return `${basePath}?${q.toString()}`;
  };
  const current = isCurrentRange(from, to, today);
  const forward = canStepForward(period, from, today);
  const arrow = "btn-secondary !px-3 !py-1.5";

  return (
    <div className="flex items-center gap-2">
      <Link href={href(stepAnchor(period, from, -1))} className={arrow} aria-label={NOUN[period][0]} title={NOUN[period][0]}>
        ‹
      </Link>
      <div className="min-w-[10.5rem] text-center">
        <div className="font-medium leading-tight first-letter:uppercase">{label}</div>
        {!current && (
          <Link href={href(null)} className="text-xs text-accent hover:underline">
            {BACK[period]}
          </Link>
        )}
      </div>
      {forward ? (
        <Link href={href(stepAnchor(period, from, 1))} className={arrow} aria-label={NOUN[period][1]} title={NOUN[period][1]}>
          ›
        </Link>
      ) : (
        <span className={clsx(arrow, "opacity-40 pointer-events-none")} aria-hidden="true">
          ›
        </span>
      )}
    </div>
  );
}
