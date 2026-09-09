/**
 * Показ дат человеку. Один модуль на весь проект, потому что двумя строчками
 * `new Date(x).toLocaleDateString()` мы уже обожглись.
 *
 * Две ловушки, ради которых это вынесено:
 *
 * 1. `new Date("46274")` — это не ошибка, а 1 января 46274 года. Ровно это и
 *    показала страница заявки, когда таблица вернула дату серийником. Поэтому
 *    здесь на входе ждут уже приведённое «ГГГГ-ММ-ДД» (см. sheetDate.ts), а всё
 *    непонятное честно превращается в прочерк.
 * 2. `new Date("2026-09-08")` разбирается как ПОЛНОЧЬ ПО ГРИНВИЧУ. В минусовом
 *    часовом поясе это вчерашний день — дата доставки уехала бы на сутки.
 *    Поэтому к чистой дате дописывается «T00:00:00»: так она читается как
 *    местная полночь.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parse(value: string | null | undefined): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const d = new Date(DAY.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return null;
  // Дата за пределами разумного — почти наверняка неразобранный серийник.
  const year = d.getFullYear();
  if (year < 2000 || year > 2100) return null;
  return d;
}

/** «08.09.2026». Пустое и непонятное — прочерк. */
export function formatDay(value: string | null | undefined, dash = "—"): string {
  const d = parse(value);
  return d ? d.toLocaleDateString("ru-RU") : dash;
}

/** «08.09.2026, 09:30». Если времени в значении нет — только дата. */
export function formatMoment(value: string | null | undefined, dash = "—"): string {
  const d = parse(value);
  if (!d) return dash;
  const raw = String(value).trim();
  if (DAY.test(raw)) return d.toLocaleDateString("ru-RU");
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
