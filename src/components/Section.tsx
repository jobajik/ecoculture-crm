import clsx from "clsx";
import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

/**
 * Раздел карточки с цветом по смыслу.
 *
 * Владелец: «визуально выделять и определять такие вещи… а то сейчас как белый
 * фон всё». Поэтому у каждого раздела полоска слева и значок в заголовке одного
 * цвета: клиент — синий, позиции и склад — фиолетовый, претензии — оранжевый,
 * деньги — по СОСТОЯНИЮ (оплачено — зелёный, ждём — жёлтый, просрочено —
 * красный). Фон остаётся белым: цвет метит раздел, а не заливает его, иначе
 * страница станет пёстрой и перестанет предупреждать (как с цветом цветка).
 *
 * Без "use client": рисуют и серверные страницы, и клиентские компоненты.
 */
export type SectionTone =
  | "order"
  | "client"
  | "stock"
  | "claims"
  | "money"
  | "sales"
  | "plans"
  | "retail"
  | "leads"
  | "analytics"
  | "admin"
  | "forecast"
  | "good"
  | "warn"
  | "bad"
  | "neutral";

export const SECTION_TONE: Record<SectionTone, { stripe: string; chip: string; title: string }> = {
  order: { stripe: "bg-accent", chip: "bg-accent-soft text-accent", title: "text-accent" },
  client: { stripe: "bg-section-client", chip: "bg-section-client-soft text-section-client", title: "text-section-client" },
  stock: { stripe: "bg-section-stock", chip: "bg-section-stock-soft text-section-stock", title: "text-section-stock" },
  claims: { stripe: "bg-section-claims", chip: "bg-section-claims-soft text-section-claims", title: "text-section-claims" },
  money: { stripe: "bg-section-money", chip: "bg-section-money-soft text-section-money", title: "text-section-money" },
  sales: { stripe: "bg-section-sales", chip: "bg-section-sales-soft text-section-sales", title: "text-section-sales" },
  plans: { stripe: "bg-section-plans", chip: "bg-section-plans-soft text-section-plans", title: "text-section-plans" },
  retail: { stripe: "bg-section-retail", chip: "bg-section-retail-soft text-section-retail", title: "text-section-retail" },
  leads: { stripe: "bg-section-leads", chip: "bg-section-leads-soft text-section-leads", title: "text-section-leads" },
  analytics: {
    stripe: "bg-section-analytics",
    chip: "bg-section-analytics-soft text-section-analytics",
    title: "text-section-analytics",
  },
  admin: { stripe: "bg-section-admin", chip: "bg-section-admin-soft text-section-admin", title: "text-section-admin" },
  forecast: {
    stripe: "bg-section-forecast",
    chip: "bg-section-forecast-soft text-section-forecast",
    title: "text-section-forecast",
  },
  good: { stripe: "bg-status-good", chip: "bg-status-good/10 text-status-good", title: "text-status-good" },
  warn: { stripe: "bg-status-warning", chip: "bg-status-warning/15 text-[#8a5a00]", title: "text-[#8a5a00]" },
  bad: { stripe: "bg-status-critical", chip: "bg-status-critical/10 text-status-critical", title: "text-status-critical" },
  neutral: { stripe: "bg-line-strong", chip: "bg-surface-sunk text-ink-secondary", title: "text-ink-secondary" },
};

export default function Section({
  tone,
  icon,
  title,
  aside,
  flush = false,
  className,
  children,
}: {
  tone: SectionTone;
  icon: IconName;
  title: ReactNode;
  /** Справа в заголовке: сумма, ссылка, метка. */
  aside?: ReactNode;
  /** Тело без отступов — для таблиц во всю ширину. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = SECTION_TONE[tone];
  return (
    <section className={clsx("card !p-0 relative overflow-hidden mb-5", className)}>
      <span className={clsx("absolute inset-y-0 left-0 w-1", t.stripe)} aria-hidden="true" />
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 pr-4 sm:pr-5 pt-4 pb-3">
        <span className={clsx("w-7 h-7 rounded-lg grid place-items-center flex-none", t.chip)}>
          <Icon name={icon} className="w-4 h-4" />
        </span>
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">{title}</h2>
        {aside && <div className="ml-auto text-sm">{aside}</div>}
      </header>
      <div className={flush ? "" : "pl-5 pr-4 sm:pr-5 pb-5"}>{children}</div>
    </section>
  );
}

/** Строка «значок · подпись · значение» внутри раздела. */
export function Fact({
  icon,
  label,
  children,
  tone,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
  tone?: "warn";
}) {
  return (
    <div className="flex gap-3 min-w-0">
      <span
        className={clsx(
          "mt-0.5 w-8 h-8 rounded-full grid place-items-center flex-none",
          tone === "warn" ? "bg-status-warning/15 text-[#8a5a00]" : "bg-surface-plane text-ink-muted"
        )}
      >
        <Icon name={icon} className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-[15px] break-words">{children}</div>
      </div>
    </div>
  );
}
