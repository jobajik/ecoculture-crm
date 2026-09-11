/**
 * «Страница из старой версии сайта» — самая частая причина белого экрана с
 * английской надписью «Application error».
 *
 * Как это происходит. Человек открыл CRM на телефоне и не закрыл вкладку. За
 * это время сайт обновился: Vercel собрал новую версию, и файлы старой с
 * сервера исчезли (у каждой сборки свои имена файлов). Телефон хранит вкладку
 * сутками, и при следующем касании страница пытается догрузить кусок кода,
 * которого на сервере уже нет, — или отправить действие (сохранить заявку,
 * отметить оплату), у которого в новой версии другой адрес.
 *
 * Ошибка выглядит поломкой, но данные целы: достаточно перезагрузить страницу.
 * Ровно это и делает `looksLikeStaleVersion()` — она отличает такую ошибку от
 * настоящей, чтобы перезагрузить самому и не пугать человека.
 *
 * Чинить это «реже обновляться» нельзя: правки нужны каждый день. Поэтому
 * лечение — на стороне страницы.
 */

/** Тексты, которыми браузеры сообщают «файла этой версии больше нет». */
const STALE_PATTERNS = [
  // Кусок кода не загрузился: имя файла осталось от прошлой сборки.
  /ChunkLoadError/i,
  /Loading chunk \S+ failed/i,
  /Loading CSS chunk/i,
  // Safari и Firefox говорят об этом своими словами.
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  // Вместо файла .js сервер вернул страницу с ошибкой — браузер видит «<».
  /Unexpected token '<'/i,
  /expected expression, got '<'/i,
  // Серверное действие из старой сборки: в новой у него другой номер.
  /Failed to find Server Action/i,
  /Invalid Server Actions request/i,
];

/**
 * Похожа ли ошибка на «страница из старой версии».
 *
 * Функция чистая и лежит в `src/lib`, а не в компоненте: её зовут и экран
 * ошибки в браузере, и проверочный скрипт (грабли 1.8 — значение из файла с
 * «use client» на сервере не вызвать).
 */
export function looksLikeStaleVersion(error: unknown): boolean {
  const parts: string[] = [];
  if (typeof error === "string") parts.push(error);
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; message?: unknown; digest?: unknown };
    if (typeof e.name === "string") parts.push(e.name);
    if (typeof e.message === "string") parts.push(e.message);
    if (typeof e.digest === "string") parts.push(e.digest);
  }
  const text = parts.join(" ");
  if (!text) return false;
  return STALE_PATTERNS.some((rx) => rx.test(text));
}

/** Сколько ждать между самостоятельными перезагрузками, мс. */
export const RELOAD_COOLDOWN_MS = 20_000;

/**
 * Можно ли перезагрузить страницу самому.
 *
 * Защита от кольца: если ошибка не в старой версии, а в самой странице,
 * перезагрузка выдаст ту же ошибку — и так до бесконечности, с мигающим
 * экраном. Поэтому перезагружаемся не чаще одного раза в `RELOAD_COOLDOWN_MS`,
 * а на второй раз показываем человеку текст и кнопку.
 */
export function shouldAutoReload(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null) return true;
  return now - lastReloadAt > RELOAD_COOLDOWN_MS;
}
