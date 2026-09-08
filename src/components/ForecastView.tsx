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
import type { ForecastFlowerSummary, ForecastSummary } from "@/lib/forecastSummary";
import MoreToggle from "./MoreToggle";

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

/** Сколько строк показывать без раскрытия. */
const VISIBLE_ROWS = 6;

export default function ForecastView({ summary }: { summary: ForecastSummary }) {
  const flowers = summary.flowers.filter((f) => f.total > 0 || f.mixTotal > 0);
  const [active, setActive] = useState(flowers[0]?.flowerType ?? "");

  if (summary.empty) {
    return (
      <div className="card text-sm text-ink-secondary">
        <p className="font-medium text-ink-primary mb-1">
          Прогноза на {periodLabel(summary.month).toLowerCase()} ещё нет
        </p>
        <p>
          Скачайте шаблон выше, заполните его в Excel и загрузите обратно. После загрузки здесь
          появится, что вырастет: по неделям, по сортам и по ростовке, с выходом высшей категории.
        </p>
      </div>
    );
  }

  const current = flowers.find((f) => f.flowerType === active) ?? flowers[0];

  return (
    <div className="space-y-4">
      {/* --- Итог по хозяйству ---------------------------------------------- */}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line-hairline text-ink-secondary">
              <th className="text-left px-4 py-2 font-medium sticky left-0 bg-surface z-10 min-w-[180px]">
                Что вырастет
              </th>
              {summary.weeks.map((w) => (
                <th key={w.code} className="px-3 py-2 font-medium text-right whitespace-nowrap">
                  Неделя {w.index}
                  <span className="block text-[11px] font-normal text-ink-muted">{w.label}</span>
                </th>
              ))}
              <th className="px-4 py-2 font-medium text-right">За месяц</th>
            </tr>
          </thead>
          <tbody>
            {flowers.map((f) => (
              <tr key={f.flowerType} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-2 sticky left-0 bg-surface z-10">
                  <span className="font-medium">
                    {FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}
                  </span>
                  <span className="block text-[11px] text-ink-muted">
                    {farmLabel(getFarmFor(f.flowerType))}
                  </span>
                </td>
                {summary.weeks.map((w) => (
                  <td key={w.code} className="px-3 py-2 text-right tabular-nums">
                    {f.byWeek[w.code] ? fmt(f.byWeek[w.code]) : "—"}
                  </td>
                ))}
                <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmt(f.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane/40">
              <td className="px-4 py-2 font-medium sticky left-0 bg-surface-plane/40">Всего</td>
              {summary.weeks.map((w) => {
                const sum = flowers.reduce((s, f) => s + (f.byWeek[w.code] ?? 0), 0);
                return (
                  <td key={w.code} className="px-3 py-2 text-right tabular-nums font-semibold">
                    {sum ? fmt(sum) : "—"}
                  </td>
                );
              })}
              <td className="px-4 py-2 text-right tabular-nums font-semibold">
                {fmt(flowers.reduce((s, f) => s + f.total, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* --- Цветок ---------------------------------------------------------- */}
      {flowers.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {flowers.map((f) => {
            const isActive = f.flowerType === current.flowerType;
            return (
              <button
                key={f.flowerType}
                type="button"
                onClick={() => setActive(f.flowerType)}
                className={clsx(
                  "rounded-xl border px-3 py-2 text-left transition-colors",
                  isActive
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-hairline hover:bg-surface-plane"
                )}
              >
                <span className="block text-sm font-medium">
                  {FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}
                </span>
                <span className="block text-[11px] text-ink-muted">{fmt(f.total)} шт за месяц</span>
              </button>
            );
          })}
        </div>
      )}

      <FlowerDetail flower={current} summary={summary} />
    </div>
  );
}

function FlowerDetail({
  flower,
  summary,
}: {
  flower: ForecastFlowerSummary;
  summary: ForecastSummary;
}) {
  const gradeColumn = gradeColumnLabel(flower.flowerType);

  return (
    <div className="space-y-4">
      {/* Выход качества — то, ради чего в прогноз и смотрят. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Всего за месяц"
          value={`${fmt(flower.total)} шт`}
          hint={`по таблице сортов · ${fmt(flower.total / Math.max(1, summary.weeks.length))} шт в среднем за неделю`}
        />
        <Tile
          label="Высшая категория"
          value={flower.topPercent === null ? "—" : pct(flower.topPercent)}
          hint={`${fmt(flower.topStems)} шт · ${topGradeHint(flower.flowerType)}`}
          tone={
            flower.topPercent === null
              ? "neutral"
              : flower.topPercent >= 25
                ? "good"
                : flower.topPercent >= 10
                  ? "warning"
                  : "critical"
          }
        />
        <Tile
          label="Ликвидное качество"
          value={flower.liquidPercent === null ? "—" : pct(flower.liquidPercent)}
          hint={`${fmt(flower.liquidStems)} шт · то, что уходит без скидок`}
          tone={
            flower.liquidPercent === null
              ? "neutral"
              : flower.liquidPercent >= 70
                ? "good"
                : flower.liquidPercent >= 50
                  ? "warning"
                  : "critical"
          }
        />
        <Tile
          label="Сорта и ростовка"
          value={flower.mismatch === 0 ? "сходятся" : `${flower.mismatch > 0 ? "+" : "−"}${fmt(Math.abs(flower.mismatch))}`}
          hint={
            flower.mismatch === 0
              ? "две таблицы файла дали одну и ту же цифру"
              : `по сортам ${fmt(flower.total)}, по ростовке ${fmt(flower.mixTotal)} — это один урожай, цифры должны сходиться`
          }
          tone={flower.mismatch === 0 ? "good" : "warning"}
        />
      </div>

      <ForecastTable
        title="Сколько даст каждый сорт"
        hint="Сверху то, что даёт больше всего"
        firstColumn="Сорт"
        rows={flower.varieties.map((line) => ({ ...line, label: line.label }))}
        weeks={summary.weeks}
        total={flower.total}
        word={(n) => plural(n, "сорт", "сорта", "сортов")}
      />

      <ForecastTable
        title={`Какая получится ${gradeColumn.toLowerCase() === "категория" ? "категория" : "ростовка"}`}
        hint="В обычном порядке цветка, а не по объёму"
        firstColumn={gradeColumn}
        rows={flower.grades.map((line) => ({
          ...line,
          label: formatGrade(line.label),
        }))}
        weeks={summary.weeks}
        total={flower.mixTotal}
        word={(n) =>
          gradeColumn === "Категория"
            ? plural(n, "категория", "категории", "категорий")
            : plural(n, "ростовка", "ростовки", "ростовок")
        }
      />
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
  title,
  hint,
  firstColumn,
  rows,
  weeks,
  total,
  word,
}: {
  title: string;
  hint: string;
  firstColumn: string;
  rows: { label: string; total: number; share: number; byWeek: Record<string, number>; top?: boolean; liquid?: boolean }[];
  weeks: ForecastSummary["weeks"];
  total: number;
  word: (n: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, VISIBLE_ROWS);
  const hidden = rows.length - shown.length;

  if (rows.length === 0) {
    return (
      <div>
        <h3 className="font-medium mb-2">{title}</h3>
        <div className="card text-sm text-ink-muted">В файле этой таблицы не было.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs text-ink-muted">{hint}</span>
      </div>

      <div className="card !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-line-hairline text-ink-secondary">
                <th className="text-left px-4 py-2 font-medium sticky left-0 bg-surface z-10 min-w-[180px]">
                  {firstColumn}
                </th>
                {weeks.map((w) => (
                  <th key={w.code} className="px-3 py-2 font-medium text-right whitespace-nowrap">
                    Неделя {w.index}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium text-right">За месяц</th>
                <th className="px-4 py-2 font-medium text-right">Доля</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.label} className="border-b border-line-hairline last:border-0">
                  <td className="px-4 py-2 sticky left-0 bg-surface z-10">
                    <span className="font-medium">{row.label}</span>
                    {row.top && (
                      <span className="ml-2 text-[11px] text-status-good">высшая</span>
                    )}
                    {!row.top && row.liquid && (
                      <span className="ml-2 text-[11px] text-ink-muted">ликвид</span>
                    )}
                  </td>
                  {weeks.map((w) => (
                    <td key={w.code} className="px-3 py-2 text-right tabular-nums">
                      {row.byWeek[w.code] ? fmt(row.byWeek[w.code]) : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(row.total)}</td>
                  <td className="px-4 py-2 text-right">
                    {/* Полоска доли: видно структуру урожая, а не только цифры. */}
                    <span className="flex items-center justify-end gap-2">
                      <span className="h-1.5 w-16 rounded-full bg-surface-plane overflow-hidden hidden sm:block">
                        <span
                          className="h-full block rounded-full bg-accent/70"
                          style={{ width: `${Math.max(2, row.share)}%` }}
                        />
                      </span>
                      <span className="tabular-nums text-ink-secondary">{pct(row.share)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-plane/40">
                <td className="px-4 py-2 font-medium sticky left-0 bg-surface-plane/40">Итого</td>
                {weeks.map((w) => {
                  const sum = rows.reduce((s, r) => s + (r.byWeek[w.code] ?? 0), 0);
                  return (
                    <td key={w.code} className="px-3 py-2 text-right tabular-nums font-semibold">
                      {sum ? fmt(sum) : "—"}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(total)}</td>
                <td className="px-4 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
        {(hidden > 0 || open) && (
          <div className="px-4 py-2 border-t border-line-hairline">
            <MoreToggle
              expanded={open}
              hidden={hidden}
              onToggle={() => setOpen((v) => !v)}
              what={word(hidden)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "warning" | "critical" | "neutral";
}) {
  const border =
    tone === "good"
      ? "border-status-good/30 bg-status-good/[0.04]"
      : tone === "warning"
        ? "border-status-warning/40 bg-status-warning/[0.06]"
        : tone === "critical"
          ? "border-status-critical/40 bg-status-critical/[0.05]"
          : "border-line-hairline";
  const text =
    tone === "good"
      ? "text-status-good"
      : tone === "warning"
        ? "text-[#8a5a00]"
        : tone === "critical"
          ? "text-status-critical"
          : "";

  return (
    <div className={clsx("card !p-4 border", border)}>
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className={clsx("text-2xl font-semibold tabular-nums leading-tight mt-1", text)}>
        {value}
      </div>
      <div className="text-xs text-ink-muted mt-1">{hint}</div>
    </div>
  );
}
