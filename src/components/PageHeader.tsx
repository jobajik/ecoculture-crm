import Image from "next/image";
import clsx from "clsx";
import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import SectionTabs from "./SectionTabs";
import { AREAS, type AreaKey } from "@/lib/areas";

/**
 * Шапка страницы — «лицо» раздела в том же стиле, что заявка и клиент:
 * светлый градиент цвета раздела, значок, крупный заголовок шрифтом Manrope и
 * соцветие Ecoculture водяным знаком. Владелец: «очень крутой стиль — примени
 * на весь сайт». Цвет раздела — `src/lib/areas.ts`.
 *
 * `children` — полоса под заголовком (цифры, переключатель периода): она
 * отделена тонкой линией и остаётся частью шапки. `tabs` — вкладки раздела
 * нижним краем шапки: раздел, где ты, и куда можно перейти, читаются одним
 * блоком, а не тремя строками.
 * Надпись над заголовком прячется, если совпадает с ним («Оплаты» над «Оплаты»).
 * Без "use client": рисуют серверные страницы.
 */
export default function PageHeader({
  area,
  title,
  subtitle,
  eyebrow,
  icon,
  actions,
  tabs,
  children,
  className,
}: {
  area: AreaKey;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Надпись над заголовком; по умолчанию — название раздела. */
  eyebrow?: ReactNode;
  icon?: IconName;
  /** Кнопки справа: «+ Заявка», выгрузка, период. */
  actions?: ReactNode;
  tabs?: { href: string; label: string; match?: string[] }[];
  children?: ReactNode;
  className?: string;
}) {
  const a = AREAS[area];
  const over = eyebrow ?? a.label;
  const showOver = !(typeof over === "string" && typeof title === "string" && over === title);
  const hasTabs = !!tabs && tabs.length > 1;
  return (
    <header
      className={clsx(
        "no-print relative overflow-hidden rounded-2xl border bg-gradient-to-br via-surface to-surface shadow-card mb-4",
        a.border,
        a.gradient,
        className
      )}
    >
      <Image
        src="/logo-mark.png"
        alt=""
        aria-hidden="true"
        width={180}
        height={180}
        className="absolute -right-10 -top-12 w-44 h-44 object-contain opacity-[0.14] pointer-events-none select-none"
      />
      <div className="relative px-4 py-4 sm:px-6 sm:py-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <span className={clsx("w-11 h-11 rounded-xl grid place-items-center flex-none text-white shadow-sm", a.solid)}>
            <Icon name={icon ?? a.icon} className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            {showOver && (
              <div className={clsx("text-[11px] font-semibold uppercase tracking-[0.16em]", a.text)}>{over}</div>
            )}
            <h1 className="font-display text-[22px] sm:text-[28px] leading-tight font-extrabold tracking-tight break-words">
              {title}
            </h1>
            {subtitle && <div className="text-sm text-ink-secondary mt-0.5">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && (
        <div className="relative border-t border-line-hairline/80 px-4 sm:px-6 py-3">{children}</div>
      )}
      {hasTabs && (
        <div className="relative border-t border-line-hairline/80 px-1 sm:px-3">
          <SectionTabs tabs={tabs!} inHeader />
        </div>
      )}
    </header>
  );
}
