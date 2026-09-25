"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { areaForPath } from "@/lib/areas";

/**
 * Вкладки внутри раздела. Верхнее меню держим коротким — по одному пункту на
 * раздел, — а всё, что внутри, показываем здесь. Так у менеджера в шапке
 * четыре пункта вместо десяти.
 */
export default function SectionTabs({
  tabs,
  inHeader = false,
}: {
  /** `match` — адреса, на которых вкладка горит (без него — ровно `href`). */
  tabs: { href: string; label: string; match?: string[] }[];
  /** Вкладки — нижний край шапки страницы (`PageHeader`): без своей линии. */
  inHeader?: boolean;
}) {
  const pathname = usePathname();
  const stripRef = useRef<HTMLDivElement>(null);
  // Есть ли что-то ещё справа за краем экрана. Нужно только для подсказки:
  // на телефоне лента вкладок обрезалась ровно по границе, и «Отчёт» у
  // бухгалтера выглядел не спрятанным, а несуществующим. Человек не листает
  // то, о чём не знает.
  const [moreRight, setMoreRight] = useState(false);

  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  }, []);

  useEffect(() => {
    measure();
    const el = stripRef.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure, tabs.length]);

  if (tabs.length < 2) return null;
  // Подчёркивание активной вкладки — цветом раздела (src/lib/areas.ts).
  const area = areaForPath(pathname);

  return (
    <div className={clsx("no-print relative", inHeader ? "" : "-mt-1 mb-1")}>
      {/* На телефоне вкладки не переносим, а прокручиваем: перенос в две строки
          съедает пол-экрана, а горизонтальная лента листается пальцем. */}
      <div
        ref={stripRef}
        className={clsx(
          "flex gap-1 overflow-x-auto scroll-x-hidden sm:flex-wrap sm:overflow-visible",
          !inHeader && "border-b border-line-hairline"
        )}
      >
        {tabs.map((t) => {
          const active = t.match ? t.match.includes(pathname) : pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={clsx(
                "px-3 py-3 sm:py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap",
                !inHeader && "-mb-px",
                active
                  ? clsx(area.tabBorder, "text-ink-primary font-semibold")
                  : "border-transparent text-ink-secondary hover:text-ink-primary"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* Затенение у правого края: говорит «здесь не конец», не занимая места и
          не перехватывая нажатия. Пропадает, когда долистали до конца. */}
      {moreRight && (
        <div
          aria-hidden
          className={clsx(
            "sm:hidden pointer-events-none absolute right-0 top-0 w-10 bg-gradient-to-l from-surface to-transparent",
            inHeader ? "bottom-0" : "bottom-px"
          )}
        />
      )}
    </div>
  );
}
