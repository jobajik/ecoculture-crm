"use client";

import { useState } from "react";

/**
 * Позиции заявки в ячейке таблицы: первая строка плюс «ещё N».
 *
 * В заявке бывает одна позиция, а бывает двадцать пять, и список через запятую
 * растягивал строку таблицы на пять рядов текста, пока соседняя оставалась в
 * один. Глаз, идущий сверху вниз, каждый раз терял место: «Сумма» одной заявки
 * оказывалась на уровне «Клиента» соседней.
 *
 * Один компонент на все списки заявок — в заявках, на складе и везде, где они
 * ещё появятся. Три копии этой мелочи разъехались бы так же, как когда-то
 * разъехалась проверка готовности по четырём файлам.
 *
 * Свёрнута именно ПЕРВАЯ позиция, а не «Розы, 9 позиций»: в девяти случаях из
 * десяти заявка про один цветок, и первая строка отвечает на вопрос «что это»
 * без раскрытия. Число рядом отвечает на второй вопрос — «а сколько там ещё».
 */
export default function ItemsCell({
  lines,
  /** Ширина, за которую ячейка не выходит. Внутри текст обрезается. */
  width = "max-w-[340px]",
}: {
  lines: string[];
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  if (lines.length === 0) return <span className="text-ink-muted">—</span>;

  const rest = lines.length - 1;

  if (open) {
    return (
      <div className={width}>
        {lines.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-series-1 hover:underline mt-1"
        >
          свернуть
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-baseline gap-2 ${width}`}>
      {/* min-w-0 обязателен. Без него обрезка внутри flex не работает вовсе:
          минимальная ширина элемента остаётся равной длине всего текста, и
          таблица вылезает за край страницы боковой полосой прокрутки — ровно
          это владелец и увидел. */}
      <span className="truncate min-w-0" title={lines.join(", ")}>
        {lines[0]}
      </span>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-series-1 hover:underline whitespace-nowrap shrink-0"
        >
          ещё {rest}
        </button>
      )}
    </div>
  );
}
