import Link from "next/link";
import clsx from "clsx";
import { FARM_LABELS } from "@/lib/constants";
import { TIMESHEET_STATUS_LABELS, type TimesheetStatus } from "@/lib/payroll/timesheet";

/**
 * Переключатель подразделений — лента плиток под шапкой табеля (28.10.2026, владелец: «табели сделай, как вкладки с
 * разными подразделениями, чтобы легко можно было переключаться»). На каждой — люди и состояние табеля точкой: бухгалтер
 * с одного взгляда видит, кто сдал, кто нет, и не ходит на список. Файл без "use client" — ссылки, никакого состояния.
 */
export interface DeptTab {
  deptId: string;
  name: string;
  farm: string;
  people: number;
  status: TimesheetStatus;
  href: string;
}

const DOT: Record<TimesheetStatus, string> = {
  "": "bg-ink-muted/40",
  submitted: "bg-[#d9a400]",
  approved: "bg-status-good",
  returned: "bg-[#c43c3c]",
};

export default function DeptTabs({ tabs, active, showFarm }: { tabs: DeptTab[]; active: string; showFarm?: boolean }) {
  if (tabs.length <= 1) return null;
  return (
    <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-1 px-1 py-0.5">
      {tabs.map((t) => {
        const on = t.deptId === active;
        return (
          <Link
            key={t.deptId}
            href={t.href}
            title={`${t.name} · табель: ${TIMESHEET_STATUS_LABELS[t.status]}`}
            className={clsx(
              "flex items-center gap-2 h-9 px-3.5 rounded-full text-sm whitespace-nowrap transition-colors",
              on ? "bg-ink-primary text-white" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane",
            )}
          >
            <span className={clsx("h-2 w-2 rounded-full shrink-0", DOT[t.status], on && "ring-2 ring-white/40")} />
            <span className={clsx(on && "font-medium")}>{t.name}</span>
            <span className={clsx("text-xs tabular-nums", on ? "text-white/70" : "text-ink-muted")}>
              {t.people}
              {showFarm && t.farm ? ` · ${FARM_LABELS[t.farm] ?? t.farm}` : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
