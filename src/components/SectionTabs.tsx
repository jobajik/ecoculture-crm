"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/**
 * Вкладки внутри раздела. Верхнее меню держим коротким — по одному пункту на
 * раздел, — а всё, что внутри, показываем здесь. Так у менеджера в шапке
 * четыре пункта вместо десяти.
 */
export default function SectionTabs({
  tabs,
}: {
  tabs: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  if (tabs.length < 2) return null;

  return (
    /* На телефоне вкладки не переносим, а прокручиваем: перенос в две строки
       съедает пол-экрана, а горизонтальная лента листается пальцем. */
    <div className="no-print flex gap-1 border-b border-line-hairline -mt-1 mb-1 overflow-x-auto scroll-x-hidden sm:flex-wrap sm:overflow-visible">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={clsx(
              "px-3 py-3 sm:py-2 text-sm -mb-px border-b-2 transition-colors whitespace-nowrap",
              active
                ? "border-accent text-ink-primary font-medium"
                : "border-transparent text-ink-secondary hover:text-ink-primary"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
