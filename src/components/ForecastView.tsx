"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  FLOWER_TYPE_LABELS_PLURAL,
  farmLabel,
  formatGrade,
  getFarmFor,
  gradeColumnLabel,
  periodLabel,
  topGradeHint,
} from "@/lib/constants";
import type { ForecastSummary } from "@/lib/forecastSummary";
import KpiTile from "./KpiTile";
import Chips from "./Chips";
import CardTabs from "./CardTabs";
import Pager, { pageSlice } from "./Pager";

/**
 * Загруженный прогноз срезки — как отчёт, а не как форма.
 *
 * Раньше эта страница была сеткой полей: агроном набивал цифры руками. Владелец
 * решил иначе — прогноз меняется файлом, и каждый раз файл перезагружается
 * целиком. Значит странице остаётся ответить на вопрос «что вырастет»: сколько
 * всего, по неделям, каких сортов, какой ростовки и сколько в этом высшей
 * категории и ликвида.
 *
 * Полей ввода здесь нет намеренно. Две одинаковые двери — файл и ручная
 * правка — расходятся уже к третьей загрузке: кто-то поправил ячейку, потом
 * загрузил старый файл и затёр правку, не заметив.
 */

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1).replace(".", ",")} %`;

type Tab = "weeks" | "varieties" | "grades";

export default function ForecastView({ summary }: { summary: ForecastSummary }) {
  const flowers = summary.flowers.filter((f) => f.total > 0 || f.mixTotal > 0);
  const [active, setActive] = useState(flowers[0]?.flowerType ?? "");
  const [tab, setTab] = useState<Tab>("varieties");

  if (summary.empty) {
    return (
      <div className="card text-center py-14">
        <div className="text-2xl mb-2">🌱</div>
        <p className="font-medium">Прогноза на {periodLabel(summary.month).toLowerCase()} ещё нет</p>
        <p className="text-sm text-ink-muted mt-1">Загрузите файл выше.</p>
      </div>
    );
  }

  const current = flowers.find((f) => f.flowerType === active) ?? flowers[0];
  const flowerName = FLOWER_TYPE_LABELS_PLURAL[current.flowerType] ?? current.flowerType;
  const gradeColumn = gradeColumnLabel(current.flowerType);

  return (
    <div>
      {/* --- Цветок ---------------------------------------------------------- */}
      {flowers.length > 1 && (
        <Chips
          className="mb-4"
          value={current.flowerType}
          onChange={setActive}
          items={flowers.map((f) => ({
            value: f.flowerType,
            label: `${FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType} · ${fmt(f.total)} шт`,
          }))}
        />
      )}

      {/* Выход качества — то, ради чего в прогноз и смотрят. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile
          icon="leaf"
          label={`${flowerName} · всего за месяц`}
          value={`${fmt(current.total)} шт`}
          hint={`≈ ${fmt(current.total / Math.max(1, summary.weeks.length))} шт в неделю`}
        />
        <KpiTile
          icon="trophy"
          label="Высшая категория"
          value={current.topPercent === null ? "—" : pct(current.topPercent)}
          hint={`${fmt(current.topStems)} шт · ${topGradeHint(current.flowerType)}`}
          tone={current.topPercent === null ? undefined : current.topPercent >= 25 ? "good" : current.topPercent >= 10 ? "warn" : "bad"}
        />
        <KpiTile
          icon="check"
          label="Ликвидное качество"
          value={current.liquidPercent === null ? "—" : pct(current.liquidPercent)}
          hint={`${fmt(current.liquidStems)} шт`}
          tone={current.liquidPercent === null ? undefined : current.liquidPercent >= 70 ? "good" : current.liquidPercent >= 50 ? "warn" : "bad"}
        />
        <KpiTile
          icon="list"
          label="Сорта и ростовка"
          value={current.mismatch === 0 ? "сходятся" : `${current.mismatch > 0 ? "+" : "−"}${fmt(Math.abs(current.mismatch))}`}
          hint={current.mismatch === 0 ? "итоги совпали" : `по сортам ${fmt(current.total)}, по ростовке ${fmt(current.mixTotal)}`}
          tone={current.mismatch === 0 ? "good" : "warn"}
        />
      </div>

      <div className="card !p-0 overflow-hidden">
        <CardTabs
          tone="forecast"
          items={[
            { key: "varieties" as Tab, label: `Сорта · ${flowerName.toLowerCase()} (${current.varieties.length})` },
            {
              key: "grades" as Tab,
              label: `${gradeColumn.toLowerCase() === "категория" ? "Категории" : "Ростовка"} · ${flowerName.toLowerCase()}`,
            },
            { key: "weeks" as Tab, label: "Все цветы по неделям" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "varieties" && (
          <ForecastTable
            key={`v-${current.flowerType}`}
            firstColumn="Сорт"
            rows={current.varieties.map((line) => ({ ...line, label: line.label }))}
            weeks={summary.weeks}
            total={current.total}
            word={(n) => plural(n, "сорт", "сорта", "сортов")}
          />
        )}
        {tab === "grades" && (
          <ForecastTable
            key={`g-${current.flowerType}`}
            firstColumn={gradeColumn}
            rows={current.grades.map((line) => ({ ...line, label: formatGrade(line.label) }))}
            weeks={summary.weeks}
            total={current.mixTotal}
            word={(n) =>
              gradeColumn === "Категория"
                ? plural(n, "категория", "категории", "категорий")
                : plural(n, "ростовка", "ростовки", "ростовок")
            }
          />
        )}
        {tab === "weeks" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
                  <th className="text-left px-4 py-2.5 font-medium sticky left-0 bg-surface-plane z-10 min-w-[180px]">Цветок</th>
                  {summary.weeks.map((w) => (
                    <th key={w.code} className="px-3 py-2.5 font-medium text-right whitespace-nowrap text-ink-secondary">
                      Неделя {w.index}
                      <span className="block text-[11px] font-normal text-ink-muted">{w.label}</span>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-medium text-right text-ink-secondary">За месяц</th>
                </tr>
              </thead>
              <tbody>
                {flowers.map((f) => (
                  <tr
                    key={f.flowerType}
                    className={clsx(
                      "border-b border-line-hairline last:border-0 cursor-pointer hover:bg-surface-plane/60",
                      f.flowerType === current.flowerType && "bg-section-forecast/5"
                    )}
                    onClick={() => setActive(f.flowerType)}
                  >
                    <td className="px-4 py-2.5 sticky left-0 bg-surface z-10">
                      <span className="font-semibold">{FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}</span>
                      <span className="block text-[11px] text-ink-muted">{farmLabel(getFarmFor(f.flowerType))}</span>
                    </td>
                    {summary.weeks.map((w) => (
                      <td key={w.code} className="px-3 py-2.5 text-right tabular-nums">
                        {f.byWeek[w.code] ? fmt(f.byWeek[w.code]) : "—"}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(f.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-plane/60 border-t border-line-hairline">
                  <td className="px-4 py-2.5 font-semibold sticky left-0 bg-surface-plane z-10">Всего</td>
                  {summary.weeks.map((w) => {
                    const sum = flowers.reduce((acc, f) => acc + (f.byWeek[w.code] ?? 0), 0);
                    return (
                      <td key={w.code} className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {sum ? fmt(sum) : "—"}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(flowers.reduce((acc, f) => acc + f.total, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return many;
  if (o > 1 && o < 5) return few;
  if (o === 1) return one;
  return many;
}

function ForecastTable({
  firstColumn,
  rows,
  weeks,
  total,
  word,
}: {
  firstColumn: string;
  rows: { label: string; total: number; share: number; byWeek: Record<string, number>; top?: boolean; liquid?: boolean }[];
  weeks: ForecastSummary["weeks"];
  total: number;
  word: (n: number) => string;
}) {
  const [page, setPage] = useState(0);
  const shown = pageSlice(rows, page);

  if (rows.length === 0) {
    return <p className="px-4 py-12 text-center text-sm text-ink-muted">В файле этой таблицы не было.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
              <th className="text-left px-4 py-2.5 font-medium sticky left-0 bg-surface-plane z-10 min-w-[180px]">{firstColumn}</th>
              {weeks.map((w) => (
                <th key={w.code} className="px-3 py-2.5 font-medium text-right whitespace-nowrap text-ink-secondary">
                  Неделя {w.index}
                </th>
              ))}
              <th className="px-3 py-2.5 font-medium text-right text-ink-secondary">За месяц</th>
              <th className="px-4 py-2.5 font-medium text-right text-ink-secondary">Доля</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.label} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane/60">
                <td className="px-4 py-2.5 sticky left-0 bg-surface z-10">
                  <span className="font-semibold">{row.label}</span>
                  {row.top && <span className="ml-2 text-[11px] text-status-good">высшая</span>}
                  {!row.top && row.liquid && <span className="ml-2 text-[11px] text-ink-muted">ликвид</span>}
                </td>
                {weeks.map((w) => (
                  <td key={w.code} className="px-3 py-2.5 text-right tabular-nums">
                    {row.byWeek[w.code] ? fmt(row.byWeek[w.code]) : "—"}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(row.total)}</td>
                <td className="px-4 py-2.5 text-right">
                  {/* Полоска доли: видно структуру урожая, а не только цифры. */}
                  <span className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-16 rounded-full bg-surface-sunk overflow-hidden hidden sm:block">
                      <span className="h-full block rounded-full bg-section-forecast" style={{ width: `${Math.max(2, row.share)}%` }} />
                    </span>
                    <span className="tabular-nums text-ink-secondary">{pct(row.share)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane/60 border-t border-line-hairline">
              <td className="px-4 py-2.5 font-semibold sticky left-0 bg-surface-plane z-10">Итого</td>
              {weeks.map((w) => {
                const sum = rows.reduce((acc, r) => acc + (r.byWeek[w.code] ?? 0), 0);
                return (
                  <td key={w.code} className="px-3 py-2.5 text-right tabular-nums font-semibold">
                    {sum ? fmt(sum) : "—"}
                  </td>
                );
              })}
              <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(total)}</td>
              <td className="px-4 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
      <Pager total={rows.length} page={page} onPage={setPage} what={word(rows.length)} />
    </>
  );
}
