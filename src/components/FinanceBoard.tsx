"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { FinanceOrderRow, FinanceSnapshot } from "@/lib/finance";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";
import PaymentPanel, { PaymentState, money } from "./PaymentPanel";

type Filter = "all" | "unpaid" | "partial" | "paid" | "ready";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Все",
  unpaid: "Не оплачены",
  partial: "Оплачены частично",
  paid: "Оплачены",
  ready: "Готовы к сборке",
};

function dateLabel(key: string): string {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function FinanceBoard({
  snapshot,
  canEdit,
}: {
  snapshot: FinanceSnapshot;
  /** Отмечать оплату может только бухгалтер и админ; остальным — только смотреть. */
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("unpaid");
  const [search, setSearch] = useState("");
  // Какая заявка сейчас раскрыта на оплату. Одна за раз: панель занимает
  // строку, и две открытые превращают таблицу в лестницу.
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.orders.filter((r) => {
      if (filter === "unpaid" && r.paid) return false;
      if (filter === "partial" && !(r.paidAmount > 0 && !r.paid)) return false;
      if (filter === "paid" && !r.paid) return false;
      if (filter === "ready" && !r.readyToCollect) return false;
      if (q && !r.clientName.toLowerCase().includes(q) && !r.managerName.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [snapshot.orders, filter, search]);

  // Список заявок бухгалтера длинный. Показываем начало, остальное по кнопке; с
  // фильтром или поиском — всё найденное, там человек сузил список сам.
  const [expandedRows, setExpandedRows] = useState(false);
  const narrowed = filter !== "all" || search.trim().length > 0;
  const shownRows = expandedRows || narrowed ? rows : rows.slice(0, COLLAPSED_TABLE_SIZE);
  const hiddenRows = rows.length - shownRows.length;

  const t = snapshot.totals;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Оформлено за период" value={money(t.amount)} sub={`${t.orders} заявок`} />
        <Tile
          label="Получено"
          value={money(t.paidAmount)}
          sub={
            t.partlyPaidOrders > 0
              ? `${t.paidOrders} из ${t.orders} целиком, ${t.partlyPaidOrders} частично`
              : `${t.paidOrders} из ${t.orders}`
          }
          tone="good"
        />
        <Tile
          label="Ждём оплату"
          value={money(t.unpaidAmount)}
          sub={`${t.orders - t.paidOrders} заявок не закрыты`}
          tone={t.unpaidAmount > 0 ? "warning" : "default"}
        />
        <Tile
          label="Долг всего"
          value={money(snapshot.debtTotal)}
          sub={
            snapshot.debtOverdueTotal > 0
              ? `просрочено ${money(snapshot.debtOverdueTotal)}`
              : "по всей базе"
          }
          tone={snapshot.debtOverdueTotal > 0 ? "critical" : "default"}
        />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h3 className="font-medium">Собираемость за период</h3>
          <span className="text-sm text-ink-secondary tabular-nums">
            {t.collectPercent.toFixed(0)}% · {money(t.paidAmount)} из {money(t.amount)}
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-plane overflow-hidden">
          <div
            className="h-full rounded-full bg-status-good transition-all"
            style={{ width: `${Math.min(100, t.collectPercent)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm border transition-colors",
                filter === f
                  ? "bg-accent text-white border-accent"
                  : "border-line-hairline text-ink-secondary hover:bg-surface-plane"
              )}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        <input
          className="input !w-auto flex-1 min-w-[180px] !py-1.5"
          placeholder="Поиск по клиенту или менеджеру"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Оформлена</th>
              <th className="px-4 py-3 font-medium">Доставка</th>
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Менеджер</th>
              <th className="px-4 py-3 font-medium text-right">Сумма</th>
              <th className="px-4 py-3 font-medium text-center">Менеджер<br />подтвердил</th>
              <th className="px-4 py-3 font-medium text-right">Получено</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <Fragment key={r.orderId}>
                <tr
                  className={clsx(
                    "border-b border-line-hairline hover:bg-surface-plane",
                    r.readyToCollect && "bg-status-good/5",
                    openId === r.orderId && "bg-accent-soft/40"
                  )}
                >
                  <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">{dateLabel(r.createdDate)}</td>
                  <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">{dateLabel(r.deliveryDate)}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/orders/${r.orderId}`} className="font-medium hover:underline">
                      {r.clientName}
                    </Link>
                    <div className="text-xs text-ink-muted truncate max-w-[240px]" title={r.positions}>
                      {r.positions}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">{r.managerName}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                    {money(r.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={clsx("text-base", r.managerConfirmed ? "text-status-good" : "text-ink-muted")}>
                      {r.managerConfirmed ? "✓" : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-block text-right">
                      <PaymentState totalAmount={r.amount} paidAmount={r.paidAmount} compact />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {canEdit ? (
                      <button
                        onClick={() => setOpenId(openId === r.orderId ? null : r.orderId)}
                        className="btn-secondary !py-1 !px-2.5 text-xs"
                      >
                        {openId === r.orderId ? "Закрыть" : r.paid ? "Изменить" : "Внести оплату"}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted">только просмотр</span>
                    )}
                  </td>
                </tr>
                {openId === r.orderId && canEdit && (
                  <tr className="border-b border-line-hairline bg-accent-soft/20">
                    <td colSpan={8} className="px-4 py-4">
                      <PaymentPanel
                        orderId={r.orderId}
                        totalAmount={r.amount}
                        paidAmount={r.paidAmount}
                        farms={r.farms}
                        onDone={() => setOpenId(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink-muted">
                  Заявок по этому фильтру нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(hiddenRows > 0 || (expandedRows && !narrowed)) && (
        <div className="mt-2 flex items-center gap-3">
          <MoreToggle
            expanded={expandedRows}
            hidden={hiddenRows}
            onToggle={() => setExpandedRows((v) => !v)}
            what="заявок"
          />
          <span className="text-xs text-ink-muted">
            всего заявок: {rows.length.toLocaleString("ru-RU")}
          </span>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warning" | "critical";
}) {
  const toneClass =
    tone === "good"
      ? "text-status-good"
      : tone === "warning"
      ? "text-[#8a5a00]"
      : tone === "critical"
      ? "text-status-critical"
      : "text-ink-primary";

  return (
    <div className="card !p-4">
      <div className="text-xs text-ink-secondary mb-1">{label}</div>
      <div className={clsx("text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
