"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  copyPreviousShipmentPlanAction,
  parseShipmentPlanFileAction,
  saveShipmentPlansMonthAction,
} from "@/app/plans/actions";
import {
  DIRECTION_GROUPS,
  FLOWER_TYPE_LABELS_PLURAL,
  SHIPMENT_DIRECTIONS,
  farmLabel,
  getFarmFor,
  periodLabel,
  type PlanWeek,
} from "@/lib/constants";
import { planCellKey } from "@/lib/planCell";
import NumberCell, { parseNumber } from "./NumberCell";

/**
 * План отгрузок: весь месяц одной сеткой «направления × недели».
 *
 * Раньше на экране была одна неделя одного цветка, и чтобы закрыть месяц,
 * приходилось пройти пятнадцать экранов и вбить сто тридцать пять ячеек, причём
 * сумму — руками, хотя цена уже есть в прайсе. Теперь:
 *
 *   - месяц виден целиком: строки это направления, колонки недели, справа итог;
 *   - сумма НЕ вводится: она считается по цене стебля, которая берётся из
 *     прайс-листа и правится одним полем на цветок, а не в каждой ячейке;
 *   - рядом с итогом недели стоит прогноз срезки агронома и остаток — сколько
 *     стеблей ещё никому не обещано. Раньше ради этого надо было уходить на
 *     вкладку «Баланс»;
 *   - месяц можно взять из прошлого одной кнопкой или загрузить файлом.
 *
 * Цветок остаётся переключателем: направлений девять, и три цветка сразу дали бы
 * двадцать семь строк по пять колонок — это снова полотно.
 */

