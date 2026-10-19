"use client";

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";

/**
 * Вкладки над панелями страницы (новый вид, 19.10.2026: «одностраничный, без прокрутки»): вместо ленты блоков друг
 * под другом — одна панель за раз. Неактивные панели остаются в разметке скрытыми, поэтому набранное в форме не
 * теряется при переключении. `switchOn` — событие окна, по которому открывается нужная вкладка (например, «Перенести в
 * касание» из разбора ИИ открывает форму касания).
 */
export interface PaneTab {
  key: string;
  label: string;
  /** Число рядом с подписью. */
  count?: number;
  /** Красная точка — «ждёт ответа». */
  alert?: boolean;
  content: ReactNode;
}

export default function PaneTabs({
  tabs,
  initial,
  switchOn,
  accent = "border-section-leads",
  boxed = false,
}: {
  tabs: PaneTab[];
  initial?: string;
  switchOn?: { event: string; to: string };
  /** Класс цвета подчёркивания активной вкладки — цвет раздела. */
  accent?: string;
  /** Вкладки внутри одной карточки (`card !p-0`): содержимое — списки и таблицы во всю ширину карточки. */
  boxed?: boolean;
}) {
  const visible = tabs.filter((t) => t.content);
  const [active, setActive] = useState(initial && visible.some((t) => t.key === initial) ? initial : visible[0]?.key);

  useEffect(() => {
    if (!switchOn) return;
    const go = () => setActive(switchOn.to);
    window.addEventListener(switchOn.event, go);
    return () => window.removeEventListener(switchOn.event, go);
  }, [switchOn]);

  if (visible.length === 0) return null;
  if (boxed) {
    return (
      <div className="card !p-0 overflow-hidden min-w-0">
        <div className="flex gap-x-5 overflow-x-auto scroll-x-hidden border-b border-line-hairline px-4">
          {visible.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={clsx(
                "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
                active === t.key ? clsx(accent, "text-ink-primary font-semibold") : "border-transparent text-ink-secondary hover:text-ink-primary"
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 text-ink-muted font-normal tabular-nums">{t.count}</span>}
              {t.alert && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-status-critical align-middle" aria-label="требует внимания" />}
            </button>
          ))}
        </div>
        {visible.map((t) => (
          <div key={t.key} className={active === t.key ? "" : "hidden"}>
            {t.content}
          </div>
        ))}
      </div>
    );
  }
  if (visible.length === 1) return <>{visible[0].content}</>;
  return (
    <div className="min-w-0">
      <div className="flex gap-x-5 overflow-x-auto scroll-x-hidden border-b border-line-hairline mb-4">
        {visible.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={clsx(
              "relative py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
              active === t.key ? clsx(accent, "text-ink-primary font-semibold") : "border-transparent text-ink-secondary hover:text-ink-primary"
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-ink-muted font-normal tabular-nums">{t.count}</span>}
            {t.alert && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-status-critical align-middle" aria-label="ждёт ответа" />}
          </button>
        ))}
      </div>
      {visible.map((t) => (
        <div key={t.key} className={active === t.key ? "space-y-4" : "hidden"}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
