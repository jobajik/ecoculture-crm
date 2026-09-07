"use client";

import clsx from "clsx";

/**
 * Кнопка «показать ещё» под сокращённым списком.
 *
 * Списки на страницах длинные — сортов роз шестнадцать, партий сотня, — и если
 * показывать всё сразу, страница превращается в полотно, по которому нечего
 * читать. Поэтому везде показываем немного, а остальное разворачивается по
 * клику. Скрытое всегда посчитано в подписи: «показать ещё 11» честнее, чем
 * многоточие, потому что видно, сколько именно осталось за кадром.
 *
 * Сама кнопка состояние не хранит — им управляет список, который её показывает.
 * Так один и тот же вид кнопки работает и в карточке, и под таблицей.
 */
export default function MoreToggle({
  expanded,
  hidden,
  onToggle,
  className,
  what = "позиций",
}: {
  expanded: boolean;
  /** Сколько строк скрыто сейчас. Если ноль — кнопки нет. */
  hidden: number;
  onToggle: () => void;
  className?: string;
  /** Родительный падеж множественного числа: «сортов», «партий», «позиций». */
  what?: string;
}) {
  if (hidden <= 0 && !expanded) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        "text-xs font-medium text-accent hover:underline",
        "inline-flex items-center gap-1",
        className
      )}
    >
      <span aria-hidden className="text-[10px]">
        {expanded ? "▲" : "▼"}
      </span>
      {expanded ? "Свернуть" : `Показать ещё ${hidden} ${what}`}
    </button>
  );
}

/** Сколько элементов показывать в свёрнутом виде. Держим в одном месте. */
export const COLLAPSED_LIST_SIZE = 5;
export const COLLAPSED_TABLE_SIZE = 12;
