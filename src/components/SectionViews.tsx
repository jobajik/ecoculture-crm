"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isViewActive, viewsFor, type SectionTab } from "@/lib/sectionViews";

/**
 * Переключатель видов внутри вкладки раздела («Оплаты»: заявки / статус счетов; «Лиды»: доска / решения ИИ / с рекламы /
 * обзвон). Виды задаёт вкладка (`SectionTab.views` в `tabs.ts` раздела), страница о них не знает — `PageHeader` рисует
 * переключатель сам по списку вкладок, который страница и так передаёт. На телефоне ряд листается пальцем.
 */
export default function SectionViews({ tabs }: { tabs?: SectionTab[] }) {
  const pathname = usePathname();
  const views = viewsFor(tabs, pathname);
  if (views.length < 2) return null;
  return (
    <div className="no-print mb-4 flex max-w-full overflow-x-auto scroll-x-hidden">
      <div className="inline-flex flex-none rounded-lg border border-line-strong bg-surface p-0.5">
        {views.map((v) => {
          const active = isViewActive(v, pathname);
          return (
            <Link
              key={v.href}
              href={v.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium bg-accent text-white"
                  : "whitespace-nowrap rounded-md px-3 py-1 text-[13px] text-ink-secondary hover:text-ink-primary hover:bg-surface-plane"
              }
            >
              {v.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
