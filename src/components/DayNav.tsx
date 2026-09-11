"use client";

import Link from "next/link";
import clsx from "clsx";

/**
 * Переключатель дня: пять дней подряд ссылками плюс поле даты.
 *
 * Кнопки, а не только календарь, потому что почти вся работа идёт с двумя-тремя
 * ближайшими днями, и два клика по календарю ради этого — лишние. Поле
 * остаётся для редкого случая, когда нужен день подальше.
 *
 * Компонент один на все разделы намеренно. Он начинался как переключатель для
 * заявки по магазинам, потом понадобился в регионах, потом на выдачах
 * сотрудникам — и второй копией они бы разъехались, как уже разъезжалась
 * проверка готовности заявки по четырём местам.
 *
 * Направление разное, и это не мелочь: заявку собирают НАПЕРЁД (сегодня,
 * завтра, послезавтра), а выдачу записывают ЗАДНИМ числом (сегодня, вчера,
 * позавчера). Показать зав. складом четыре будущих дня значило бы предложить
 * ей четыре заведомо пустые страницы.
 */
export default function DayNav({
  date,
  today,
  basePath = "/retail",
  extra,
  direction = "forward",
}: {
  date: string;
  today: string;
  /** Куда ведут ссылки. */
  basePath?: string;
  /** Что дотащить в адрес, кроме даты, — например выбранный город. */
  extra?: Record<string, string>;
  /** «forward» — сегодня и вперёд, «back» — сегодня и назад. */
  direction?: "forward" | "back";
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
    d.setDate(d.getDate() + (direction === "back" ? -i : i));
    days.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`
    );
  }

  const label = (key: string, idx: number) => {
    if (idx === 0) return "Сегодня";
    if (idx === 1) return direction === "back" ? "Вчера" : "Завтра";
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
