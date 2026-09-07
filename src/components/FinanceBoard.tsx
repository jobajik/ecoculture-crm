"use client";

import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { setPaidAction } from "@/app/finance/actions";
import { PAYMENT_METHODS } from "@/lib/constants";
import type { FinanceOrderRow, FinanceSnapshot } from "@/lib/finance";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";

type Filter = "all" | "unpaid" | "paid" | "ready";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Все",
  unpaid: "Не оплачены",
  paid: "Оплачены",
  ready: "Готовы к сборке",
};

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

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
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("unpaid");
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.orders.filter((r) => {
      if (filter === "unpaid" && r.paid) return false;
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

  function togglePaid(row: FinanceOrderRow) {
    if (!canEdit) return;
    setError(null);
    setBusyId(row.orderId);
    startTransition(async () => {
      try {
        await setPaidAction(row.orderId, !row.paid, method);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      } finally {
        setBusyId(null);
      }
    });
  }

  const t = snapshot.totals;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Оформлено за период" value={money(t.amount)} sub={`${t.orders} заявок`} />
        <Tile label="Оплачено" value={money(t.paidAmount)} sub={`${t.paidOrders} из ${t.orders}`} tone="good" />
        <Tile
          label="Ждём оплату"
          value={money(t.unpaidAmount)}
          sub={`${t.orders - t.paidOrders} заявок`}
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
        {canEdit && (
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            Способ оплаты
            <select className="input !w-auto !py-1.5" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>
      )}

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
              <th className="px-4 py-3 font-medium text-center">Оплачено</th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr
                key={r.orderId}
                className={clsx(
                  "border-b border-line-hairline last:border-0 hover:bg-surface-plane",
                  r.readyToCollect && "bg-status-good/5"
                )}
              >
                <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">{dateLabel(r.createdDate)}</td>
                <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">{dateLabel(r.deliveryDate)}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.clientName}</div>
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
                <td className="px-4 py-2.5 text-center">
                  <button
                    onClick={() => togglePaid(r)}
                    disabled={!canEdit || (pending && busyId === r.orderId)}
                    title={
                      canEdit
                        ? r.paid
                          ? `Оплачено${r.paymentMethod ? ` · ${r.paymentMethod}` : ""} — нажмите, чтобы снять`
                          : "Отметить как оплаченную"
                        : "Отмечать оплату может бухгалтер"
                    }
                    className={clsx(
                      "inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors",
                      r.paid
                        ? "bg-status-good/15 border-status-good/40 text-status-good"
                        : "border-line-hairline text-ink-muted",
                      canEdit && "hover:border-status-good cursor-pointer",
                      !canEdit && "cursor-default"
                    )}
                  >
                    {busyId === r.orderId && pending ? "…" : r.paid ? "✓" : ""}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">
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
