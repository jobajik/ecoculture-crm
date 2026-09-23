"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { formatNumber, parseNumber } from "./NumberCell";
import Hint from "./Hint";
import SaveBar from "./SaveBar";
import { unwrapValue } from "@/lib/actionResult";

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
 *
 * Вид (сентябрь, «слишком много загажено»): одна строка управления вместо
 * карточки с тремя кнопками, клетки без рамок и без прочерков — как лист
 * таблицы, правленая клетка подсвечена, «Сохранить» появляется полоской внизу
 * только когда есть что сохранить.
 */

export interface ShipmentPlanCell {
  stems: number;
  amount: number;
}

/** Факт клетки: сколько заказано на эту неделю, направление и цветок и сколько уже отгружено. */
export interface ShipmentFactCell {
  ordered: number;
  shipped: number;
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
  fact = {},
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
  /** Факт по клеткам, ключ как у плана. Пусто — заказов нет. */
  fact?: Record<string, ShipmentFactCell>;
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

  const factOf = (week: string, direction: string): ShipmentFactCell =>
    fact[planCellKey(week, direction, activeFlower)] ?? { ordered: 0, shipped: 0 };
  const factWeek = (week: string) =>
    SHIPMENT_DIRECTIONS.reduce(
      (acc, d) => {
        const f = factOf(week, d);
        return { ordered: acc.ordered + f.ordered, shipped: acc.shipped + f.shipped };
      },
      { ordered: 0, shipped: 0 }
    );
  const factDirection = (direction: string) =>
    weeks.reduce((sum, w) => sum + factOf(w.code, direction).ordered, 0);

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
      const result = unwrapValue(await saveShipmentPlansMonthAction(month, changed));
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
      const { cells, fromMonth } = unwrapValue(await copyPreviousShipmentPlanAction(month));
      if (cells.length === 0) {
        setNote(`В ${periodLabel(fromMonth)} плана не было.`);
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
          "Ещё не записано — нажмите «Сохранить»."
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
      const result = unwrapValue(await parseShipmentPlanFileAction(formData));

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
          "Ещё не записано — нажмите «Сохранить»."
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
  const listPrice = prices[activeFlower] ?? 0;
  const orderedMonth = weeks.reduce((sum, w) => sum + factWeek(w.code).ordered, 0);
  const shippedMonth = weeks.reduce((sum, w) => sum + factWeek(w.code).shipped, 0);
  const cols = weeks.length + 2;

  function resetAll() {
    setValues(initial);
    setPriceByFlower(prices);
    setNote(null);
    setError(null);
  }

  return (
    <div className="space-y-3">
      {/* --- Одна строка управления: цветок · цена · действия ----------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="inline-flex rounded-lg border border-line-hairline bg-surface-plane p-1" role="tablist">
          {flowerTypes.map((flowerType) => {
            const active = flowerType === activeFlower;
            const sum = filledByFlower[flowerType] ?? 0;
            return (
              <button
                key={flowerType}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveFlower(flowerType)}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
                  active ? "bg-surface shadow-sm font-medium" : "text-ink-secondary hover:text-ink-primary"
                )}
              >
                {FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType}
                <span className={clsx("ml-1.5 text-xs tabular-nums", active ? "text-ink-secondary" : "text-ink-muted")}>
                  {sum > 0 ? fmt(sum) : "0"}
                </span>
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          Цена стебля
          <span className="relative">
            <input
              className="w-24 rounded-md border border-line-hairline bg-surface pl-2 pr-6 py-1.5 text-right text-base sm:text-sm tabular-nums text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              inputMode="decimal"
              aria-label="Цена стебля"
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
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted">₸</span>
          </span>
          {price !== listPrice ? (
            <span className="text-xs text-[#8a5a00]">
              {listPrice > 0 ? `в прайсе ${fmt(listPrice)} — ` : ""}суммы пересчитаются
            </span>
          ) : (
            listPrice === 0 && <span className="text-xs text-[#8a5a00]">нет в прайсе</span>
          )}
        </label>

        <div className="ml-auto flex items-center gap-1">
          <Hint>
            В клетке — план в стеблях. Под ним мелко — сколько уже заказано на эту неделю (и сколько
            отгружено). Зелёным — заказов не меньше плана, жёлтым — везут без плана. Сумма не вводится:
            стебли × цена стебля (из прайса, можно поправить на месяц). Внизу — прогноз срезки агронома
            и сколько стеблей ещё никому не обещано.
          </Hint>
          <ActionsMenu
            busy={busy}
            month={month}
            onCopy={handleCopyPrevious}
            onUpload={() => fileInput.current?.click()}
          />
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

      {note && <div className="text-sm text-ink-secondary bg-accent-soft/60 rounded-lg px-3 py-2">{note}</div>}
      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* --- Сетка: как лист таблицы, без рамки у каждого поля ---------------- */}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[680px] border-collapse">
          <thead>
            <tr className="border-b border-line-hairline">
              <th className="text-left px-4 py-2.5 font-medium text-ink-secondary sticky left-0 bg-surface z-10 min-w-[170px]">
                Направление
              </th>
              {weeks.map((week) => (
                <th key={week.code} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                  Неделя {week.index}
                  <span className="block text-[11px] font-normal text-ink-muted">{week.label}</span>
                </th>
              ))}
              <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap bg-surface-plane/50">Месяц</th>
            </tr>
          </thead>

          <tbody>
            {DIRECTION_GROUPS.map((group) => (
              <Fragment key={group.key}>
                <tr>
                  <th
                    colSpan={cols}
                    className="text-left px-4 pt-3 pb-1 text-xs font-medium text-ink-muted sticky left-0"
                  >
                    {group.label}
                  </th>
                </tr>
                {group.directions.map((direction) => {
                  const rowTotal = totals.byDirection[direction] ?? 0;
                  const rowFact = factDirection(direction);
                  return (
                    <tr key={direction} className="border-t border-line-hairline/70 hover:bg-surface-plane/40">
                      <td className="px-4 py-1 sticky left-0 bg-surface z-10 whitespace-nowrap">{direction}</td>
                      {weeks.map((week) => {
                        const plan = get(week.code, direction);
                        const done = factOf(week.code, direction);
                        const edited = plan !== (initial[planCellKey(week.code, direction, activeFlower)]?.stems ?? 0);
                        return (
                          <td key={week.code} className="px-1 py-1 align-top border-l border-line-hairline/70">
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              aria-label={`${direction}, неделя ${week.index}`}
                              value={formatNumber(plan)}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setCell(week.code, direction, parseNumber(e.target.value))}
                              className={clsx(
                                "w-full rounded-md bg-transparent px-2 py-1.5 text-right tabular-nums text-base sm:text-sm",
                                "hover:bg-surface-plane focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40",
                                edited && "bg-accent-soft/60 font-medium"
                              )}
                            />
                            {done.ordered > 0 && <FactLine plan={plan} ordered={done.ordered} shipped={done.shipped} />}
                          </td>
                        );
                      })}
                      <td className="px-4 py-1 align-top text-right tabular-nums bg-surface-plane/50">
                        <div className="py-1.5 font-medium">{rowTotal > 0 ? fmt(rowTotal) : ""}</div>
                        {rowFact > 0 && <FactLine plan={rowTotal} ordered={rowFact} />}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>

          <tfoot className="tabular-nums">
            <tr className="border-t-2 border-line-hairline">
              <td className="px-4 py-2.5 font-semibold sticky left-0 bg-surface z-10">
                Итого
                <span className="block text-[11px] font-normal text-ink-muted">
                  {farmLabel(getFarmFor(activeFlower))}
                </span>
              </td>
              {weeks.map((week) => (
                <td key={week.code} className="px-3 py-2.5 text-right font-semibold">
                  {totals.byWeek[week.code] > 0 ? fmt(totals.byWeek[week.code]) : ""}
                </td>
              ))}
              <td className="px-4 py-2.5 text-right font-semibold bg-surface-plane/50 whitespace-nowrap">
                {fmt(totals.month)}
                {totals.month > 0 && price > 0 && (
                  <span className="block text-[11px] font-normal text-ink-muted">{shortMoney(totals.month * price)}</span>
                )}
              </td>
            </tr>

            {/* Факт недели по всем направлениям — рядом с планом. */}
            {orderedMonth > 0 && (
              <tr className="text-ink-secondary">
                <td className="px-4 py-1.5 sticky left-0 bg-surface z-10">Заказано / отгружено</td>
                {weeks.map((week) => {
                  const f = factWeek(week.code);
                  const plan = totals.byWeek[week.code] ?? 0;
                  return (
                    <td key={week.code} className="px-3 py-1.5 text-right whitespace-nowrap">
                      {f.ordered > 0 && (
                        <>
                          <span className={clsx(plan > 0 && f.ordered >= plan && "text-status-good font-medium")}>
                            {fmt(f.ordered)}
                          </span>
                          <span className="text-ink-muted"> / {f.shipped > 0 ? fmt(f.shipped) : "0"}</span>
                        </>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-1.5 text-right whitespace-nowrap bg-surface-plane/50">
                  {fmt(orderedMonth)}
                  <span className="text-ink-muted"> / {fmt(shippedMonth)}</span>
                </td>
              </tr>
            )}

            {/* Прогноз агронома прямо здесь: без ухода на вкладку «Срезка». */}
            {hasForecast && (
              <>
                <tr className="text-ink-secondary">
                  <td className="px-4 py-1.5 sticky left-0 bg-surface z-10">Срезка по прогнозу</td>
                  {weeks.map((week) => (
                    <td key={week.code} className="px-3 py-1.5 text-right">
                      {forecastByWeek[week.code] ? fmt(forecastByWeek[week.code]) : ""}
                    </td>
                  ))}
                  <td className="px-4 py-1.5 text-right bg-surface-plane/50">{fmt(forecastMonth)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-1.5 sticky left-0 bg-surface z-10 font-medium">
                    Остаток без плана
                  </td>
                  {weeks.map((week) => (
                    <td key={week.code} className="px-3 py-1.5 text-right">
                      <Rest value={(forecastByWeek[week.code] ?? 0) - (totals.byWeek[week.code] ?? 0)} />
                    </td>
                  ))}
                  <td className="px-4 py-1.5 text-right bg-surface-plane/50">
                    <Rest value={forecastMonth - totals.month} strong />
                  </td>
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>

      <SaveBar count={changed.length} what="ячеек" saving={saving} onSave={handleSave} onReset={resetAll} />
    </div>
  );
}

/** «+300» — срезки больше плана (жёлтый), «−300» — плана больше срезки (красный), 0 — сходится. */
function Rest({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <span
      className={clsx(
        strong ? "font-semibold" : "font-medium",
        value < 0 ? "text-status-critical" : value > 0 ? "text-[#8a5a00]" : "text-status-good"
      )}
    >
      {value === 0 ? "0" : `${value > 0 ? "+" : "−"}${fmt(Math.abs(value))}`}
    </span>
  );
}

/**
 * «Ещё ▾»: взять прошлый месяц, шаблон, загрузка файла. Три кнопки в ряд
 * занимали целую карточку над сеткой, а нужны раз в месяц.
 */
function ActionsMenu({
  busy,
  month,
  onCopy,
  onUpload,
}: {
  busy: string | null;
  month: string;
  onCopy: () => void;
  onUpload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const item = "block w-full text-left px-3 py-2 text-sm hover:bg-surface-plane disabled:opacity-50";
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className="btn-secondary !py-1.5 disabled:opacity-50"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
      >
        {busy === "copy" ? "Беру…" : busy === "file" ? "Читаю…" : "Заполнить ▾"}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-line-hairline bg-surface py-1 shadow-card-hover"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onCopy();
            }}
          >
            Взять из прошлого месяца
          </button>
          <a role="menuitem" className={item} href={`/api/plans/template?period=${month}`} onClick={() => setOpen(false)}>
            Скачать шаблон Excel
          </a>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onUpload();
            }}
          >
            Загрузить из Excel…
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Строка факта под клеткой плана: «заказ 800». Зелёная — план закрыт заказами;
 * жёлтая — везут без плана; серая — заказано меньше плана. Если что-то уже
 * отгружено, после косой черты — сколько.
 */
function FactLine({ plan, ordered, shipped }: { plan: number; ordered: number; shipped?: number }) {
  const tone = plan <= 0 ? "text-[#8a5a00]" : ordered >= plan ? "text-status-good" : "text-ink-muted";
  return (
    <div
      className={clsx("pb-1 pr-2 text-right text-[11px] leading-tight tabular-nums whitespace-nowrap", tone)}
      title={`Заказано ${fmt(ordered)}${shipped ? `, отгружено ${fmt(shipped)}` : ""}${plan <= 0 ? " — без плана" : ""}`}
    >
      {plan <= 0 ? "без плана " : "заказ "}
      {fmt(ordered)}
      {shipped ? <span className="opacity-70"> / {fmt(shipped)}</span> : null}
    </div>
  );
}
