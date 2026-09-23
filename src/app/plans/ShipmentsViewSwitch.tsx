import Link from "next/link";
import clsx from "clsx";

/**
 * Два вида одной вкладки «Отгрузки»: план по неделям (с фактом в каждой
 * клетке) и подробный факт по регионам с заявками. Раньше факт был отдельной
 * вкладкой «Регионы» — план и его выполнение лежали в разных местах.
 */
export default function ShipmentsViewSwitch({ view, month }: { view: "plan" | "fact"; month: string }) {
  const items = [
    { key: "plan", href: `/plans/shipments?period=${month}`, label: "План по неделям" },
    { key: "fact", href: `/plans/regions?period=${month}`, label: "Факт и заявки" },
  ] as const;
  return (
    <div className="inline-flex rounded-lg border border-line-hairline bg-surface-plane p-1" role="tablist">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          role="tab"
          aria-selected={view === i.key}
          className={clsx(
            "rounded-md px-3 py-1.5 text-sm",
            view === i.key ? "bg-surface shadow-sm font-medium" : "text-ink-secondary hover:text-ink-primary"
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
