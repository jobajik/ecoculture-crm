import Link from "next/link";
import clsx from "clsx";
import { REGION_STORES } from "@/lib/officeStore";
import type { SectionTab } from "@/lib/sectionViews";

/**
 * Полоса раздела «Регионы» для тех, кто видит все города (владелец, РОП, зав. складом): город — кнопками, под ними
 * вкладки города. У директора города этой полосы нет: город у него один, а вкладки — подпунктами его раздела в меню.
 * Без «use client».
 */
export default function RegionNav({ store, tabs, current }: { store: string; tabs: SectionTab[]; current: string }) {
  return (
    <div className="no-print mb-5 space-y-3">
      <div className="flex gap-2 overflow-x-auto scroll-x-hidden lg:flex-wrap -mx-1 px-1">
        <Link href="/region" className="h-9 sm:h-8 px-3 rounded-lg border text-[13px] whitespace-nowrap flex items-center flex-none bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary">
          Все города
        </Link>
        {REGION_STORES.map((r) => (
          <Link
            key={r.code}
            href={`/region/${r.code}`}
            className={clsx(
              "h-9 sm:h-8 px-3 rounded-lg border text-[13px] whitespace-nowrap flex items-center flex-none transition-colors",
              r.code === store ? "bg-accent-soft text-accent border-accent/25 font-medium" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary"
            )}
          >
            {r.label}
          </Link>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto scroll-x-hidden border-b border-line-hairline">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={clsx(
              "px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
              (t.match ? t.match.includes(current) : t.href === current) ? "border-accent text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
