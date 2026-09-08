"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ROLE_LABELS, farmLabel, isFarmBoundRole } from "@/lib/constants";
import { navLinksFor, type NavLink } from "./navLinks";

/**
 * Нижнее меню для телефона.
 *
 * В шапке разделы не помещаются: на экране 390 px между логотипом и кнопкой
 * «Выйти» остаётся полоска, по которой приходится возить пальцем, а сами пункты
 * получаются высотой в палец ногтя. Внизу же экрана большой палец достаёт до
 * всего без перехвата телефона — поэтому на телефоне разделы уезжают вниз, а
 * шапка остаётся только с логотипом.
 *
 * Помещается четыре пункта плюс «Ещё»: пятый узкий пункт на маленьком экране
 * уже нечитаем. Остальные разделы, имя, роль и выход — в шторке «Ещё».
 */

const PRIMARY_COUNT = 4;

export default function MobileNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Переход по ссылке должен закрывать шторку — иначе она висит поверх новой
  // страницы и выглядит как зависший интерфейс.
  useEffect(() => setSheetOpen(false), [pathname]);

  // Пока шторка открыта, страница под ней не должна прокручиваться.
  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheetOpen]);

  if (!session) return null;

  const role = session.user?.role ?? "manager";
  const links = navLinksFor(role);
  const primary = links.slice(0, PRIMARY_COUNT);
  const rest = links.slice(PRIMARY_COUNT);

  const isActive = (l: NavLink) =>
    l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
  const restActive = rest.some(isActive);

  return (
    <>
      {/* Шторка «Ещё» */}
      {sheetOpen && (
        <div className="sm:hidden no-print fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-ink-primary/30"
          />
          <div className="absolute inset-x-0 bottom-0 bg-surface rounded-t-2xl border-t border-line-hairline pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card-hover">
            <div className="flex justify-center pt-2 pb-1">
              <span className="w-10 h-1 rounded-full bg-line-strong" />
            </div>

            <div className="px-4 pb-3 pt-1 border-b border-line-hairline">
              <div className="font-medium">{session.user?.name}</div>
              <div className="text-sm text-ink-muted">
                {ROLE_LABELS[role] ?? role}
                {isFarmBoundRole(role) && session.user?.farm && ` · ${farmLabel(session.user.farm)}`}
              </div>
            </div>

            <nav className="p-2">
              {rest.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={clsx(
                    "block rounded-lg px-3 py-3 text-base",
                    isActive(l)
                      ? "bg-accent-soft text-accent font-medium"
                      : "text-ink-primary active:bg-surface-plane"
                  )}
                >
                  {l.label}
                </Link>
              ))}
              <button
                onClick={() => signOut()}
                className="w-full text-left rounded-lg px-3 py-3 text-base text-ink-secondary active:bg-surface-plane"
              >
                Выйти
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Сама панель. Высота с запасом под «домашнюю полоску» айфона. */}
      <nav className="sm:hidden no-print fixed bottom-0 inset-x-0 z-30 border-t border-line-hairline bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {primary.map((l) => {
            const active = isActive(l);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-14 px-1",
                  "text-[11px] font-medium leading-tight text-center transition-colors",
                  active ? "text-accent" : "text-ink-secondary active:bg-surface-plane"
                )}
              >
                <span
                  className={clsx(
                    "h-0.5 w-6 rounded-full",
                    active ? "bg-accent" : "bg-transparent"
                  )}
                />
                <span className="truncate w-full">{l.short ?? l.label}</span>
              </Link>
            );
          })}

          {/* «Ещё» есть всегда, даже когда прятать нечего: под ним живут имя,
              роль и выход — на телефоне им в шапке места нет. */}
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            aria-expanded={sheetOpen}
            className={clsx(
              "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-14 px-1",
              "text-[11px] font-medium leading-tight transition-colors",
              sheetOpen || restActive ? "text-accent" : "text-ink-secondary active:bg-surface-plane"
            )}
          >
            <span
              className={clsx("h-0.5 w-6 rounded-full", restActive ? "bg-accent" : "bg-transparent")}
            />
            <span>Ещё</span>
          </button>
        </div>
      </nav>
    </>
  );
}
