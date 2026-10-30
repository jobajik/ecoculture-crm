"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { ReactNode } from "react";
import { ghHref } from "@/lib/greenhouse/farm";
import { REPORT_PERIODS, type ReportPeriod } from "@/lib/greenhouse/reportPeriod";

/**
 * Отбор «Записей» и «Аналитики» теплицы (30.10.2026): одна строка — период (неделя, месяц, … со стрелками), блок и
 * сорт. Всё живёт в адресе: ссылкой можно поделиться, «назад» в браузере возвращает прежний отбор.
 */
export default function GhFilterBar({
  path,
  farm,
  params = {},
  period,
  from,
  to,
  anchor,
  title,
  prevAnchor,
  nextAnchor,
  periods,
  today,
  blocks,
  block,
  varieties,
  variety,
  children,
  cycleNote,
}: {
  path: string;
  farm: string;
  /** Постоянные параметры адреса (вид, тип записей). */
  params?: Record<string, string>;
  period: ReportPeriod;
  from: string;
  to: string;
  anchor: string;
  title: string;
  prevAnchor: string | null;
  nextAnchor: string | null;
  periods: ReportPeriod[];
  today: string;
  blocks: string[];
  block: string;
  varieties: string[];
  variety: string;
  /** Что ещё стоит в строке (например, тип записей). */
  children?: ReactNode;
  /** Отбор по циклу из карточки блока: метка и как его снять. */
  cycleNote?: { label: string; clearHref: string };
}) {
  const router = useRouter();
  const href = (patch: Record<string, string | undefined>) => {
    const p: Record<string, string | undefined> = { ...params, period, block: block || undefined, variety: variety || undefined };
    if (period === "custom") Object.assign(p, { from, to });
    else p.date = anchor;
    return ghHref(path, farm, { ...p, ...patch });
  };
  const chip = (on: boolean) => clsx("text-xs px-3 py-1.5 rounded-full border whitespace-nowrap", on ? "bg-ink-primary text-white border-ink-primary" : "border-line-hairline bg-surface hover:bg-surface-plane");
  const arrow = "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line-hairline bg-surface hover:bg-surface-plane text-ink-secondary";

  return (
    <div className="card !p-3 sm:!p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_PERIODS.filter((p) => periods.includes(p.key)).map((p) => (
            <Link
              key={p.key}
              href={p.key === "custom" ? href({ period: "custom", from, to, date: undefined }) : href({ period: p.key, date: anchor, from: undefined, to: undefined })}
              className={chip(p.key === period)}
            >
              {p.label}
            </Link>
          ))}
        </div>
        {children && <div className="flex flex-wrap gap-1.5 sm:ml-auto">{children}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {cycleNote ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-section-greenhouse-soft px-3 py-1.5 text-sm">
            <b>{cycleNote.label}</b>
            <span className="text-xs text-ink-secondary tabular-nums">
              {from.split("-").reverse().join(".")} — {to.split("-").reverse().join(".")}
            </span>
            <Link href={cycleNote.clearHref} className="text-ink-muted hover:text-ink-primary" aria-label="Снять отбор по циклу">
              ✕
            </Link>
          </span>
        ) : period === "custom" ? (
          <div className="flex items-center gap-1.5">
            <input type="date" className="input !h-9 !py-1 !w-auto" defaultValue={from} max={today} onChange={(e) => e.target.value && router.push(href({ from: e.target.value }))} />
            <span className="text-ink-muted">—</span>
            <input type="date" className="input !h-9 !py-1 !w-auto" defaultValue={to} max={today} onChange={(e) => e.target.value && router.push(href({ to: e.target.value }))} />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {prevAnchor ? (
              <Link href={href({ date: prevAnchor })} className={arrow} aria-label="Раньше">
                ‹
              </Link>
            ) : (
              <span className={clsx(arrow, "opacity-40")}>‹</span>
            )}
            <span className="font-display font-bold text-[15px] px-1 min-w-[8rem] text-center">{title}</span>
            {nextAnchor ? (
              <Link href={href({ date: nextAnchor })} className={arrow} aria-label="Позже">
                ›
              </Link>
            ) : (
              <span className={clsx(arrow, "opacity-40")}>›</span>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 sm:ml-auto w-full sm:w-auto">
          <select className="input !h-9 !py-1 flex-1 sm:flex-none sm:!w-auto" value={block} onChange={(e) => router.push(href({ block: e.target.value || undefined }))}>
            <option value="">Все блоки</option>
            {blocks.map((b) => (
              <option key={b} value={b}>
                {/^\d+$/.test(b) ? `Блок ${b}` : b === "—" ? "Весь цикл" : b}
              </option>
            ))}
          </select>
          <select className="input !h-9 !py-1 flex-1 sm:flex-none sm:!w-auto" value={variety} onChange={(e) => router.push(href({ variety: e.target.value || undefined }))}>
            <option value="">Все сорта</option>
            {varieties.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {(block || variety) && (
            <Link href={href({ block: undefined, variety: undefined })} className="text-xs text-ink-muted underline self-center whitespace-nowrap">
              сбросить
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
