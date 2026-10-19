"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS, FLOWER_TYPE_LABELS_PLURAL, formatGrade } from "@/lib/constants";
import type { FlowerSalesMatrix, FlowerSalesRow } from "@/lib/flowerSales";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
import Change from "./Change";
import Chips from "./Chips";
import CardTabs from "./CardTabs";
import Pager, { pageSlice } from "./Pager";

type View = "grade" | "variety" | "manager" | "flower" | "matrix";

const FLOWERS = ["rose", "chrysanthemum", "eustoma"];

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${nf(n)} ₸`;

/**
 * Разрезы проданного за месяц одной карточкой: вкладки разрезов, переключатель цветка (он в адресе) и таблица
 * страницами — как у клиентов. Расчёт — `buildFlowerSales()` в `src/lib/flowerSales.ts`.
 */
export default function FlowerSalesBreakdown({
  rows,
  gradeLabel,
  oneFlower,
  hasPrev,
  matrix,
  flower,
  period,
}: {
  rows: Record<Exclude<View, "matrix">, FlowerSalesRow[]>;
  /** «Ростовка», «Категория» или «Ростовка и категория». */
  gradeLabel: string;
  /** Выбран один цветок — вкладка «Цветы» не нужна, подпись цветка у строк тоже. */
  oneFlower: boolean;
  hasPrev: boolean;
  /** Менеджеры × категория — только при одном цветке. */
  matrix?: FlowerSalesMatrix | null;
  /** Выбранный цветок и месяц — для переключателя цветка (он в адресе). */
  flower: string | null;
  period: string;
}) {
  const router = useRouter();
  const hasMatrix = !!matrix && matrix.rows.length > 0;
  const views: { key: View; label: string; column: string }[] = [
    { key: "grade", label: gradeLabel, column: gradeLabel },
    { key: "variety", label: "Сорта", column: "Сорт" },
    { key: "manager", label: "Менеджеры", column: "Менеджер" },
    ...(oneFlower ? [] : [{ key: "flower" as View, label: "Цветы", column: "Цветок" }]),
    ...(hasMatrix ? [{ key: "matrix" as View, label: `Менеджеры × ${gradeLabel.toLowerCase()}`, column: "" }] : []),
  ];
  const [view, setView] = useState<View>("grade");
  const [page, setPage] = useState(0);
  const cfg = views.find((v) => v.key === view) ?? views[0];
  const list = cfg.key === "matrix" ? [] : rows[cfg.key];
  const maxShare = Math.max(1, ...list.filter((r) => !r.aside).map((r) => r.share));
  const shown = pageSlice(list, page);

  return (
    <div className="card !p-0 overflow-hidden">
      <CardTabs
        tone="sales"
        items={views.map((v) => ({ key: v.key, label: v.label }))}
        value={cfg.key}
        onChange={(k) => {
          setView(k);
          setPage(0);
        }}
      />
      <div className="px-4 sm:px-5 py-3 border-b border-line-hairline">
        <Chips
          value={flower ?? "all"}
          onChange={(v) => router.push(`/sales/flowers?period=${period}${v === "all" ? "" : `&flower=${v}`}`)}
          items={[
            { value: "all", label: "Все цветы" },
            ...FLOWERS.map((f) => ({ value: f, label: FLOWER_TYPE_LABELS_PLURAL[f] ?? f })),
          ]}
        />
      </div>

      {cfg.key === "matrix" && matrix ? (
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Менеджер, штук</th>
                {matrix.grades.map((g) => (
                  <th key={g} className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                    {formatGrade(g)}
                  </th>
                ))}
                <th className={clsx(TH, "text-right")}>Всего</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.key} className={clsx(TR, row.aside && "text-ink-secondary bg-surface-plane/60")}>
                  <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                    {row.label}
                    {row.aside && <span className="ml-1 text-[11px] font-normal text-ink-muted">(не продажа)</span>}
                  </td>
                  {matrix.grades.map((g) => (
                    <td key={g} className="px-3 py-2.5 text-right tabular-nums">
                      {row.cells[g] ? nf(row.cells[g]) : ""}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{nf(row.total)}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-surface-plane/60 border-t border-line-hairline">
                <td className="px-4 py-2.5">Итого продажи</td>
                {matrix.grades.map((g) => (
                  <td key={g} className="px-3 py-2.5 text-right tabular-nums">
                    {matrix.totals[g] ? nf(matrix.totals[g]) : ""}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {nf(matrix.grades.reduce((sum, g) => sum + (matrix.totals[g] ?? 0), 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="table-scroll table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={TH}>{cfg.column}</th>
                  <th className={clsx(TH, "text-right")}>Штук</th>
                  <th className={TH}>Доля</th>
                  {hasPrev && <th className={clsx(TH, "text-right")}>к прошлому</th>}
                  <th className={clsx(TH, "text-right")}>Сумма</th>
                  <th className={clsx(TH, "text-right")}>Ср. цена</th>
                  <th className={clsx(TH, "text-right")}>Заявок</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className={clsx(TR, r.aside && "text-ink-secondary bg-surface-plane/60")}>
                    <td className="px-4 py-2.5 font-semibold">
                      {r.label}
                      {!oneFlower && r.flowerType && cfg.key !== "flower" && (
                        <span className="ml-1.5 text-xs font-normal text-ink-muted">{FLOWER_TYPE_LABELS[r.flowerType]?.toLowerCase()}</span>
                      )}
                      {r.aside && <span className="block text-[11px] font-normal text-ink-muted">не продажа, в итог не входит</span>}
                    </td>
                    <td data-label="Штук" className="px-4 py-2.5 text-right tabular-nums font-semibold">{nf(r.stems)}</td>
                    <td data-label="Доля" className="px-4 py-2.5">
                      {!r.aside && (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunk">
                            <div className="h-full rounded-full bg-section-sales" style={{ width: `${Math.max(2, (r.share / maxShare) * 100)}%` }} />
                          </div>
                          <span className="tabular-nums text-xs text-ink-secondary">{Math.round(r.share)} %</span>
                        </div>
                      )}
                    </td>
                    {hasPrev && (
                      <td data-label="к прошлому" className="px-4 py-2.5 text-right tabular-nums">
                        <Change now={r.stems} before={r.prevStems} />
                      </td>
                    )}
                    <td data-label="Сумма" className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{money(r.amount)}</td>
                    <td data-label="Ср. цена" className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {r.stems > 0 ? money(r.amount / r.stems) : ""}
                    </td>
                    <td data-label="Заявок" className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{nf(r.orders)}</td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-ink-muted">
                      За месяц продаж нет.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager total={list.length} page={page} onPage={setPage} what="строк" />
        </>
      )}
    </div>
  );
}
