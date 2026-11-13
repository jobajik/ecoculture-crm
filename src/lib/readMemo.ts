/**
 * Память чтений: одинаковые чтения вкладки в пределах трёх секунд склеиваются в одно (грабли 1.15).
 *
 * Вынесена из `sheets.ts` 13.11.2026 — в ней нашлась ошибка, и её нужно было покрыть проверкой. Три секунды считались
 * от НАЧАЛА запроса, а не от прихода данных. Набор «Переписки» читается 2,1–2,8 с: к приходу ответа от трёх секунд
 * оставалось 0,2–0,9 с, и чтение, сделанное страницей чуть позже, шло в Google ЗАНОВО — по вкладке за раз. А если ответ
 * шёл дольше трёх секунд, прочитанное было «просрочено» ещё до того, как его запомнили: на замере из Франкфурта набор
 * читался 3,5 с, и весь ответ занял 10–12 с — те же семь вкладок скачались второй раз.
 *
 * Теперь срок идёт от прихода данных. Пока запрос в пути, им пользуются все, кто спросит ту же вкладку (но не дольше
 * `READ_PENDING_MS` — повисший запрос не должен держать всех). Неудачное чтение не запоминается.
 *
 * Чистый модуль с подменяемыми часами — проверка `scripts/check-read-memo.ts`.
 */
export const READ_MEMO_MS = 3000;
export const READ_PENDING_MS = 30_000;

interface Entry<T> {
  startedAt: number;
  /** Когда пришли данные; null — запрос ещё в пути. */
  arrivedAt: number | null;
  promise: Promise<T>;
}

export interface ReadMemo<T> {
  /** Запомненное чтение, если оно ещё годится. */
  get(key: string): Promise<T> | undefined;
  has(key: string): boolean;
  /** Запомнить запрос, который только что начат. Возвращает его же. */
  track(key: string, promise: Promise<T>): Promise<T>;
  /** Запомнить уже полученные данные (пакетное чтение). */
  put(key: string, value: T): void;
  clear(): void;
}

export function createReadMemo<T>(clock: () => number = Date.now): ReadMemo<T> {
  const entries = new Map<string, Entry<T>>();

  function alive(entry: Entry<T> | undefined): entry is Entry<T> {
    if (!entry) return false;
    const now = clock();
    return entry.arrivedAt === null ? now - entry.startedAt < READ_PENDING_MS : now - entry.arrivedAt < READ_MEMO_MS;
  }

  return {
    get(key) {
      const entry = entries.get(key);
      return alive(entry) ? entry.promise : undefined;
    },
    has(key) {
      return alive(entries.get(key));
    },
    track(key, promise) {
      const entry: Entry<T> = { startedAt: clock(), arrivedAt: null, promise };
      entries.set(key, entry);
      promise.then(
        () => {
          entry.arrivedAt = clock();
        },
        () => {
          // Неудачное чтение не запоминаем: следующий запрос должен попробовать снова.
          if (entries.get(key) === entry) entries.delete(key);
        }
      );
      return promise;
    },
    put(key, value) {
      const now = clock();
      entries.set(key, { startedAt: now, arrivedAt: now, promise: Promise.resolve(value) });
    },
    clear() {
      entries.clear();
    },
  };
}
