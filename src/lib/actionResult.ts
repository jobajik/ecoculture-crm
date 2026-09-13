/**
 * Отказ сервера, который ДОХОДИТ до человека.
 *
 * Тут вскрылась дыра, о которой я не знал, а владелец увидел её на боевом
 * сайте. Все запреты в программе написаны понятными словами — «Это клиент
 * другого менеджера», «в партии осталось 200». Но написаны они через
 * `throw new Error(...)` внутри серверного действия, а Next.js в боевой сборке
 * ПОДМЕНЯЕТ текст любой такой ошибки на английскую заглушку:
 *
 *   «An error occurred in the Server Components render. The specific message is
 *   omitted in production builds to avoid leaking sensitive details…»
 *
 * Делает он это нарочно, чтобы наружу не утекло содержимое ошибки. Но цена —
 * человек вместо «сначала снимите оплату» получает абзац по-английски и не
 * понимает ни что случилось, ни что делать. На своём компьютере, где сборка
 * отладочная, этого не видно вовсе: там текст доходит целиком. Именно поэтому
 * я и не замечал этого много недель.
 *
 * Лечится только одним способом: отказ не БРОСАЮТ, а ВОЗВРАЩАЮТ. Возвращённое
 * значение Next.js не трогает.
 *
 * Отсюда порядок, общий для всей программы:
 *
 * 1. серверное действие оборачивается `guard()` — оно ловит свой же
 *    `throw new Error("понятный текст")` и возвращает его как отказ;
 * 2. в браузере вызов оборачивается `unwrap()` — он превращает отказ обратно в
 *    исключение с ТЕМ ЖЕ текстом, и все существующие `try/catch` в формах
 *    продолжают работать как работали;
 * 3. забыть `unwrap()` нельзя: за этим следит `scripts/check-action-refusals.ts`.
 *    Без него форма приняла бы отказ за успех и молча закрылась, ничего не
 *    сохранив, — это хуже английской заглушки.
 */

/** Ключ намеренно длинный и странный: его не спутать с полем настоящего ответа. */
const REFUSAL_KEY = "__serverRefusal";

export interface Refusal {
  [REFUSAL_KEY]: string;
}

export function isRefusal(value: unknown): value is Refusal {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[REFUSAL_KEY] === "string"
  );
}

/**
 * Собственные ошибки Next.js — переход на другую страницу и «не найдено» —
 * тоже бросаются исключением. Их ловить НЕЛЬЗЯ: поймав, мы отменим переход, и
 * человек останется на странице, думая, что ничего не произошло.
 */
function isFrameworkError(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/** Превращает пойманную ошибку в отказ. Служебные ошибки Next.js пропускает дальше. */
export function refusalOf(error: unknown): Refusal {
  if (isFrameworkError(error)) throw error;
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Не получилось. Попробуйте ещё раз, а если повторится — покажите этот экран администратору.";
  return { [REFUSAL_KEY]: message };
}

/**
 * Оболочка серверного действия: собственный отказ возвращается, а не бросается.
 *
 * Зачем отдельной функцией, а не try/catch в каждом действии: так у всех
 * двадцати с лишним действий поведение ОДНО, и оно описано в одном месте.
 * Разъедься эти try/catch по файлам — через месяц половина из них ловила бы
 * ошибки чуть иначе.
 */
export async function guard<T>(run: () => Promise<T>): Promise<T | Refusal> {
  try {
    return await run();
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * В браузере: отказ снова становится исключением с человеческим текстом.
 *
 * Благодаря этому формы не переписывались: их `try/catch` ловит ту же ошибку,
 * что и раньше, — только теперь с настоящим текстом, а не с английской
 * заглушкой Next.js.
 */
export function unwrap<T>(result: T | Refusal): T {
  if (isRefusal(result)) throw new Error(result[REFUSAL_KEY]);
  return result as T;
}
