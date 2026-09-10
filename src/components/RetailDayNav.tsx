"use client";

import Link from "next/link";
import clsx from "clsx";

/**
 * Переключатель дня для заявки по магазинам.
 *
 * Пять дней подряд ссылками плюс поле даты. Кнопки, а не только календарь,
 * потому что менеджер розницы почти всегда работает с завтра и послезавтра, и
 * два клика по календарю ради этого — лишние. Поле остаётся для редкого
 * случая, когда нужен день подальше.
 */
export default function RetailDayNav({
  date,
  today,
  basePath = "/retail",
  extra,
}: {
  date: string;
  today: string;
  /** Куда ведут ссылки: лист по магазинам или страница региона. */
  basePath?: string;
  /** Что дотащить в адрес, кроме даты, — например выбранный город. */
  extra?: Record<string, string>;
}) {
  const query = (day: string) => {
    const params = new URLSearchParams(extra ?? {});
    params.set("date", day);
    return `${basePath}?${params.toString()}`;
  };
  const base = new Date(`${today}T00:00:00`);
  const days: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    days.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
    );
  }

  const label = (key: string, idx: number) => {
    if (idx === 0) return "Сегодня";
    if (idx === 1) return "Завтра";
    const d = new Date(`${key}T00:00:00`);
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {days.map((key, idx) => (
        <Link
          key={key}
          href={query(key)}
          className={clsx(
            "px-3 py-1.5 rounded-lg text-sm border transition-colors",
            key === date
              ? "border-accent bg-accent-soft text-ink-primary font-medium"
              : "border-line-hairline text-ink-secondary hover:text-ink-primary"
          )}
        >
          {label(key, idx)}
        </Link>
      ))}
      <form action={basePath} className="flex items-center gap-2">
        {Object.entries(extra ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input
          type="date"
          name="date"
          defaultValue={date}
          className="input !w-auto !py-1.5 text-sm"
        />
        <button type="submit" className="btn-secondary !py-1.5 text-sm">
          Показать
        </button>
      </form>
    </div>
  );
}
