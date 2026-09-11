"use client";

import ErrorScreen from "@/components/ErrorScreen";

/**
 * Что показывать, если страница сломалась уже в браузере.
 *
 * Без этого файла Next.js показывает свою английскую заглушку «Application
 * error: a client-side exception has occurred» — без объяснения и без кнопок.
 * Шапка и меню при этом остаются на месте: Next подставляет этот экран вместо
 * содержимого страницы, а не вместо всего сайта.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} />;
}
