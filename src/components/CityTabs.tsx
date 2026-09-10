"use client";

import Link from "next/link";
import clsx from "clsx";

/**
 * Вкладки городов внутри «Регионов».
 *
 * Вторым рядом, а не в общем ряду раздела: это разрез ОДНОЙ страницы, а не
 * соседние разделы. Смешать их в одну ленту значило бы поставить «Астану» рядом
 * с «Магазинами», и человек каждый раз решал бы заново, что здесь что.
 *
 * Выбранный день переносится между городами: заявку собирают на один и тот же
 * день сразу по всем — переставлять дату на каждой вкладке было бы издевательством.
 */
export default function CityTabs({
  cities,
  current,
  date,
}: {
  cities: string[];
  current: string;
  date: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {cities.map((city) => (
        <Link
          key={city}
          href={`/retail/regions?city=${encodeURIComponent(city)}&date=${date}`}
          className={clsx(
            "px-3 py-1.5 rounded-lg text-sm border transition-colors",
            city === current
              ? "border-accent bg-accent-soft text-ink-primary font-medium"
              : "border-line-hairline text-ink-secondary hover:text-ink-primary"
          )}
        >
          {city}
        </Link>
      ))}
    </div>
  );
}
