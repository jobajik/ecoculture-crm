"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Chips from "./Chips";
import Pill, { type PillTone } from "./Pill";
import Pager, { pageSlice } from "./Pager";

/** Строка списка рассылок — всё уже посчитано и подписано на сервере. */
export interface BroadcastListRow {
  id: string;
  title: string;
  when: string;
  auto: boolean;
  status: string;
  statusLabel: string;
  total: number;
  sent: number;
  read: number;
  replied: number;
  errors: number;
  orders: number;
  ordersMoney: string;
}

const TONE: Record<string, PillTone> = { sending: "good", paused: "wait", draft: "muted", done: "muted", cancelled: "bad" };
const COLS = "lg:grid-cols-[minmax(0,1fr)_130px_repeat(5,72px)_120px]";

/** «Рассылки»: отбор по состоянию, строки порциями (новый вид, 19.10.2026). */
export default function BroadcastList({ rows }: { rows: BroadcastListRow[] }) {
  const [view, setView] = useState("all");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [view]);
  const count = (pred: (r: BroadcastListRow) => boolean) => rows.filter(pred).length;
  const live = (r: BroadcastListRow) => r.status === "sending" || r.status === "paused";
  const list = useMemo(
    () =>
      rows.filter((r) =>
        view === "live" ? live(r) : view === "draft" ? r.status === "draft" : view === "done" ? r.status === "done" || r.status === "cancelled" : view === "auto" ? r.auto : true
      ),
    [rows, view]
  );

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line-hairline">
        <Chips
          value={view}
          onChange={setView}
          items={[
            { value: "all", label: "Все", count: rows.length },
            { value: "live", label: "Идут и на паузе", count: count(live) },
            { value: "draft", label: "Черновики", count: count((r) => r.status === "draft") },
            { value: "done", label: "Завершены", count: count((r) => r.status === "done" || r.status === "cancelled") },
            { value: "auto", label: "Автопилот", count: count((r) => r.auto) },
          ]}
        />
      </div>
      {list.length > 0 && (
        <div className={`hidden lg:grid ${COLS} gap-x-3 px-4 py-2 border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted`}>
          <span>Рассылка</span>
          <span>Статус</span>
          <span className="text-right">Кому</span>
          <span className="text-right">Ушло</span>
          <span className="text-right">Прочли</span>
          <span className="text-right">Ответ</span>
          <span className="text-right">Ошибки</span>
          <span className="text-right">Заявки 7 дн.</span>
        </div>
      )}
      {list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">{rows.length === 0 ? "Рассылок ещё не было." : "Под этот отбор рассылок нет."}</p>
      ) : (
        <ol className="divide-y divide-line-hairline/70">
          {pageSlice(list, page).map((b) => (
            <li key={b.id} className={`flex flex-wrap items-center lg:grid ${COLS} gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-surface-plane`}>
              <div className="min-w-0 basis-full lg:basis-auto">
                <Link href={`/clients/broadcasts/${b.id}`} className="font-medium hover:underline block truncate">
                  {b.title}
                </Link>
                <div className="text-xs text-ink-muted">
                  {b.when}
                  {b.auto ? " · автопилот" : ""}
                </div>
              </div>
              <div>
                <Pill tone={TONE[b.status] ?? "muted"}>{b.statusLabel}</Pill>
              </div>
              <Num label="Кому" value={b.total} />
              <Num label="Ушло" value={b.sent} />
              <Num label="Прочли" value={b.read} />
              <Num label="Ответ" value={b.replied} good />
              <Num label="Ошибки" value={b.errors} bad />
              <div className="text-xs lg:text-sm lg:text-right tabular-nums">
                <span className="lg:hidden text-ink-muted">Заявки за 7 дн.: </span>
                {b.orders > 0 ? (
                  <>
                    {b.orders} <span className="text-ink-muted">· {b.ordersMoney}</span>
                  </>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <Pager total={list.length} page={page} onPage={setPage} what="рассылок" />
    </div>
  );
}

function Num({ label, value, good, bad }: { label: string; value: number; good?: boolean; bad?: boolean }) {
  return (
    <div className="inline-flex lg:block text-xs lg:text-sm lg:text-right tabular-nums">
      <span className="lg:hidden text-ink-muted mr-1">{label}:</span>
      <span className={value > 0 ? (good ? "text-status-good font-semibold" : bad ? "text-status-critical" : "") : "text-ink-muted"}>{value || "—"}</span>
    </div>
  );
}
