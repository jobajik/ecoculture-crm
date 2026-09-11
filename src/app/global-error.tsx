"use client";

import "@fontsource/arimo/400.css";
import "@fontsource/arimo/500.css";
import "@fontsource/arimo/600.css";
import "./globals.css";
import ErrorScreen from "@/components/ErrorScreen";

/**
 * Последний рубеж: сломалась не страница, а сам каркас сайта (шапка, меню,
 * общий слой авторизации). Обычный `error.tsx` в этом случае не показывается —
 * он живёт ВНУТРИ каркаса, которого уже нет.
 *
 * Поэтому здесь рисуется собственный `<html>` и `<body>`: Next.js заменяет ими
 * страницу целиком. Стили и шрифт подключаются заново по той же причине —
 * общий слой сюда не доходит.
 *
 * Бывает это редко, но именно в этот редкий раз человек и видел английскую
 * заглушку без единой кнопки.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="ru">
      <body className="min-h-screen font-sans antialiased">
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
