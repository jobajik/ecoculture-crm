import Link from "next/link";
import clsx from "clsx";
import { payrollHref } from "@/lib/payroll/farmScope";

/**
 * Вкладки выработки под шапкой: ввод за день, журнал, аналитика, оплата труда. Ссылки, без состояния (файл без
 * "use client"); компания едет параметром. «Оплата» — только тем, кому открыты деньги.
 */
export type WorkTabKey = "day" | "journal" | "analytics" | "pay";

export default function WorkTabs({ active, farm, seesMoney, params = {} }: { active: WorkTabKey; farm: string; seesMoney: boolean; params?: Record<string, string | undefined> }) {
  const tabs: { key: WorkTabKey; href: string; label: string }[] = [
    { key: "day", href: payrollHref("/payroll/work", farm, params), label: "Ввод за день" },
    { key: "journal", href: payrollHref("/payroll/work/journal", farm, params), label: "Журнал" },
    { key: "analytics", href: payrollHref("/payroll/work/analytics", farm, params), label: "Аналитика" },
  ];
  if (seesMoney) tabs.push({ key: "pay", href: payrollHref("/payroll/work/pay", farm, params), label: "Оплата труда" });
  return (
    <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-1 px-1 py-0.5">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={clsx(
            "h-9 px-4 rounded-full text-sm whitespace-nowrap inline-flex items-center transition-colors",
            t.key === active ? "bg-section-payroll text-white font-medium" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
