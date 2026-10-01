/**
 * Листание дня / недели / месяца назад и вперёд (октябрь 2026, владелец: «сделай
 * возможность смотреть предыдущий месяц по оплатам и по всем остальным задачам;
 * Юлия не может посмотреть незакрытые сделки сентября»). Страницы «Оплаты»,
 * «Отчёт» и «Рейтинг» умели принимать `?date=`, но кнопки туда не было, и первого
 * числа месяц открывался пустым.
 *
 * Якорь — первый день показанного отрезка (`from` у снимка). Чистые функции:
 * их зовёт и сервер, и браузер (грабли 1.8).
 */
export type StepPeriod = "day" | "week" | "month";

const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Начало соседнего отрезка: день ±1, неделя ±7 дней, месяц — первое число соседнего. */
export function stepAnchor(period: StepPeriod, from: string, dir: -1 | 1): string {
  const d = new Date(`${from}T12:00:00`);
  if (period === "day") d.setDate(d.getDate() + dir);
  else if (period === "week") d.setDate(d.getDate() + 7 * dir);
  else {
    d.setDate(1);
    d.setMonth(d.getMonth() + dir);
  }
  return key(d);
}

/** Сегодня внутри показанного отрезка — значит, это текущий период. */
export function isCurrentRange(from: string, to: string, today: string): boolean {
  return from <= today && today <= to;
}

/** Вперёд листать некуда, если следующий отрезок начинается позже сегодняшнего дня. */
export function canStepForward(period: StepPeriod, from: string, today: string): boolean {
  return stepAnchor(period, from, 1) <= today;
}
