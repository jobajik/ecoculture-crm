"use client";

import { useState } from "react";
import Link from "next/link";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
import Pager, { pageSlice } from "./Pager";

export interface RegionOrderRow {
  orderId: string;
  /** Короткий номер — `orderCode()`. */
  code: string;
  clientName: string;
  /** Уже отформатированный день доставки. */
  deliveryLabel: string;
  direction: string;
  stems: number;
  shipped: number;
  amount: number;
}

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

/** Заявки периода на «Планы → Отгрузки → Факт и заявки» — таблица страницами (новый вид, 19.10.2026). */
export default function RegionOrdersTable({ rows, empty }: { rows: RegionOrderRow[]; empty: string }) {
  const [page, setPage] = useState(0);
  const shown = pageSlice(rows, page);
  return (
    <>
      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className={THEAD_ROW}>
              <th className={TH}>Клиент</th>
              <th className={TH}>Доставка</th>
              <th className={TH}>Направление</th>
              <th className={TH}>Заявка</th>
              <th className={`${TH} text-right`}>Стеблей</th>
              <th className={`${TH} text-right`}>Отгружено</th>
              <th className={`${TH} text-right`}>Поступило</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.orderId} className={TR}>
                <td className="px-4 py-2.5 font-semibold max-w-[240px] truncate" title={o.clientName}>
                  {o.clientName}
                </td>
                <td data-label="Доставка" className="px-4 py-2.5 whitespace-nowrap text-ink-secondary">
                  {o.deliveryLabel}
                </td>
                <td data-label="Направление" className="px-4 py-2.5 whitespace-nowrap">{o.direction}</td>
                <td data-label="Заявка" className="px-4 py-2.5 whitespace-nowrap">
                  <Link href={`/orders/${o.orderId}`} className="font-mono text-xs text-ink-secondary hover:underline">
                    {o.code}
                  </Link>
                </td>
                <td data-label="Стеблей" className="px-4 py-2.5 text-right tabular-nums font-semibold">{nf(o.stems)}</td>
                <td data-label="Отгружено" className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">
                  {o.shipped > 0 ? nf(o.shipped) : "—"}
                </td>
                <td data-label="Поступило" className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{nf(o.amount)} ₸</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-ink-muted">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager total={rows.length} page={page} onPage={setPage} what="заявок" />
    </>
  );
}
