"use client";

import { useState } from "react";
import clsx from "clsx";
import Pager, { pageSlice } from "./Pager";

export interface SentReminderRow {
  id: string;
  when: string;
  text: string;
  ok: boolean;
  error: string;
}

/** «Отправленные за 2 недели» — короткий журнал в боковой колонке, страницами. */
export default function SentReminders({ rows }: { rows: SentReminderRow[] }) {
  const [page, setPage] = useState(0);
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line-hairline flex items-baseline gap-2">
        <h2 className="font-semibold text-sm">Отправленные за 2 недели</h2>
        <span className="text-xs text-ink-muted ml-auto tabular-nums">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-muted">Пока ни одного.</p>
      ) : (
        <>
          <ul className="divide-y divide-line-hairline text-sm">
            {pageSlice(rows, page, 8).map((r) => (
              <li key={r.id} className="px-4 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{r.text}</span>
                  <span className={clsx("text-xs flex-none", r.ok ? "text-status-good" : "text-status-critical")}>
                    {r.ok ? "ушло" : "не ушло"}
                  </span>
                </div>
                <div className="text-xs text-ink-muted">{r.when}</div>
                {r.error && <div className="text-xs text-[#8a5a00]">{r.error}</div>}
              </li>
            ))}
          </ul>
          <Pager total={rows.length} page={page} onPage={setPage} size={8} />
        </>
      )}
    </div>
  );
}
