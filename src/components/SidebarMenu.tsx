"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import clsx from "clsx";
import Icon, { type IconName } from "./Icon";
import { areaForPath } from "@/lib/areas";
import { ROLE_LABELS, farmLabel, isFarmBoundRole } from "@/lib/constants";
import { navLinksFor, isActive, type NavLink } from "./navLinks";
import { isTabActive, useShellTabs } from "./ShellTabs";

/**
 * Боковое меню (19.10.2026, владелец прислал образец: «такой дизайн нам нужен — удобный и лаконичный; давай всё
 * переделывать под такой и цветовую гамму под каждый раздел»). Одно содержимое на два места: колонка слева на
 * компьютере (`Nav`) и выезжающая панель на телефоне (`MobileNav`).
 *
 * Активный раздел — сплошной заливкой ЦВЕТА РАЗДЕЛА (`src/lib/areas.ts`), под ним вкладки раздела подпунктами
 * (их сообщает страница — `ShellTabs`). Порядок пунктов — `navLinksFor` (у каждой роли своё «первым»).
 */

/** Значок пункта: обычно — значок раздела, «Офис» отличается от «Склада». */
function iconFor(link: NavLink): IconName {
  if (link.href.startsWith("/office")) return "store";
  return areaForPath(link.match ?? link.href).icon;
}

export default function SidebarMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const tabs = useShellTabs();
  if (!session) return null;

  const role = session.user?.role ?? "manager";
  const links = navLinksFor(role);
  const work = links.filter((l) => l.href !== "/admin");
  const other = links.filter((l) => l.href === "/admin");
  const initials = (session.user?.name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const item = (l: NavLink) => {
    const active = isActive(l, pathname);
    const area = areaForPath(l.match ?? l.href);
    const subs = active && tabs.length > 1 ? tabs : [];
    return (
      <div key={l.href}>
        <Link
          href={l.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={clsx(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors",
            active ? clsx(area.solid, "text-white font-semibold shadow-sm") : "text-ink-secondary hover:bg-surface-plane hover:text-ink-primary"
          )}
        >
          <Icon name={iconFor(l)} className="w-[18px] h-[18px] flex-none" />
          <span className="truncate">{l.label}</span>
          {l.href !== "/" && (
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={clsx("ml-auto w-3.5 h-3.5 flex-none transition-transform", active ? "rotate-90 opacity-90" : "opacity-40")}
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
          <div className="ml-[22px] mt-1 mb-2 border-l border-line-hairline pl-3 space-y-0.5">
            {subs.map((t) => {
              const on = isTabActive(t, pathname);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  onClick={onNavigate}
                  className={clsx(
                    "block rounded-lg px-3 py-2 text-[13px] transition-colors",
                    on ? clsx(area.soft, area.text, "font-semibold") : "text-ink-secondary hover:text-ink-primary hover:bg-surface-plane"
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <Link href="/" onClick={onNavigate} className="flex items-center px-2 pt-1 pb-4 mb-4 border-b border-line-hairline">
        <Image src="/logo.png" alt="Ecoculture" width={1020} height={593} priority className="w-full max-w-[200px] h-auto object-contain" />
      </Link>

      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        <div className="px-3 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Работа</div>
        <nav className="space-y-0.5">{work.map(item)}</nav>
        {other.length > 0 && (
          <>
            <div className="px-3 mt-5 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Прочее</div>
            <nav className="space-y-0.5">{other.map(item)}</nav>
          </>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-line-hairline flex items-center gap-3 px-1">
        <span className="grid place-content-center w-9 h-9 rounded-full bg-accent-soft text-accent text-xs font-bold font-display flex-none">
          {initials}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-semibold truncate">{session.user?.name}</div>
          <div className="text-[11.5px] text-ink-muted truncate">
            {ROLE_LABELS[role] ?? role}
            {isFarmBoundRole(role) && session.user?.farm && ` · ${farmLabel(session.user.farm)}`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="ml-auto text-[12px] text-ink-muted hover:text-ink-primary transition-colors"
          title="Выйти"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
