import Link from "next/link";
import clsx from "clsx";
import Icon, { type IconName } from "@/components/Icon";

/**
 * Переключатель вида внутри вкладки «Теплицы» (что смотрим в «Записях», какой вопрос в «Аналитике»): ровная полоса
 * сегментов со значками, выбранный — цветом раздела. Ссылки, без состояния — рисуют серверные страницы.
 */
export default function GhSegments({ items, active }: { items: { key: string; label: string; href: string; icon?: IconName; note?: string }[]; active: string }) {
  return (
    <div className="flex gap-1 p-1 rounded-2xl bg-surface-sunk/70 border border-line-hairline overflow-x-auto scroll-x-hidden">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Link
            key={it.key}
            href={it.href}
            className={clsx(
              "flex-1 min-w-max h-10 px-3.5 rounded-xl text-sm whitespace-nowrap inline-flex items-center justify-center gap-2 transition-colors",
              on ? "bg-surface text-ink-primary font-semibold shadow-card" : "text-ink-secondary hover:text-ink-primary hover:bg-surface/60",
            )}
          >
            {it.icon && <Icon name={it.icon} className={clsx("w-4 h-4", on ? "text-section-greenhouse" : "text-ink-muted")} />}
            {it.label}
            {it.note && <span className={clsx("text-xs tabular-nums", on ? "text-section-greenhouse" : "text-ink-muted")}>{it.note}</span>}
          </Link>
        );
      })}
    </div>
  );
}
