"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Chips from "./Chips";
import Pager, { pageSlice } from "./Pager";
import ItemsCell from "./ItemsCell";
import OrderStageBadge from "./OrderStageBadge";
import ConfirmOrderButton from "./ConfirmOrderButton";
import { DELIVERY_GROUP_LABELS, type DeliveryGroupKey } from "@/lib/shipQueue";
import type { QueueAlert, QueueRow } from "@/lib/shipQueueRows";

/**
 * Очередь на отгрузку одной карточкой (новый вид, 19.10.2026): вкладки «Можно отгружать / Ждут / Срок хранения»,
 * фильтр по дню доставки кнопками, поиск и страницы — вместо трёх блоков друг под другом. Одна на склад и офис.
 */
type View = "ready" | "waiting" | "alerts";
const GROUPS: DeliveryGroupKey[] = ["late", "today", "tomorrow", "later", "nodate"];

export default function ShipQueueBoard({
  ready,
  waiting,
  alerts,
  alertLinks = [],
  /** Кнопка в строке готовой заявки: «Отгрузить» (склад) или «Открыть» (кто только смотрит). */
  shipAction = "ship",
  /** Имя клиента ведёт на заявку (склад офиса заявку целиком не открывает). */
  clientLink = true,
  showPhone = false,
  emptyReady,
}: {
  ready: QueueRow[];
  waiting: QueueRow[];
  alerts: QueueAlert[];
  alertLinks?: { href: string; label: string }[];
  shipAction?: "ship" | "open";
  clientLink?: boolean;
  showPhone?: boolean;
  emptyReady: string;
}) {
  const [view, setView] = useState<View>(ready.length === 0 && waiting.length > 0 ? "waiting" : "ready");
  const [group, setGroup] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [view, group, search]);

  const q = search.trim().toLowerCase();
  const base = view === "waiting" ? waiting : ready;
  const filtered = useMemo(
    () => base.filter((r) => (group === "all" || r.group === group) && (!q || r.search.includes(q))),
    [base, group, q]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of base) c[r.group] = (c[r.group] ?? 0) + 1;
    return c;
  }, [base]);

  const tabs: { key: View; label: string; n: number; alarm?: boolean }[] = [
    { key: "ready", label: "Можно отгружать", n: ready.length },
    { key: "waiting", label: "Ждут подтверждения или оплаты", n: waiting.length },
    ...(alerts.length > 0 ? [{ key: "alerts" as const, label: "Срок хранения", n: alerts.length, alarm: true }] : []),
  ];

  const clientCell = (r: QueueRow) => {
    const title = (
      <>
        <span className="block font-semibold truncate max-w-[240px]" title={r.client}>
          {r.client}
        </span>
        <span className="block text-[11px] text-ink-muted font-mono">№ {r.code}</span>
      </>
    );
    return (
      <>
        {clientLink ? (
          <Link href={`/orders/${r.orderId}`} className="hover:text-section-stock">
            {title}
          </Link>
        ) : (
          title
        )}
        {showPhone && r.phone && (
          <a href={`tel:${r.phone}`} className="block text-xs text-ink-secondary whitespace-nowrap">
            {r.phone}
          </a>
        )}
      </>
    );
  };

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(t.key)}
            className={clsx(
              "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
              view === t.key ? "border-section-stock text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
            )}
          >
            {t.label}{" "}
            <span className={clsx("tabular-nums", t.alarm ? "text-status-critical font-semibold" : "text-ink-muted")}>{t.n}</span>
          </button>
        ))}
      </div>

      {view === "alerts" ? (
        <>
          <ul className="divide-y divide-line-hairline">
            {pageSlice(alerts, page).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold truncate">{a.label}</span>
                  <span className="block text-xs text-ink-muted">{a.qty.toLocaleString("ru-RU")} шт. на складе</span>
                </span>
                <span
                  className={clsx(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
                    a.critical ? "bg-status-critical/10 text-status-critical" : "bg-status-warning/15 text-[#8a5a00]"
                  )}
                >
                  {a.days} дн. {a.days >= a.maxDays ? `· срок ${a.maxDays}` : `из ${a.maxDays}`}
                </span>
              </li>
            ))}
          </ul>
          {alertLinks.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 sm:px-5 py-3 border-t border-line-hairline">
              {alertLinks.map((l) => (
                <Link key={l.href} href={l.href} className="btn-secondary !py-1.5">
                  {l.label}
                </Link>
              ))}
            </div>
          )}
          <Pager total={alerts.length} page={page} onPage={setPage} what="партий" />
        </>
      ) : (
        <>
          <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
            <Chips
              value={group}
              onChange={setGroup}
              items={[
                { value: "all", label: "Все", count: base.length },
                ...GROUPS.filter((g) => (counts[g] ?? 0) > 0 || group === g).map((g) => ({
                  value: g,
                  label: DELIVERY_GROUP_LABELS[g],
                  count: counts[g] ?? 0,
                  alarm: g === "late",
                })),
              ]}
            />
            <input
              className="input !w-auto xl:ml-auto xl:w-[260px] min-w-0"
              placeholder="Клиент, №, сорт"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="table-scroll table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                  <th className="px-4 py-2.5 font-medium">Клиент</th>
                  <th className="px-4 py-2.5 font-medium">Доставка</th>
                  <th className="px-4 py-2.5 font-medium">Позиции · отгружено/заказано</th>
                  <th className="px-4 py-2.5 font-medium">{view === "waiting" ? "Чего ждём" : "Этап"}</th>
                  {view === "ready" && <th className="px-4 py-2.5 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {pageSlice(filtered, page).map((r) => (
                  <tr key={r.orderId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane align-top">
                    <td className="px-4 py-3">{clientCell(r)}</td>
                    <td
                      data-label="Доставка"
                      className={clsx("px-4 py-3 whitespace-nowrap", r.group === "late" ? "text-status-critical font-semibold" : "text-ink-secondary")}
                    >
                      {r.delivery}
                      {r.stage.lateDays > 0 && <span className="block text-xs font-normal">опаздывает {r.stage.lateDays} дн.</span>}
                    </td>
                    <td data-label="Позиции" className="px-4 py-3 text-ink-secondary">
                      <ItemsCell lines={r.lines} width="max-w-[300px]" />
                    </td>
                    <td data-label={view === "waiting" ? "Чего ждём" : "Этап"} className="px-4 py-3">
                      <OrderStageBadge stage={{ ...r.stage, lateDays: 0 }} compact showActor={view === "waiting"} />
                      {r.credit && <div className="text-xs text-[#8a5a00] mt-1 whitespace-nowrap">{r.credit}</div>}
                      {view === "waiting" && r.unpaidShip && (
                        <Link href={`/warehouse/ship/${r.orderId}`} className="block mt-1 text-xs text-series-1 hover:underline">
                          Уже уехал? Отгрузить без оплаты →
                        </Link>
                      )}
                      {view === "waiting" && r.canConfirm && (
                        <div className="mt-2">
                          <ConfirmOrderButton orderId={r.orderId} />
                        </div>
                      )}
                    </td>
                    {view === "ready" && (
                      <td className="px-4 py-3 sm:text-right whitespace-nowrap">
                        {shipAction === "ship" ? (
                          <Link href={`/warehouse/ship/${r.orderId}`} className="btn-primary !py-1.5">
                            Отгрузить
                          </Link>
                        ) : (
                          <Link href={`/orders/${r.orderId}`} className="btn-secondary !py-1.5">
                            Открыть
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                      {q || group !== "all" ? "Ничего не нашлось" : view === "waiting" ? "Все заявки готовы" : emptyReady}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager total={filtered.length} page={page} onPage={setPage} what="заявок" />
        </>
      )}
    </div>
  );
}
