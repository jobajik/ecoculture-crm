"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { periodLabel, periodOf, periodShift } from "@/lib/constants";

/**
 * Переключатель месяца. Месяц живёт в адресе страницы (?period=2026-09), а не
 * во внутреннем состоянии: так ссылку на конкретный месяц можно переслать
 * коллеге, а обновление страницы не сбрасывает выбор.
 */
export default function PeriodPicker({
  period,
  disabled,
}: {
  period: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = periodOf(new Date());

  function go(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => go(periodShift(period, -1))}
        disabled={disabled}
        className="btn-secondary !px-3 !py-1.5 disabled:opacity-50"
        aria-label="Предыдущий месяц"
        title="Предыдущий месяц"
      >
        ‹
      </button>
      <div className="min-w-[10.5rem] text-center">
        <div className="font-medium capitalize leading-tight">{periodLabel(period)}</div>
        {period !== current && (
          <button
            type="button"
            onClick={() => go(current)}
            disabled={disabled}
            className="text-xs text-accent hover:underline disabled:opacity-50"
          >
            вернуться к текущему
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => go(periodShift(period, 1))}
        disabled={disabled}
        className="btn-secondary !px-3 !py-1.5 disabled:opacity-50"
        aria-label="Следующий месяц"
        title="Следующий месяц"
      >
        ›
      </button>
    </div>
  );
}
