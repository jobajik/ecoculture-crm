"use client";

import { useEffect, useState } from "react";
import { looksLikeStaleVersion, shouldAutoReload } from "@/lib/staleVersion";

const RELOAD_KEY = "crm-last-auto-reload";

/**
 * Экран ошибки — по-русски и с починкой.
 *
 * До него на любом сбое в браузере Next.js показывал свою заглушку:
 * «Application error: a client-side exception has occurred (see the browser
 * console for more information)». Для владельца и сотрудников это ровно ноль
 * полезного: по-английски, без объяснения и без единой кнопки. Владелец увидел
 * её на телефоне и спросил, почему так бывает, — и правильный ответ был «а
 * приложение вам ничего и не говорит».
 *
 * Что делает этот экран:
 *
 * 1. **Сам чинит самый частый случай.** Если ошибка похожа на «страница из
 *    старой версии сайта» (см. `staleVersion.ts`), страница перезагружается
 *    сама — человек видит короткое «Обновляю…» вместо поломки. От кольца
 *    перезагрузок защищает отметка времени: чаще раза в 20 секунд не
 *    перезагружаемся, иначе настоящая ошибка мигала бы бесконечно.
 * 2. **Объясняет остальные случаи словами** и даёт две кнопки: обновить и уйти
 *    на главную.
 * 3. **Показывает опознавательный номер** (`digest`), если он есть: по нему
 *    ошибку можно найти в журнале сервера. Мелко и серо — это служебная
 *    надпись, как код партии.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  const stale = looksLikeStaleVersion(error);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!stale) return;
    let last: number | null = null;
    try {
      const raw = window.sessionStorage.getItem(RELOAD_KEY);
      last = raw ? Number(raw) : null;
      if (last !== null && !Number.isFinite(last)) last = null;
    } catch {
      // Приватный режим или запрет хранилища — тогда просто не перезагружаемся
      // сами. Кнопка на экране всё равно есть.
      return;
    }

    if (!shouldAutoReload(last, Date.now())) return;
    try {
      window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      return;
    }
    setReloading(true);
    window.location.reload();
  }, [stale]);

  if (reloading) {
    return (
      <Frame>
        <h1 className="text-lg font-semibold mb-2">Обновляю страницу…</h1>
        <p className="text-sm text-ink-secondary">
          Сайт обновился, пока страница была открыта. Секунду.
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="text-lg font-semibold mb-2">
        {stale ? "Страница устарела" : "Что-то пошло не так"}
      </h1>
      <p className="text-sm text-ink-secondary mb-1">
        {stale
          ? "Сайт обновился, пока эта страница была открыта. Данные целы — нужно просто обновить страницу."
          : "Страница не смогла отобразиться. Данные при этом не пострадали: всё, что было сохранено, осталось в базе."}
      </p>
      {!stale && (
        <p className="text-sm text-ink-secondary mb-1">
          Чаще всего помогает обновление. Если повторяется — покажите этот экран, и я разберусь.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" onClick={() => window.location.reload()} className="btn-primary">
          Обновить страницу
        </button>
        {reset && (
          <button type="button" onClick={() => reset()} className="btn-secondary">
            Попробовать ещё раз
          </button>
        )}
        <a href="/" className="btn-secondary">
          На главную
        </a>
      </div>

      {/* Текст ошибки — мелко и серо, как код партии: человеку он не нужен, но
          по нему сразу видно, что случилось, если прислать снимок экрана. До
          этого единственной подсказкой было «see the browser console», то есть
          для владельца — ничего. */}
      {!stale && (error?.message || error?.digest) && (
        <p className="text-[11px] text-ink-muted font-mono mt-4 break-words">
          {error.message ? error.message.slice(0, 300) : null}
          {error.digest ? <span className="block">код: {error.digest}</span> : null}
        </p>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <div className="card">{children}</div>
    </div>
  );
}
