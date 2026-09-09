"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { MONEY_LOG_ACTIONS, MONEY_LOG_LABELS } from "@/lib/constants";
import { formatMoment } from "@/lib/formatDate";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";
import { money } from "./PaymentPanel";

export interface MoneyLogRow {
  logId: string;
  createdAt: string;
  actorName: string;
  orderId: string;
  clientName: string;
  action: string;
  details: string;
  amountBefore: number;
  amountAfter: number;
}

/** Действия, которые меняют деньги, — их подсвечиваем. */
const STRONG: string[] = [
  MONEY_LOG_ACTIONS.RECALCULATED,
  MONEY_LOG_ACTIONS.PAYMENT_CLEARED,
  MONEY_LOG_ACTIONS.CLAIM_ACCEPTED,
];

/**
 * Журнал действий по деньгам.
 *
 * Оплату можно поставить и снять, заявку — пересчитать. Пока этого нигде не
 * записано, спор «я такого не делала» разбирается по памяти, а память у всех
 * разная. Здесь видно, кто, когда и что сделал, и как от этого изменилась сумма.
 *
 * Строки только добавляются: править журнал нельзя ни из интерфейса, ни из
 * кода — в этом весь его смысл.
 */
export default function MoneyLogView({ rows }: { rows: MoneyLogRow[] }) {
  const [action, setAction] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (action !== "all" && r.action !== action) return false;
      if (
        q &&
        !r.clientName.toLowerCase().includes(q) &&
        !r.actorName.toLowerCase().includes(q) &&
        !r.details.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [rows, action, search]);

  const narrowed = action !== "all" || search.trim().length > 0;
  const shown = expanded || narrowed ? filtered : filtered.slice(0, COLLAPSED_TABLE_SIZE);

  const actions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.action))).filter(Boolean),
    [rows]
  );

  if (rows.length === 0) {
    return (
      <div className="card text-center py-10">
        <p className="font-medium">Записей пока нет</p>
        <p className="text-sm text-ink-secondary mt-1">
          Журнал заполняется сам: как только кто-то отметит оплату, пересчитает заявку или проведёт
          рекламацию, здесь появится строка.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input !w-auto !py-1.5"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="all">Все действия</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {MONEY_LOG_LABELS[a] ?? a}
            </option>
          ))}
        </select>
        <input
          className="input !w-auto flex-1 min-w-[200px] !py-1.5"
          placeholder="Поиск по клиенту, сотруднику или тексту"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Когда</th>
              <th className="px-4 py-3 font-medium">Кто</th>
              <th className="px-4 py-3 font-medium">Заявка</th>
              <th className="px-4 py-3 font-medium">Что сделал</th>
              <th className="px-4 py-3 font-medium text-right">Было → стало</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const changed = Math.round(r.amountAfter) !== Math.round(r.amountBefore);
              return (
                <tr key={r.logId} className="border-b border-line-hairline last:border-0">
                  <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                    {formatMoment(r.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{r.actorName}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/orders/${r.orderId}`} className="hover:underline">
                      {r.clientName || r.orderId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={clsx("font-medium", STRONG.includes(r.action) && "text-[#8a5a00]")}>
                      {MONEY_LOG_LABELS[r.action] ?? r.action}
                    </span>
                    {r.details && <span className="block text-xs text-ink-muted">{r.details}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {changed ? (
                      <>
                        <span className="text-ink-muted line-through">{money(r.amountBefore)}</span>
                        <span className="block font-medium">{money(r.amountAfter)}</span>
                      </>
                    ) : (
                      <span className="text-ink-secondary">{money(r.amountAfter)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                  По этому фильтру записей нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!narrowed && (
        <MoreToggle
          expanded={expanded}
          hidden={filtered.length - shown.length}
          onToggle={() => setExpanded((v) => !v)}
          what="записей"
        />
      )}
    </div>
  );
}
