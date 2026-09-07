/**
 * Приведение даты из Google-таблицы к виду «ГГГГ-ММ-ДД».
 *
 * Зачем это нужно. Таблица отдаёт значения ячеек так, как они ОТОБРАЖАЮТСЯ, а не
 * так, как записаны. Если у ячейки стоит формат даты, «2026-09-03» вернётся как
 * «03.09.2026» — и дальше ломается сразу всё: `new Date("03.09.2026")` даёт
 * Invalid Date (срок хранения становится 0 дней), а сортировка FIFO сравнивает
 * даты как строки и ставит «03.09.2026» раньше «02.10.2026».
 *
 * Так уже случилось на боевых данных: при загрузке склада роза, срезанная
 * четыре дня назад, показывалась свежей — 12 705 стеблей.
 *
 * Второй повод: зав. складом может поправить дату прямо в таблице и напишет её
 * по-русски — «5.09.2026». Это тоже должно читаться.
 *
 * Третий, самый коварный, и именно он тогда и сработал: если у ячейки числовой
 * формат, дата возвращается ГОЛЫМ ЧИСЛОМ — «46268». Это внутренний счётчик дней
 * Google от 30.12.1899. Четыре ячейки из ста двадцати шести оказались такими —
 * заранее не угадаешь, какие, поэтому читатель обязан понимать все три вида.
 */

/** День 0 внутреннего счётчика Google Sheets. */
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Разумные границы для серийного номера: примерно с 1954 по 2064 год. Нужны,
 * чтобы не превратить в дату случайное число вроде количества стеблей.
 */
const MIN_SERIAL = 20000;
const MAX_SERIAL = 60000;

/** Строит «ГГГГ-ММ-ДД» без часовых поясов: getUTC* здесь только запутали бы. */
function iso(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Возвращает дату в виде «ГГГГ-ММ-ДД» или пустую строку, если разобрать не
 * удалось. Пустая строка лучше выдуманной даты: по ней сразу видно, что с
 * ячейкой что-то не так, а срок хранения не соврёт в меньшую сторону.
 */
export function toIsoDate(raw: unknown): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return iso(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }

  const value = String(raw ?? "").trim();
  if (!value) return "";

  // Серийный номер Google Sheets: «46268» — это 3 сентября 2026 года.
  if (/^\d{5}(?:[.,]\d+)?$/.test(value)) {
    const serial = Number(value.replace(",", "."));
    if (serial >= MIN_SERIAL && serial <= MAX_SERIAL) {
      const d = new Date(SHEETS_EPOCH_UTC + Math.floor(serial) * 86_400_000);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return "";
  }

  // Уже ISO, возможно со временем: «2026-09-03», «2026-09-03T08:00:00».
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(value);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number) as unknown as number[];
    return isRealDate(y, m, d) ? iso(y, m, d) : "";
  }

  // Привычная запись: «03.09.2026», «3/9/2026», «03-09-2026».
  const ruMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
  if (ruMatch) {
    const [, d, m, y] = ruMatch.map(Number) as unknown as number[];
    return isRealDate(y, m, d) ? iso(y, m, d) : "";
  }

  // Двузначный год: «03.09.26» — считаем, что это 2000-е.
  const shortMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(value);
  if (shortMatch) {
    const [, d, m, y] = shortMatch.map(Number) as unknown as number[];
    return isRealDate(2000 + y, m, d) ? iso(2000 + y, m, d) : "";
  }

  return "";
}
