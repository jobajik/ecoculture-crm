import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import Icon, { type IconName } from "../Icon";
import { SECTION_TONE, type SectionTone } from "../Section";
import Pill, { type PillTone } from "../Pill";

/**
 * Карточка экрана «Мой день» (19.10.2026, макет принят владельцем): заголовок со значком цвета раздела, число
 * в метке, ссылка «все…» справа, ниже — строки `DayRow`. Одна и та же у всех ролей, чтобы четыре экрана читались
 * как один сайт. Без "use client": рисуют серверные компоненты.
 */
export default function DayCard({
  tone,
  icon,
  title,
  count,
  countTone,
  hint,
  link,
  children,
  className,
  flush = true,
}: {
  tone: SectionTone;
  icon?: IconName;
  title: ReactNode;
  count?: number | string;
  countTone?: PillTone;
  /** Серая подсказка рядом с заголовком. */
  hint?: ReactNode;
  link?: { href: string; label: string };
  children?: ReactNode;
  className?: string;
  /** Строки без внутреннего отступа (список `DayRow`); false — обычный отступ карточки. */
  flush?: boolean;
}) {
  const t = SECTION_TONE[tone];
  return (
    <section className={clsx("card !p-0 overflow-hidden", className)}>
      <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-line-hairline">
        {icon && (
          <span className={clsx("w-8 h-8 rounded-lg grid place-items-center flex-none", t.chip)}>
            <Icon name={icon} className="w-4 h-4" />
          </span>
        )}
        <h2 className="font-display text-[15px] font-bold min-w-0 truncate">{title}</h2>
        {count !== undefined && count !== 0 && count !== "" && <Pill tone={countTone ?? "muted"} dot={false}>{count}</Pill>}
        {hint && <span className="text-xs text-ink-muted hidden sm:inline min-w-0 truncate">{hint}</span>}
        {link && (
          <Link href={link.href} className="ml-auto text-[13px] font-semibold text-accent hover:text-accent-hover whitespace-nowrap">
            {link.label}
          </Link>
        )}
      </div>
      <div className={flush ? "" : "px-4 sm:px-5 py-4"}>{children}</div>
    </section>
  );
}

/** Строка списка в карточке: основной текст слева, метка и кнопки справа; на телефоне кнопки переносятся вниз. */
export function DayRow({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3 border-t border-line-hairline first:border-t-0", className)}>
      <div className="flex-1 min-w-[200px]">{children}</div>
      {right && <div className="flex flex-wrap items-center gap-2 ml-auto">{right}</div>}
    </div>
  );
}

/** Подзаголовок группы внутри карточки («Опаздывают · 2»). */
export function DayGroup({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "bad" | "warn" }) {
  return (
    <div
      className={clsx(
        "px-4 sm:px-5 py-2 bg-surface-plane border-t border-line-hairline first:border-t-0 text-[11px] font-bold uppercase tracking-[0.08em]",
        tone === "bad" ? "text-status-critical" : tone === "warn" ? "text-[#8a5a00]" : "text-ink-muted"
      )}
    >
      {children}
    </div>
  );
}

/** Пустое состояние строкой: «ничего не ждёт» — тоже ответ, а не пустое место. */
export function DayEmpty({ children }: { children: ReactNode }) {
  return <div className="px-4 sm:px-5 py-4 text-sm text-ink-secondary">{children}</div>;
}
