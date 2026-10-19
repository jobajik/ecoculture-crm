"use client";

import { useEffect, useState, type ReactNode } from "react";
import Pager, { pageSlice } from "./Pager";

/**
 * Готовые строки списка (их рисует сервер) порциями по 10 с листанием внизу — вместо длинной ленты на страницу
 * (новый вид, 19.10.2026: «одностраничный, без прокрутки»). `resetKey` — сменился отбор, листаем с начала.
 */
export default function PagedList({
  items,
  what,
  size,
  empty,
  resetKey,
  className = "divide-y divide-line-hairline/70",
}: {
  items: ReactNode[];
  what?: string;
  size?: number;
  empty?: ReactNode;
  resetKey?: string;
  className?: string;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <>
      <ol className={className}>{pageSlice(items, page, size)}</ol>
      <Pager total={items.length} page={page} onPage={setPage} size={size} what={what} />
    </>
  );
}
