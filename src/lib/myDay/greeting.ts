import { APP_TIME_ZONE } from "../timezone";

/** Контракт экрана «Мой день»: кто смотрит. Один на все четыре экрана (`src/components/myday/*`). */
export interface DayUser {
  email: string;
  name: string;
  role: string;
  /** Производство зав. складом / агронома; у остальных null. */
  farm: string | null;
}

/** «Доброе утро, Ильяс» — по алматинскому времени; без имени — просто «Доброе утро». */
export function dayGreeting(name: string, now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("ru-RU", { hour: "numeric", hour12: false, timeZone: APP_TIME_ZONE }).format(now));
  const word = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const first = (name || "").trim().split(/\s+/)[0];
  return first ? `${word}, ${first}` : word;
}