export interface ShipmentPlanCell {
  stems: number;
  amount: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

function shortMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(".", ",")} млн ₸`;
  if (abs >= 10_000) return `${fmt(n / 1000)} тыс ₸`;
  return `${fmt(n)} ₸`;
}

export default function ShipmentPlanGrid({
  month,
  weeks,
  flowerTypes,
  initial,
  prices,
  forecast,
}: {
  month: string;
  weeks: PlanWeek[];
  flowerTypes: string[];
  /** Ключ — «неделя|направление|цветок». */
  initial: Record<string, ShipmentPlanCell>;
  /** Средняя цена стебля из прайса, по цветку. Ноль — прайс не заполнен. */
  prices: Record<string, number>;
  /** Прогноз срезки агронома: [цветок][код недели] — стебли. */
  forecast: Record<string, Record<string, number>>;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState<Record<string, ShipmentPlanCell>>(initial);
  const [activeFlower, setActiveFlower] = useState(flowerTypes[0] ?? "");
  const [priceByFlower, setPriceByFlower] = useState<Record<string, number>>(prices);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Смена месяца в адресной строке — начинаем с чистого листа.
  const [seenMonth, setSeenMonth] = useState(month);
  if (seenMonth !== month) {
    setSeenMonth(month);
    setValues(initial);
    setPriceByFlower(prices);
    setNote(null);
    setError(null);
  }

  const price = priceByFlower[activeFlower] ?? 0;

  const get = (week: string, direction: string, flowerType = activeFlower): number =>
    values[planCellKey(week, direction, flowerType)]?.stems ?? 0;

  function setCell(week: string, direction: string, stems: number) {
    const key = planCellKey(week, direction, activeFlower);
    setValues((prev) => ({
      ...prev,
      [key]: { stems, amount: Math.round(stems * (priceByFlower[activeFlower] ?? 0)) },
    }));
    setNote(null);
  }

  /** Итоги по активному цветку. */
  const totals = useMemo(() => {
    const byWeek: Record<string, number> = {};
    const byDirection: Record<string, number> = {};
    let month = 0;
    for (const week of weeks) {
      let sum = 0;
      for (const direction of SHIPMENT_DIRECTIONS) {
        const stems = values[planCellKey(week.code, direction, activeFlower)]?.stems ?? 0;
        sum += stems;
        byDirection[direction] = (byDirection[direction] ?? 0) + stems;
      }
      byWeek[week.code] = sum;
      month += sum;
    }
    return { byWeek, byDirection, month };
  }, [values, weeks, activeFlower]);

  /** Сколько заполнено у каждого цветка — подпись на переключателе. */
  const filledByFlower = useMemo(() => {
    const out: Record<string, number> = {};
    for (const flowerType of flowerTypes) {
      let sum = 0;
      for (const week of weeks) {
        for (const direction of SHIPMENT_DIRECTIONS) {
          sum += values[planCellKey(week.code, direction, flowerType)]?.stems ?? 0;
        }
      }
      out[flowerType] = sum;
    }
    return out;
  }, [values, weeks, flowerTypes]);

  const changed = useMemo(() => {
    const rows: {
      period: string;
      direction: string;
      flowerType: string;
      targetStems: number;
      targetAmount: number;
    }[] = [];
    for (const week of weeks) {
      for (const direction of SHIPMENT_DIRECTIONS) {
        for (const flowerType of flowerTypes) {
          const key = planCellKey(week.code, direction, flowerType);
          const now = values[key] ?? { stems: 0, amount: 0 };
          // Сумма всегда пересчитывается по действующей цене: держать в таблице
          // сумму, не сходящуюся со стеблями, хуже, чем не держать вовсе.
          const amount = Math.round(now.stems * (priceByFlower[flowerType] ?? 0));
          const was = initial[key] ?? { stems: 0, amount: 0 };
          // Изменением считаем правку стеблей, а не расхождение сумм: иначе
          // страница открывалась бы с «изменено 120 ячеек» просто потому, что
          // цена в прайсе с тех пор поменялась. Правка самой цены — отдельный
          // повод переписать суммы, и тогда в список попадают все непустые
          // ячейки этого цветка.
          const priceChanged = (priceByFlower[flowerType] ?? 0) !== (prices[flowerType] ?? 0);
          if (now.stems !== was.stems || (priceChanged && now.stems > 0)) {
            rows.push({
              period: week.code,
              direction,
              flowerType,
              targetStems: now.stems,
              targetAmount: amount,
            });
          }
        }
      }
    }
    return rows;
  }, [values, initial, weeks, flowerTypes, priceByFlower, prices]);

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveShipmentPlansMonthAction(month, changed);
      setNote(`Сохранено ячеек: ${result.updated + result.created}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить план");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyPrevious() {
    setBusy("copy");
    setError(null);
    try {
      const { cells, fromMonth } = await copyPreviousShipmentPlanAction(month);
      if (cells.length === 0) {
        setNote(`В ${periodLabel(fromMonth)} плана не было — копировать нечего.`);
        return;
      }
      setValues((prev) => {
        const next = { ...prev };
        for (const cell of cells) {
          next[planCellKey(cell.week, cell.direction, cell.flowerType)] = {
            stems: cell.stems,
            amount: Math.round(cell.stems * (priceByFlower[cell.flowerType] ?? 0)),
          };
        }
        return next;
      });
      setNote(
        `Подставлен план за ${periodLabel(fromMonth)}: ${cells.length} ячеек. ` +
          "Проверьте и нажмите «Сохранить» — пока ничего не записано."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось взять прошлый месяц");
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(file: File) {
    setBusy("file");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("month", month);
      const result = await parseShipmentPlanFileAction(formData);

      if (result.fatalError) {
        setError(result.fatalError);
        return;
      }
      const good = result.rows.filter((r) => !r.error);
      setValues((prev) => {
        const next = { ...prev };
        for (const row of good) {
          next[planCellKey(row.week, row.direction, row.flowerType)] = {
            stems: row.stems,
            amount: Math.round(row.stems * (priceByFlower[row.flowerType] ?? 0)),
          };
        }
        return next;
      });

      const problems = result.rows.filter((r) => r.error);
      setNote(
        `Из файла прочитано ячеек: ${good.length}. ` +
          (problems.length > 0
            ? `Не понял ${problems.length}: ${problems
                .slice(0, 3)
                .map((p) => p.error)
                .join("; ")}${problems.length > 3 ? "…" : ""}. `
            : "") +
          "Проверьте и нажмите «Сохранить» — пока ничего не записано."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файл");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const forecastByWeek = forecast[activeFlower] ?? {};
  const forecastMonth = weeks.reduce((sum, w) => sum + (forecastByWeek[w.code] ?? 0), 0);
  const hasForecast = forecastMonth > 0;

  return (
    <div className="space-y-4">
      {/* --- Цветок ---------------------------------------------------------- */}
      <div className="flex flex-wrap gap-2">
        {flowerTypes.map((flowerType) => {
          const active = flowerType === activeFlower;
          const sum = filledByFlower[flowerType] ?? 0;
          return (
            <button
              key={flowerType}
              type="button"
              onClick={() => setActiveFlower(flowerType)}
              className={clsx(
                "rounded-xl border px-3 py-2 text-left transition-colors",
                active
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-hairline hover:bg-surface-plane"
              )}
            >
              <span className="block text-sm font-medium">
                {FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType}
              </span>
              <span className="block text-[11px] text-ink-muted">
                {sum > 0 ? `${fmt(sum)} шт за месяц` : "не заполнено"}
              </span>
            </button>
          );
        })}
      </div>

      {/* --- Цена и кнопки --------------------------------------------------- */}
      <div className="card flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <label className="label">Цена стебля для расчёта суммы</label>
          <div className="flex items-baseline gap-2">
            <input
              className="input !w-28 text-right tabular-nums"
              inputMode="decimal"
              value={price ? price.toLocaleString("ru-RU") : ""}
              placeholder="0"
              onFocus={(e) => e.target.select()}
              onChange={(e) =>
                setPriceByFlower((prev) => ({
                  ...prev,
                  [activeFlower]: parseNumber(e.target.value),
                }))
              }
            />
            <span className="text-sm text-ink-secondary">₸ за стебель</span>
          </div>
          <p className="text-xs text-ink-muted mt-1 max-w-sm">
            {prices[activeFlower] > 0
              ? `Средняя по прайс-листу — ${fmt(prices[activeFlower])} ₸. Сумма плана считается сама, вводить её не нужно.`
              : "В прайсе нет цен на этот цветок — впишите цену здесь, иначе план будет только в стеблях."}
            {price !== (prices[activeFlower] ?? 0) &&
              " Цена изменена — при сохранении суммы по всему цветку пересчитаются."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={handleCopyPrevious}
            disabled={busy !== null}
            className="btn-secondary disabled:opacity-50"
          >
            {busy === "copy" ? "Беру…" : "Взять из прошлого месяца"}
          </button>
          <a className="btn-secondary" href={`/api/plans/template?period=${month}`}>
            ↓ Скачать шаблон
          </a>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
            className="btn-secondary disabled:opacity-50"
          >
            {busy === "file" ? "Читаю…" : "Загрузить файл"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
      </div>

      {note && (
        <div className="text-sm text-ink-secondary bg-accent-soft/60 rounded-lg px-3 py-2">{note}</div>
      )}
      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* --- Сетка ----------------------------------------------------------- */}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-line-hairline text-ink-secondary">
              <th className="text-left px-4 py-2 font-medium sticky left-0 bg-surface z-10 min-w-[200px]">
                Направление
              </th>
              {weeks.map((week) => (
                <th key={week.code} className="px-2 py-2 font-medium text-center whitespace-nowrap">
                  Неделя {week.index}
                  <span className="block text-[11px] font-normal text-ink-muted">
                    {week.label} · {week.days} дн.
                  </span>
                </th>
              ))}
              <th className="px-4 py-2 font-medium text-right whitespace-nowrap">За месяц</th>
            </tr>
          </thead>

          <tbody>
            {DIRECTION_GROUPS.map((group) => (
              <Fragment key={group.key}>
                <tr className="bg-surface-plane/70">
                  <th
                    colSpan={weeks.length + 2}
                    className="text-left px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary sticky left-0"
                  >
                    {group.label}
                  </th>
                </tr>
                {group.directions.map((direction) => (
                  <tr key={direction} className="border-b border-line-hairline">
                    <td className="px-4 py-1.5 sticky left-0 bg-surface z-10">{direction}</td>
                    {weeks.map((week) => (
                      <td key={week.code} className="px-1 py-1.5">
                        <NumberCell
                          value={get(week.code, direction)}
                          onChange={(v) => setCell(week.code, direction, v)}
                          className="!w-full text-right"
                          ariaLabel={`${direction}, неделя ${week.index}`}
                        />
                      </td>
                    ))}
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                      {totals.byDirection[direction] > 0 ? fmt(totals.byDirection[direction]) : "—"}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t border-line-hairline bg-surface-plane/40">
              <td className="px-4 py-2 font-medium sticky left-0 bg-surface-plane/40">
                Итого · {FLOWER_TYPE_LABELS_PLURAL[activeFlower] ?? activeFlower}
                <span className="block text-[11px] font-normal text-ink-muted">
                  {farmLabel(getFarmFor(activeFlower))}
                </span>
              </td>
              {weeks.map((week) => (
                <td key={week.code} className="px-2 py-2 text-center tabular-nums font-semibold">
                  {totals.byWeek[week.code] > 0 ? fmt(totals.byWeek[week.code]) : "—"}
                </td>
              ))}
              <td className="px-4 py-2 text-right tabular-nums font-semibold">
                {fmt(totals.month)}
                <span className="block text-[11px] font-normal text-ink-muted">
                  {shortMoney(totals.month * price)}
                </span>
              </td>
            </tr>

            {/* Прогноз агронома прямо здесь: раньше ради этой строки надо было
                уходить на вкладку «Баланс». */}
            {hasForecast && (
              <>
                <tr className="text-ink-secondary">
                  <td className="px-4 py-1.5 sticky left-0 bg-surface">Срезка по прогнозу</td>
                  {weeks.map((week) => (
                    <td key={week.code} className="px-2 py-1.5 text-center tabular-nums">
                      {forecastByWeek[week.code] ? fmt(forecastByWeek[week.code]) : "—"}
                    </td>
                  ))}
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmt(forecastMonth)}</td>
                </tr>
                <tr className="border-t border-line-hairline">
                  <td className="px-4 py-1.5 sticky left-0 bg-surface font-medium">
                    Остаток без плана
                    <span className="block text-[11px] font-normal text-ink-muted">
                      вырастет минус обещано
                    </span>
                  </td>
                  {weeks.map((week) => {
                    const rest = (forecastByWeek[week.code] ?? 0) - (totals.byWeek[week.code] ?? 0);
                    return (
                      <td
                        key={week.code}
                        className={clsx(
                          "px-2 py-1.5 text-center tabular-nums font-medium",
                          rest < 0 ? "text-status-critical" : rest > 0 ? "text-[#8a5a00]" : "text-status-good"
                        )}
                      >
                        {rest === 0 ? "0" : `${rest > 0 ? "+" : "−"}${fmt(Math.abs(rest))}`}
                      </td>
                    );
                  })}
                  {(() => {
                    const rest = forecastMonth - totals.month;
                    return (
                      <td
                        className={clsx(
                          "px-4 py-1.5 text-right tabular-nums font-semibold",
                          rest < 0 ? "text-status-critical" : rest > 0 ? "text-[#8a5a00]" : "text-status-good"
                        )}
                      >
                        {rest === 0 ? "0" : `${rest > 0 ? "+" : "−"}${fmt(Math.abs(rest))}`}
                      </td>
                    );
                  })()}
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>

      {hasForecast && (
        <p className="text-xs text-ink-muted">
          Жёлтый остаток — эти стебли ещё никому не обещаны. Красный — обещано больше, чем вырастет.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || changed.length === 0}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? "Сохраняю…" : `Сохранить план на ${periodLabel(month).toLowerCase()}`}
        </button>
        <span className="text-sm text-ink-muted">
          {changed.length === 0 ? "Изменений нет" : `Изменено ячеек: ${changed.length}`}
        </span>
      </div>
    </div>
  );
}
