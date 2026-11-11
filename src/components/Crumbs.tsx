"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AREAS, type AreaKey } from "@/lib/areas";
import { isTabActive, useShellTabs } from "./ShellTabs";

/**
 * «Хлебные крошки» под заголовком страницы (новый вид по прототипу владельца): «Клиенты › База клиентов › Магнолия».
 * Раздел → открытая вкладка раздела (их сообщает страница, `ShellTabs`) → сама страница, если её название другое.
 */
export default function Crumbs({ area, title, lead }: { area: AreaKey; title: ReactNode; lead?: ReactNode }) {
  const pathname = usePathname();
  const tabs = useShellTabs();
  const a = AREAS[area];
  const tab = tabs.length > 1 ? tabs.find((t) => isTabActive(t, pathname)) : undefined;
  const parts: { label: ReactNode; href?: string }[] = [{ label: lead ?? a.label, href: tabs[0]?.href }];
  if (tab && tab.label !== lead && tab.label !== a.label) parts.push({ label: tab.label, href: tab.href });
  const last = parts[parts.length - 1].label;
  if (typeof title === "string" && title !== last && title !== a.label) parts.push({ label: title });
  // Одна крошка, равная заголовку («Заявки» над «Заявки»), ничего не сообщает — не рисуем. Последняя крошка тоже
  // повторяет заголовок, поэтому показываем только путь ДО неё.
  const trail = typeof title === "string" && parts[parts.length - 1].label === title ? parts.slice(0, -1) : parts;
  if (trail.length === 0) return null;
  return (
    <nav aria-label="Где вы" className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-4 text-ink-muted min-w-0 mb-0.5">
      {trail.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 min-w-0">
          {i > 0 && <span aria-hidden="true">/</span>}
          {p.href ? (
            <Link href={p.href} className="hover:text-ink-primary truncate">
              {p.label}
            </Link>
          ) : (
            <span className="truncate">{p.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
