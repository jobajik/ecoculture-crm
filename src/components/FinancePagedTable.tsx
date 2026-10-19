"use client";

import { useEffect, useState, type ReactNode } from "react";
import Pager, { pageSlice } from "./Pager";

/**
 * Таблица, строки которой рисует сервер, — порциями с листанием внизу (раздел «Оплаты», 19.10.2026: «одностраничный,
 * без прокрутки»). `head` — содержимое `<thead>`, `rows` — готовые `<tr>` с ключами, `foot` — итоговая строка, она
 * видна на каждой странице.
 */
export default function FinancePagedTable({
  head,
  rows,
  foot,
  what,
  size,
  resetKey,
}: {
  head: ReactNode;
  rows: ReactNode[];
  foot?: ReactNode;
  what?: string;
  size?: number;
  resetKey?: string;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  return (
    <>
      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>{head}</thead>
          <tbody>{pageSlice(rows, page, size)}</tbody>
          {foot && <tfoot>{foot}</tfoot>}
        </table>
      </div>
      <Pager total={rows.length} page={page} onPage={setPage} size={size} what={what} />
    </>
  );
}
