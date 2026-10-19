import clsx from "clsx";
import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import SectionTabs from "./SectionTabs";
import Crumbs from "./Crumbs";
import SearchTrigger from "./SearchTrigger";
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
  /** Первая «крошка» вместо названия раздела. */
  eyebrow?: ReactNode;
  icon?: IconName;
  /** Кнопки справа: «+ Заявка», выгрузка, период. */
  actions?: ReactNode;
  tabs?: { href: string; label: string; match?: string[] }[];
  children?: ReactNode;
  className?: string;
}) {
  const a = AREAS[area];
  const hasTabs = !!tabs && tabs.length > 1;
  return (
    <>
      <header
        className={clsx(
          "no-print mb-5",
          // На компьютере — белая полоса во всю ширину сверху, как на прототипе владельца: заголовок, крошки, кнопки.
          "lg:sticky lg:top-0 lg:z-20 lg:-mx-8 lg:-mt-6 lg:mb-6 lg:px-8 lg:py-3.5 lg:bg-surface/95 lg:backdrop-blur lg:border-b lg:border-line-hairline",
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3 min-w-0 mr-auto">
            <span className={clsx("w-10 h-10 rounded-xl grid place-items-center flex-none", a.soft, a.text)}>
              <Icon name={icon ?? a.icon} className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-[20px] sm:text-[22px] leading-tight font-extrabold tracking-tight break-words">
                {title}
              </h1>
              <div className="mt-0.5">
                <Crumbs area={area} title={title} lead={eyebrow} />
              </div>
              {subtitle && <div className="text-sm text-ink-secondary mt-0.5">{subtitle}</div>}
            </div>
          </div>
          {/* Общий поиск по сайту — в середине шапки на компьютере (на телефоне он в верхней полоске). */}
          <div className="hidden lg:block flex-1 max-w-[460px]">
            <SearchTrigger />
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {/* Вкладки раздела: на компьютере они подпунктами в боковом меню, здесь — только на телефоне и планшете.
            Компонент рисуется всегда: он и сообщает вкладки меню (ShellTabs). */}
        {hasTabs && (
          <div className="mt-3 lg:hidden">
            <SectionTabs tabs={tabs!} />
          </div>
        )}
      </header>
      {children && (
        <div className="no-print mb-5 rounded-2xl border border-line-hairline bg-surface shadow-card px-4 sm:px-5 py-3">{children}</div>
      )}
    </>
  );
}
