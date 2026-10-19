"use client";

import clsx from "clsx";

/**
 * Листание списка страницами (новый вид, 19.10.2026, владелец: «чтобы не нужно было ничего скроллить — одностраничный
 * и удобный»). Список показывается порцией, которая помещается в экран, а дальше — «1 2 3 … 9», «Назад» и «Дальше».
 */
export const PAGE_SIZE = 10;

export function pageSlice<T>(list: T[], page: number, size = PAGE_SIZE): T[] {
  return list.slice(page * size, page * size + size);
}

export default function Pager({
  total,
  page,
  onPage,
  size = PAGE_SIZE,
  what = "",
}: {
  total: number;
  page: number;
  onPage: (page: number) => void;
  size?: number;
  /** «заявок», «платежей» — для подписи «Показано 1–10 из 412 заявок». */
  what?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total === 0) return null;
  const from = page * size + 1;
  const to = Math.min(total, from + size - 1);
  // Номера: первая, последняя и две соседние с текущей; пропуски — «…».
  const nums: (number | "gap")[] = [];
  for (let i = 0; i < pages; i += 1) {
    if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "gap") nums.push("gap");
  }
  const btn = "h-8 min-w-8 px-2.5 rounded-lg border text-[13px] tabular-nums transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-line-hairline text-[13px] text-ink-secondary">
      <span>
        {pages > 1 ? `Показано ${from}–${to} из ${total.toLocaleString("ru-RU")}` : `Всего ${total.toLocaleString("ru-RU")}`}
        {what ? ` ${what}` : ""}
      </span>
      {pages > 1 && (
        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden sm:flex items-center gap-1.5">
            {nums.map((n, i) =>
              n === "gap" ? (
                <span key={`g${i}`} className="px-1 text-ink-muted">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => onPage(n)}
                  className={clsx(
                    btn,
                    n === page ? "bg-accent-soft border-accent/30 text-accent font-bold" : "border-line-hairline hover:bg-surface-plane"
                  )}
                >
                  {n + 1}
                </button>
              )
            )}
          </div>
          <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className={clsx(btn, "border-line-hairline font-semibold text-ink-primary disabled:opacity-40")}>
            Назад
          </button>
          <button
            type="button"
            disabled={page >= pages - 1}
            onClick={() => onPage(page + 1)}
            className={clsx(btn, "border-line-hairline font-semibold text-ink-primary disabled:opacity-40")}
          >
            Дальше
          </button>
        </div>
      )}
    </div>
  );
}
