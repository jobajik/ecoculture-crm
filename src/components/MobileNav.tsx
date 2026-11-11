"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import SidebarMenu from "./SidebarMenu";
import { areaForPath } from "@/lib/areas";
import { navLinksFor, isActive, activeSub } from "./navLinks";
import SearchTrigger from "./SearchTrigger";
import { useGhFarm } from "./useGhFarm";

/**
 * Телефон и планшет: верхняя полоска с кнопкой ☰ и выезжающее слева меню (19.10.2026, владелец выбрал «выезжающее
 * меню слева» вместо нижней панели). В полоске — где человек сейчас: раздел цветом раздела и вкладка.
 * В панели — то же меню, что колонка на компьютере (`SidebarMenu`).
 */
export default function MobileNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ghFarm = useGhFarm();

  // Переход по ссылке закрывает панель — иначе она висит поверх новой страницы.
  useEffect(() => setOpen(false), [pathname]);

  // Пока панель открыта, страница под ней не прокручивается; Esc закрывает.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!session) return null;
  const area = areaForPath(pathname);
  // Где человек сейчас: раздел и его вкладка — из того же списка, что и боковое меню.
  const links = navLinksFor(session.user?.role ?? "manager", session.user?.payrollRole, session.user?.payrollDepartments, session.user?.farm ?? undefined, session.user?.store ?? undefined);
  const link = links.find((l) => isActive(l, pathname, links, ghFarm));
  const tab = link ? activeSub(link.subs, pathname) : undefined;
  const title = link?.label ?? area.label;

  return (
    <>
      <div className="no-print lg:hidden sticky top-0 z-30 border-b border-line-hairline bg-surface/95 backdrop-blur">
        <div className="h-14 px-3 sm:px-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Открыть меню"
            aria-expanded={open}
            className="w-10 h-10 -ml-1 rounded-lg grid place-items-center text-ink-primary active:bg-surface-sunk"
          >
            <span className="flex flex-col gap-[4px]">
              <span className="block w-[18px] h-[2px] rounded bg-current" />
              <span className="block w-[18px] h-[2px] rounded bg-current" />
              <span className="block w-[18px] h-[2px] rounded bg-current" />
            </span>
          </button>
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-semibold truncate">{title}</div>
            {tab && <div className="text-[12px] text-ink-muted truncate">{tab.label}</div>}
          </div>
          <SearchTrigger compact className="ml-auto flex-none" />
          <Link href="/" className="flex-none" aria-label="Мой день">
            <Image src="/logo-mark.png" alt="" width={28} height={28} className="w-7 h-7 object-contain" />
          </Link>
        </div>
      </div>

      {open && (
        <div className="no-print lg:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-primary/30"
          />
          <div className="absolute inset-y-0 left-0 w-[300px] max-w-[86vw] bg-surface shadow-pop overflow-hidden px-3 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть"
              className="absolute right-2.5 top-3 w-9 h-9 rounded-lg grid place-items-center text-ink-secondary hover:bg-surface-plane text-xl leading-none"
            >
              ×
            </button>
            <SidebarMenu onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
