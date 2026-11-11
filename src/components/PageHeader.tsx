import clsx from "clsx";
import type { ReactNode } from "react";
import type { IconName } from "./Icon";
import SectionTabs from "./SectionTabs";
import Crumbs from "./Crumbs";
import type { AreaKey } from "@/lib/areas";

/**
 * Шапка страницы: путь («Клиенты / Лиды»), заголовок и действия справа — одной белой полосой (11.11.2026: без
 * цветного значка раздела и без поиска — поиск стоит в боковом меню, шапка отдана заголовку и главным действиям).
 * `icon` оставлен в свойствах, чтобы не трогать девяносто страниц, которые его передают; он не рисуется.
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
  const hasTabs = !!tabs && tabs.length > 1;
  return (
    <>
      <header
        className={clsx(
          "no-print mb-4",
          // На компьютере — белая полоса во всю ширину сверху: где вы, заголовок, действия. Поиск переехал в меню.
          "lg:sticky lg:top-0 lg:z-20 lg:-mx-8 lg:-mt-6 lg:mb-6 lg:px-8 lg:py-3 lg:bg-surface/95 lg:backdrop-blur lg:border-b lg:border-line-hairline",
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:min-h-[40px]">
          <div className="min-w-0 mr-auto">
            <Crumbs area={area} title={title} lead={eyebrow} />
            <h1 className="text-[19px] sm:text-[20px] lg:text-[18px] leading-6 font-semibold tracking-tight break-words">{title}</h1>
            {subtitle && <div className="text-[13px] leading-5 text-ink-secondary mt-0.5">{subtitle}</div>}
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
      {children && <div className="no-print mb-5 rounded-xl border border-line-hairline bg-surface px-4 sm:px-5 py-3">{children}</div>}
    </>
  );
}
