"use client";

import { useState } from "react";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import { BASE_VARIETY_LABEL } from "@/lib/priceList";
import type { PriceChangeDay } from "@/lib/priceChanges";
import Pager, { pageSlice } from "./Pager";

/**
 * История изменений прайса: по дням, сверху свежее. Рисуется вкладкой карточки прайса (без своей рамки),
 * дни — страницами.
 *
 * Свёрнутый день — это одна строка: дата и сколько позиций подорожало,
 * подешевело или появилось впервые. Разворачивается по клику: чаще всего нужно
 * знать «когда последний раз меняли», а не «что именно поменяли в марте».
 */
export default function PriceChangesView({ days }: { days: PriceChangeDay[] }) {
  const [page, setPage] = useState(0);
  const shown = pageSlice(days, page);

  if (days.length === 0) {
    return <p className="px-4 sm:px-5 py-12 text-center text-sm text-ink-muted">Изменений пока не было.</p>;
  }

  return (
    <div>
      <div className="divide-y divide-line-hairline">
        {shown.map((day) => (
          <DayRow key={day.date} day={day} />
        ))}
      </div>
      <Pager total={days.length} page={page} onPage={setPage} what="дней" />
    </div>
  );
}

function DayRow({ day }: { day: PriceChangeDay }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 sm:px-5 py-3 text-left hover:bg-surface-plane/60"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-[10px] text-ink-muted">
            {open ? "▼" : "▶"}
          </span>
          <span className="font-medium">
            {new Date(`${day.date}T00:00:00`).toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
          <span className="text-sm text-ink-muted">
            {day.changes.length} {positionWord(day.changes.length)}
          </span>
        </span>
        <span className="flex items-center gap-3 text-sm tabular-nums">
          {day.up > 0 && <span className="text-status-good">↑ {day.up} подорожало</span>}
          {day.down > 0 && <span className="text-status-critical">↓ {day.down} подешевело</span>}
          {day.added > 0 && <span className="text-ink-muted">+{day.added} новых</span>}
          {day.removed > 0 && <span className="text-ink-muted">−{day.removed} без цены</span>}
          {day.avgChangePercent !== null && (
            <span
              className={clsx(
                "font-medium",
                day.avgChangePercent > 0
                  ? "text-status-good"
                  : day.avgChangePercent < 0
                  ? "text-status-critical"
                  : "text-ink-muted"
              )}
            >
              в среднем {day.avgChangePercent > 0 ? "+" : ""}
              {day.avgChangePercent.toFixed(1).replace(".", ",")} %
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="table-scroll border-t border-line-hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                <th className="px-3 py-2 font-medium">Цветок</th>
                <th className="px-3 py-2 font-medium">Сорт</th>
                <th className="px-3 py-2 font-medium">Длина / категория</th>
                <th className="px-3 py-2 font-medium text-right">Было</th>
                <th className="px-3 py-2 font-medium text-right">Стало</th>
                <th className="px-3 py-2 font-medium text-right">Разница</th>
              </tr>
            </thead>
            <tbody>
              {day.changes.map((c, i) => (
                <tr
                  key={`${c.flowerType}-${c.variety}-${c.grade}-${i}`}
                  className="border-b border-line-hairline last:border-0"
                >
                  <td className="px-3 py-2">{FLOWER_TYPE_LABELS[c.flowerType] ?? c.flowerType}</td>
                  <td className="px-3 py-2">{c.variety || BASE_VARIETY_LABEL}</td>
                  <td className="px-3 py-2">{formatGrade(c.grade)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {c.from === null ? "—" : c.from.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {c.to === 0 ? "цены нет" : c.to.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.changePercent === null ? (
                      <span className="text-ink-muted">новая</span>
                    ) : (
                      <span
                        className={clsx(
                          c.changePercent > 0
                            ? "text-status-good"
                            : c.changePercent < 0
                            ? "text-status-critical"
                            : "text-ink-muted"
                        )}
                      >
                        {c.changePercent > 0 ? "+" : ""}
                        {c.changePercent.toFixed(1).replace(".", ",")} %
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function positionWord(n: number): string {
  const last = n % 10;
  const two = n % 100;
  if (two >= 11 && two <= 14) return "позиций";
  if (last === 1) return "позиция";
  if (last >= 2 && last <= 4) return "позиции";
  return "позиций";
}
