import clsx from "clsx";
import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import SectionTabs from "./SectionTabs";
import { AREAS, type AreaKey } from "@/lib/areas";

/**
 * Шапка страницы: значок цвета раздела, надпись раздела тем же цветом и крупный заголовок шрифтом Manrope прямо на
 * сером холсте, кнопки справа (19.10.2026, новый вид по образцу владельца: «удобный и лаконичный», «цветовую гамму
 * под каждый раздел»). Цвет раздела — `src/lib/areas.ts`.
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
    <header className={clsx("no-print mb-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 sm:gap-3.5 min-w-0">
          <span className={clsx("w-10 h-10 sm:w-11 sm:h-11 rounded-xl grid place-items-center flex-none text-white shadow-sm", a.solid)}>
            <Icon name={icon ?? a.icon} className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            {showOver && <div className={clsx("text-[12px] font-semibold", a.text)}>{over}</div>}
            <h1 className="font-display text-[22px] sm:text-[26px] leading-tight font-extrabold tracking-tight break-words">
              {title}
            </h1>
            {subtitle && <div className="text-sm text-ink-secondary mt-0.5">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && (
        <div className="mt-4 rounded-2xl border border-line-hairline bg-surface shadow-card px-4 sm:px-5 py-3">{children}</div>
      )}
      {/* Вкладки раздела: на компьютере они подпунктами в боковом меню, здесь — только на телефоне и планшете.
          Компонент рисуется всегда: он и сообщает вкладки меню (ShellTabs). */}
      {hasTabs && (
        <div className="mt-3 lg:hidden">
          <SectionTabs tabs={tabs!} />
        </div>
      )}
    </header>
  );
}
