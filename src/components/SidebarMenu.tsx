"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import clsx from "clsx";
import Icon, { type IconName } from "./Icon";
import SearchTrigger from "./SearchTrigger";
import { areaForPath } from "@/lib/areas";
import { ROLE_LABELS, farmLabel, isFarmBoundRole } from "@/lib/constants";
import { navLinksFor, isActive, activeSub, type NavLink, type NavSub } from "./navLinks";
import { useGhFarm } from "./useGhFarm";

/**
 * Боковое меню. Одно содержимое на два места: колонка слева на компьютере (`Nav`) и выезжающая панель на телефоне
 * (`MobileNav`).
 *
 * Вид с 11.11.2026 (владелец: «полное переосмысление — минимализм, один акцент, понятная навигация»):
 *  - активный раздел — спокойная серая подложка и значок акцентом, а не сплошная цветная плашка; цвет у разделов
 *    больше не разный — раздел читается по названию и месту, а не по цвету;
 *  - поиск по сайту (Ctrl K) стоит в меню под логотипом, а не в шапке каждой страницы — шапка осталась под заголовок
 *    и действия;
 *  - вкладки раздела идут под ним ГРУППАМИ с подписями (`NavSub.group`): у «Клиентов» — База / Лиды / Общение, у
 *    «Склада» — Работа склада / Выдачи / Отчёты / Другие склады. Сплошной столбик из одиннадцати строк не читался.
 * Разделов по-прежнему пять-шесть на роль (`navLinksFor`); вкладки раздел знает сам (`subs`).
 */

/** Значок пункта: обычно — значок раздела, «Офис» отличается от «Склада». */
function iconFor(link: NavLink): IconName {
  if (link.href === "/") return "home";
  if (link.href.startsWith("/office") || link.href.startsWith("/astana")) return "store";
  return areaForPath(link.match[0] ?? link.href).icon;
}

/** Вкладки раздела группами — в том порядке, в каком группы встречаются в списке. */
function groupsOf(subs: NavSub[]): { label: string; items: NavSub[] }[] {
  const out: { label: string; items: NavSub[] }[] = [];
  for (const s of subs) {
    const label = s.group ?? "";
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(s);
    else out.push({ label, items: [s] });
  }
  return out;
}

export default function SidebarMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const ghFarm = useGhFarm();
  if (!session) return null;

  const role = session.user?.role ?? "manager";
  const links = navLinksFor(role, session.user?.payrollRole, session.user?.payrollDepartments, session.user?.farm ?? undefined, session.user?.store ?? undefined);
  const work = links.filter((l) => !l.other);
  const other = links.filter((l) => l.other);
  const initials = (session.user?.name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const item = (l: NavLink) => {
    const active = isActive(l, pathname, links, ghFarm);
    const subs = active ? l.subs : [];
    const current = activeSub(subs, pathname);
    const groups = groupsOf(subs);
    const labelled = groups.length > 1;
    return (
      <div key={l.href}>
        <Link
          href={l.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={clsx(
            "group flex items-center gap-2.5 rounded-lg px-2.5 h-10 lg:h-9 text-[14px] lg:text-[13.5px] transition-colors",
            active ? "bg-surface-sunk text-ink-primary font-semibold" : "text-ink-secondary hover:bg-surface-plane hover:text-ink-primary"
          )}
        >
          <Icon name={iconFor(l)} className={clsx("w-[17px] h-[17px] flex-none", active ? "text-accent" : "text-ink-muted group-hover:text-ink-secondary")} />
          <span className="truncate">{l.label}</span>
          {l.subs.length > 0 && (
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={clsx("ml-auto w-3.5 h-3.5 flex-none transition-transform text-ink-muted", active ? "rotate-90" : "opacity-60")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          )}
        </Link>
        {subs.length > 0 && (
          <div className="ml-[18px] mt-1 mb-2 border-l border-line-hairline pl-2.5">
            {groups.map((g, gi) => (
              <div key={g.label || gi} className={gi > 0 ? "mt-2.5" : ""}>
                {labelled && g.label && <div className="px-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-muted">{g.label}</div>}
                <div className="space-y-px">
                  {g.items.map((t) => {
                    const on = current === t;
                    return (
                      <Link
                        key={t.href}
                        href={t.href}
                        onClick={onNavigate}
                        aria-current={on ? "page" : undefined}
                        className={clsx(
                          "relative flex items-center rounded-md px-2.5 h-9 lg:h-[30px] text-[13.5px] lg:text-[13px] transition-colors",
                          on ? "text-accent font-semibold bg-accent-soft" : "text-ink-secondary hover:text-ink-primary hover:bg-surface-plane"
                        )}
                      >
                        <span className="truncate">{t.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <Link href="/" onClick={onNavigate} className="flex items-center px-2 pt-0.5 pb-3" aria-label="Ecoculture — на главную">
        <Image src="/logo.png" alt="Ecoculture" width={1020} height={593} priority className="w-[104px] h-auto object-contain" />
      </Link>

      {/* Общий поиск — в меню (на телефоне он ещё и в верхней полоске). */}
      <SearchTrigger className="mb-3 hidden lg:flex" />

      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        <nav className="space-y-0.5">{work.map(item)}</nav>
        {other.length > 0 && (
          <>
            <div className="my-3 border-t border-line-hairline" />
            <nav className="space-y-0.5">{other.map(item)}</nav>
          </>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-line-hairline flex items-center gap-2.5 px-1">
        <span className="grid place-content-center w-8 h-8 rounded-full bg-surface-sunk text-ink-secondary text-[11px] font-semibold flex-none">{initials}</span>
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-medium truncate">{session.user?.name}</div>
          <div className="text-[11.5px] text-ink-muted truncate">
            {ROLE_LABELS[role] ?? role}
            {isFarmBoundRole(role) && session.user?.farm && ` · ${farmLabel(session.user.farm)}`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="ml-auto w-8 h-8 grid place-items-center rounded-lg text-ink-muted hover:text-ink-primary hover:bg-surface-plane transition-colors flex-none"
          title="Выйти"
          aria-label="Выйти"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
