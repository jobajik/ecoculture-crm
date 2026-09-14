"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ROLE_LABELS, farmLabel, isFarmBoundRole } from "@/lib/constants";
import { navLinksFor, isActive } from "./navLinks";

/**
 * Шапка с разделами.
 *
 * Разделов у администратора десять, и в ленту шириной с контент они не влезали:
 * появлялась горизонтальная полоса прокрутки, а «Настройки» были обрезаны на
 * полуслове. Полоса прокрутки в меню — худший из возможных ответов: человек не
 * видит, что за краем что-то есть, и возит по ней мышью, вместо того чтобы
 * нажать.
 *
 * Поэтому лента ИЗМЕРЯЕТСЯ: сколько разделов помещается — столько и показано,
 * остальные уходят под «Ещё». Считается это по настоящим ширинам, а не по числу
 * пунктов: у ролей разный набор, названия разной длины, а окно у людей бывает и
 * в половину экрана. Ровно тот же приём, что на телефоне (`MobileNav`), только
 * там порог — четыре пункта, потому что пятый уже нечитаем.
 *
 * Порядок пунктов в `navLinks.ts` от этого становится ещё важнее: под «Ещё»
 * уходит ХВОСТ списка, поэтому сверху стоит то, что открывают каждый день.
 */
export default function Nav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const role = session?.user?.role ?? "manager";

  const navRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  // Сколько пунктов помещается. До первого измерения показываем всё: если
  // JavaScript почему-то не отработает, меню останется полным, просто тесным —
  // это лучше, чем меню, из которого пропали разделы.
  const [visible, setVisible] = useState(Number.POSITIVE_INFINITY);
  const [moreOpen, setMoreOpen] = useState(false);

  const links = navLinksFor(role);

  const measure = useCallback(() => {
    const nav = navRef.current;
    const ghost = ghostRef.current;
    if (!nav || !ghost) return;

    // Лента растянута на всё свободное место (`flex-1 min-w-0`), поэтому её
    // clientWidth — это и есть то, чем мы располагаем, независимо от того,
    // сколько всего внутри.
    const available = nav.clientWidth;
    const children = Array.from(ghost.children) as HTMLElement[];
    // Последний в призрачной ленте — сама кнопка «Ещё»: её ширину меряем, а не
    // угадываем. С запасом «на глаз» под «Ещё» уходил лишний раздел, для
    // которого место на самом деле было.
    const widths = children.slice(0, -1).map((el) => el.offsetWidth);
    const MORE = children[children.length - 1]?.offsetWidth ?? 62;
    const GAP = 2;

    let used = 0;
    let fits = widths.length;
    for (let i = 0; i < widths.length; i += 1) {
      used += widths[i] + (i ? GAP : 0);
      if (used > available) {
        fits = i;
        break;
      }
    }

    if (fits < widths.length) {
      // Пересчитываем с местом под «Ещё»: она тоже занимает ширину.
      used = 0;
      fits = widths.length;
      for (let i = 0; i < widths.length; i += 1) {
        used += widths[i] + (i ? GAP : 0);
        if (used + GAP + MORE > available) {
          fits = i;
          break;
        }
      }
      // Один пункт показать обязаны: пустая шапка выглядит как поломка.
      fits = Math.max(1, fits);
    }

    setVisible(fits);
  }, []);

  useLayoutEffect(() => {
    measure();
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    // ResizeObserver, а не только resize: ширина ленты меняется и когда имя
    // сотрудника рядом оказывается длиннее обычного.
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [measure, links.length]);

  // Шрифт грузится отдельным файлом, и до его загрузки ширины меньше настоящих.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    fonts?.ready.then(measure).catch(() => {});
  }, [measure]);

  // Закрываем «Ещё» нажатием мимо и клавишей Esc — иначе шторка остаётся
  // висеть поверх страницы, и человек тычет в неё вместо ссылки под ней.
  useEffect(() => {
    if (!moreOpen) return;
    function onDown(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Переход на другую страницу закрывает шторку сам.
  useEffect(() => setMoreOpen(false), [pathname]);

  if (!session) return null;

  const initials = (session.user?.name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const shown = links.slice(0, visible);
  const hidden = links.slice(visible);
  const hiddenActive = hidden.some((l) => isActive(l, pathname));

  const itemClass = (active: boolean) =>
    clsx(
      "px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
      active
        ? "bg-accent-soft text-accent"
        : "text-ink-secondary hover:text-ink-primary hover:bg-surface-plane"
    );

  return (
    <header className="sticky top-0 z-30 border-b border-line-hairline bg-surface/85 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        {/* Фирменный знак вместо буквы «E»: логотип лежит в public/logo-mark.png
            (соцветие без надписи — в шапке надпись дублировала бы название).
            Само название прячется на узких окнах: разделы нужнее. */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image
            src="/logo-mark.png"
            alt="Eco Culture"
            width={28}
            height={28}
            priority
            className="w-7 h-7 object-contain"
          />
          <span className="hidden lg:inline font-semibold tracking-tight">Ecoculture-CRM</span>
        </Link>

        {/* На телефоне разделы живут в нижней панели (MobileNav): в шапке для
            них остаётся полоска шириной в палец, по которой неудобно попадать. */}
        <nav ref={navRef} className="hidden sm:flex items-center gap-0.5 flex-1 min-w-0">
          {/* Обрезается только ЛЕНТА ПУНКТОВ, а не вся шапка. Сначала
              `overflow-hidden` стоял на всём меню — и срезал выпадающий список
              «Ещё»: ссылки были в разметке, на экране их не было. Обрезка
              должна доставать ровно до того, ради чего она стоит. */}
          <div
            ref={rowRef}
            className="flex items-center gap-0.5 min-w-0 overflow-hidden relative"
          >
            {shown.map((l) => (
              <Link key={l.href} href={l.href} className={itemClass(isActive(l, pathname))}>
                {l.label}
              </Link>
            ))}

            {/* Невидимая копия всех пунктов — по ней и меряем. Она не участвует
                в раскладке (absolute) и не ловит нажатия, поэтому её ширины
                всегда настоящие, сколько бы пунктов ни было видно. */}
            <div
              ref={ghostRef}
              aria-hidden
              className="absolute left-0 top-0 flex items-center gap-0.5 invisible pointer-events-none"
            >
              {links.map((l) => (
                <span key={l.href} className={itemClass(false)}>
                  {l.label}
                </span>
              ))}
              <span className={itemClass(false)}>Ещё ▾</span>
            </div>
          </div>

          {hidden.length > 0 && (
            <div ref={moreRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className={itemClass(hiddenActive)}
                aria-expanded={moreOpen}
              >
                Ещё ▾
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-1 min-w-[180px] rounded-xl border border-line-hairline bg-surface shadow-lg py-1 z-40">
                  {hidden.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={clsx(
                        "block px-4 py-2 text-sm whitespace-nowrap",
                        isActive(l, pathname)
                          ? "text-accent font-medium"
                          : "text-ink-secondary hover:text-ink-primary hover:bg-surface-plane"
                      )}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0 ml-auto">
          <div className="hidden xl:block text-right leading-tight">
            <div className="text-sm font-medium">{session.user?.name}</div>
            <div className="text-xs text-ink-muted">
              {ROLE_LABELS[role] ?? role}
              {/* Производство показываем только тем, кто к нему привязан
                  (зав. складом и агроному): у остальных ролей колонка Farm
                  не влияет ни на что, и подпись только путала бы. */}
              {isFarmBoundRole(role) && session.user?.farm && ` · ${farmLabel(session.user.farm)}`}
            </div>
          </div>
          <span
            className="grid place-content-center w-8 h-8 rounded-full bg-surface-sunk text-xs font-semibold text-ink-secondary"
            title={`${session.user?.name ?? ""} · ${ROLE_LABELS[role] ?? role}`}
          >
            {initials}
          </span>
          <button
            onClick={() => signOut()}
            className="hidden sm:block text-sm text-ink-muted hover:text-ink-primary transition-colors"
            title="Выйти"
          >
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}
