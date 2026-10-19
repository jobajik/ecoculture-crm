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
    // Новый вид (19.10.2026): вкладки внутри карточки, подчёркнуты цветом розницы.
    <div className="flex flex-wrap gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
      {cities.map((city) => (
        <Link
          key={city}
          href={`/retail/regions?city=${encodeURIComponent(city)}&date=${date}`}
          className={clsx(
            "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
            city === current
              ? "border-section-retail text-ink-primary font-semibold"
              : "border-transparent text-ink-secondary hover:text-ink-primary"
          )}
        >
          {city}
        </Link>
      ))}
    </div>
  );
}
