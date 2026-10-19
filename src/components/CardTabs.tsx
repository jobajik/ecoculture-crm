"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Вкладки внутри карточки (новый вид, 19.10.2026: «одностраничный, без прокрутки»): ряд кнопок с подчёркиванием
 * цветом раздела, как в «Клиентах». Нужен разделам Продажи, Планы, Прайс, Прогноз и Аналитика — длинная лента
 * блоков друг под другом превращается в одну карточку с переключателем.
 */
export type CardTabsTone = "sales" | "plans" | "forecast" | "analytics";

const BORDER: Record<CardTabsTone, string> = {
  sales: "border-section-sales",
  plans: "border-section-plans",
  forecast: "border-section-forecast",
  analytics: "border-section-analytics",
};

export default function CardTabs<K extends string>({
  items,
  value,
  onChange,
  tone,
  right,
}: {
  items: { key: K; label: ReactNode }[];
  value: K;
  onChange: (key: K) => void;
  tone: CardTabsTone;
  /** Что-то справа в той же строке: период, «обновляю…». */
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={clsx(
            "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
            value === it.key ? clsx(BORDER[tone], "text-ink-primary font-semibold") : "border-transparent text-ink-secondary hover:text-ink-primary"
          )}
        >
          {it.label}
        </button>
      ))}
      {right && <div className="ml-auto py-2 flex items-center gap-3 text-sm">{right}</div>}
    </div>
  );
}
