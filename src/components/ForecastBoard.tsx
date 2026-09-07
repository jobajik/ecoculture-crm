"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { saveForecastAction, saveMixAction } from "@/app/forecast/actions";
import {
  FLOWER_TYPE_LABELS_PLURAL,
  GRADE_LABELS,
  formatGrade,
  getGradesFor,
  isTopGrade,
  periodLabel,
  topGradeHint,
  type PlanWeek,
} from "@/lib/constants";
import { forecastCellKey, mixCellKey } from "@/lib/forecastCell";
import { parseNumber } from "./NumberCell";

/**
 * Прогноз срезки: две таблицы, недели — колонками.
 *
 * «Сорта» отвечают на вопрос «сколько даст каждый сорт», «ростовка» — «какая
 * длина получится по цветку в целом». Это два разных знания агронома, и они
 * специально не сведены в одну таблицу: ростовку по каждому сорту в отдельности
 * агроном не знает, и, потребовав её, мы получили бы выдуманные цифры вместо
 * прогноза.
 *
 * Недели стоят колонками, а не переключателем: месяц — это пять цифр в строке,
 * их видно разом, и волна срезки читается по строке слева направо.
 */
export default function ForecastBoard({
  month,
  weeks,
  flowerTypes,
  varieties,
  initialVarieties,
  initialMix,
}: {
  month: string;
  weeks: PlanWeek[];
  flowerTypes: string[];
  varieties: Record<string, string[]>;
  /** Ключ — «неделя|цветок|сорт». */
  initialVarieties: Record<string, number>;
  /** Ключ — «неделя|цветок|градация». */
  initialMix: Record<string, number>;
}) {
  const router = useRouter();
  const [sortValues, setSortValues] = useState(initialVarieties);
  const [mixValues, setMixValues] = useState(initialMix);
  const [active, setActive] = useState(flowerTypes[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [seenMonth, setSeenMonth] = useState(month);
  if (seenMonth !== month) {
    setSeenMonth(month);
    setSortValues(initialVarieties);
    setMixValues(initialMix);
    setSaved(null);
    setError(null);
  }

  const grades = getGradesFor(active);
  const rows = useMemo(() => varieties[active] ?? [], [varieties, active]);

  const changedVarieties = useMemo(() => {
    const out: { week: string; flowerType: string; variety: string; stems: number }[] = [];
    for (const week of weeks) {
      for (const flowerType of flowerTypes) {
        for (const variety of varieties[flowerType] ?? []) {
          const key = forecastCellKey(week.code, flowerType, variety);
          const now = sortValues[key] ?? 0;
          if (now !== (initialVarieties[key] ?? 0)) {
            out.push({ week: week.code, flowerType, variety, stems: now });
          }
        }
      }
    }
    return out;
  }, [sortValues, initialVarieties, weeks, flowerTypes, varieties]);

  const changedMix = useMemo(() => {
    const out: { week: string; flowerType: string; grade: string; stems: number }[] = [];
    for (const week of weeks) {
      for (const flowerType of flowerTypes) {
        for (const grade of getGradesFor(flowerType)) {
          const key = mixCellKey(week.code, flowerType, grade);
          const now = mixValues[key] ?? 0;
          if (now !== (initialMix[key] ?? 0)) {
            out.push({ week: week.code, flowerType, grade, stems: now });
          }
        }
      }
    }
    return out;
  }, [mixValues, initialMix, weeks, flowerTypes]);

  const changedCount = changedVarieties.length + changedMix.length;

  /** Итоги по активному цветку: по неделям и за месяц, отдельно сорта и ростовка. */
  const totals = useMemo(() => {
    const sortByWeek: Record<string, number> = {};
    const mixByWeek: Record<string, number> = {};
    const topByWeek: Record<string, number> = {};
    for (const week of weeks) {
      sortByWeek[week.code] = rows.reduce(
        (s, v) => s + (sortValues[forecastCellKey(week.code, active, v)] ?? 0),
        0
      );
      mixByWeek[week.code] = grades.reduce(
        (s, g) => s + (mixValues[mixCellKey(week.code, active, g)] ?? 0),
        0
      );
      topByWeek[week.code] = grades
        .filter((g) => isTopGrade(active, g))
        .reduce((s, g) => s + (mixValues[mixCellKey(week.code, active, g)] ?? 0), 0);
    }
    const sortMonth = Object.values(sortByWeek).reduce((s, v) => s + v, 0);
    const mixMonth = Object.values(mixByWeek).reduce((s, v) => s + v, 0);
    const topMonth = Object.values(topByWeek).reduce((s, v) => s + v, 0);
    return {
      sortByWeek,
      mixByWeek,
      topByWeek,
      sortMonth,
      mixMonth,
      topMonth,
      topShare: mixMonth > 0 ? topMonth / mixMonth : 0,
    };
  }, [sortValues, mixValues, rows, grades, weeks, active]);

  function setSort(variety: string, week: string, raw: string) {
    setSortValues((prev) => ({
      ...prev,
      [forecastCellKey(week, active, variety)]: parseNumber(raw),
    }));
    setSaved(null);
  }

  function setMix(grade: string, week: string, raw: string) {
    setMixValues((prev) => ({
      ...prev,
      [mixCellKey(week, active, grade)]: parseNumber(raw),
    }));
    setSaved(null);
  }

  async function handleSave() {
    if (changedCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      // По неделям: одна неделя — один вызов, чтобы серверная проверка недели
      // оставалась простой и однозначной.
      const byWeek = new Map<string, typeof changedVarieties>();
      for (const item of changedVarieties) {
        const list = byWeek.get(item.week) ?? [];
        list.push(item);
        byWeek.set(item.week, list);
      }
      for (const [week, items] of byWeek) {
        await saveForecastAction(
          week,
          items.map((i) => ({
            period: week,
            flowerType: i.flowerType,
            variety: i.variety,
            targetStems: i.stems,
          }))
        );
      }

      const mixByWeek = new Map<string, typeof changedMix>();
      for (const item of changedMix) {
        const list = mixByWeek.get(item.week) ?? [];
        list.push(item);
        mixByWeek.set(item.week, list);
      }
      for (const [week, items] of mixByWeek) {
        await saveMixAction(
          week,
          items.map((i) => ({
            period: week,
            flowerType: i.flowerType,
            grade: i.grade,
            targetStems: i.stems,
          }))
        );
      }

      setSaved(`Сохранено ячеек: ${changedCount}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить прогноз");
    } finally {
      setSaving(false);
    }
  }

  if (flowerTypes.length === 0) {
    return (
      <div className="card text-sm text-ink-secondary">
        Вам не назначено производство. Попросите администратора заполнить колонку <b>Farm</b> в
        строке с вашей почтой на вкладке <b>Users</b> Google-таблицы.
      </div>
    );
  }

  const cellInput = (value: number, onChange: (raw: string) => void, label: string) => (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      disabled={saving}
      value={value ? value.toLocaleString("ru-RU") : ""}
      placeholder="—"
      onFocus={(e) => e.target.select()}
      onChange={(e) => onChange(e.target.value)}
      className="input !px-2 !py-1 w-24 text-right tabular-nums disabled:opacity-60"
    />
  );

  return (
    <div className="space-y-5">
      {flowerTypes.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {flowerTypes.map((flowerType) => (
            <button
              key={flowerType}
              type="button"
              onClick={() => setActive(flowerType)}
              className={clsx(
                "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                flowerType === active
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane"
              )}
            >
              {FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType}
            </button>
          ))}
        </div>
      )}

      {/* --- Сорта --- */}
      <div>
        <h2 className="font-medium mb-1">Сколько даст каждый сорт</h2>
        <p className="text-sm text-ink-secondary mb-3">
          Строки — сорта, колонки — недели, в ячейках количество стеблей к срезу.
        </p>
        <div className="card !p-0 overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-3 font-medium sticky left-0 bg-surface z-10 min-w-[12rem]">
                  Сорт
                </th>
                {weeks.map((week) => (
                  <th key={week.code} className="px-2 py-3 font-medium text-center whitespace-nowrap">
                    Неделя {week.index}
                    <div className="text-xs font-normal text-ink-muted">{week.shortLabel}</div>
                  </th>
                ))}
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Итого</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((variety) => {
                const rowTotal = weeks.reduce(
                  (s, w) => s + (sortValues[forecastCellKey(w.code, active, variety)] ?? 0),
                  0
                );
                return (
                  <tr key={variety} className="border-b border-line-hairline last:border-0">
                    <td
                      className={clsx(
                        "px-4 py-1.5 sticky left-0 bg-surface z-10",
                        rowTotal > 0 ? "font-medium" : "text-ink-secondary"
                      )}
                    >
                      {variety}
                    </td>
                    {weeks.map((week) => (
                      <td key={week.code} className="px-1 py-1.5">
                        {cellInput(
                          sortValues[forecastCellKey(week.code, active, variety)] ?? 0,
                          (raw) => setSort(variety, week.code, raw),
                          `${variety}, неделя ${week.index}`
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">
                      {rowTotal ? rowTotal.toLocaleString("ru-RU") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-plane">
                <td className="px-4 py-3 font-medium sticky left-0 bg-surface-plane z-10">
                  Итого по сортам
                </td>
                {weeks.map((week) => (
                  <td
                    key={week.code}
                    className="px-2 py-3 text-right font-semibold tabular-nums whitespace-nowrap"
                  >
                    {totals.sortByWeek[week.code]
                      ? totals.sortByWeek[week.code].toLocaleString("ru-RU")
                      : "—"}
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap">
                  {totals.sortMonth.toLocaleString("ru-RU")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* --- Ростовка --- */}
      <div>
        <h2 className="font-medium mb-1">Ростовка — на весь цветок</h2>
        <p className="text-sm text-ink-secondary mb-3">
          Как распределится весь урожай {FLOWER_TYPE_LABELS_PLURAL[active]?.toLowerCase()} по
          длинам. Не по сортам: это цифры по цветку в целом. Из них считается выход высшей
          категории — {topGradeHint(active)}.
        </p>
        <div className="card !p-0 overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-3 font-medium sticky left-0 bg-surface z-10 min-w-[12rem]">
                  {GRADE_LABELS[active] ?? "Длина"}
                </th>
                {weeks.map((week) => (
                  <th key={week.code} className="px-2 py-3 font-medium text-center whitespace-nowrap">
                    Неделя {week.index}
                    <div className="text-xs font-normal text-ink-muted">{week.shortLabel}</div>
                  </th>
                ))}
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Итого</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((grade) => {
                const rowTotal = weeks.reduce(
                  (s, w) => s + (mixValues[mixCellKey(w.code, active, grade)] ?? 0),
                  0
                );
                const top = isTopGrade(active, grade);
                return (
                  <tr key={grade} className="border-b border-line-hairline last:border-0">
                    <td
                      className={clsx(
                        "px-4 py-1.5 sticky left-0 bg-surface z-10",
                        top ? "font-medium text-accent" : "text-ink-secondary"
                      )}
                      title={top ? "Входит в высшую категорию выхода" : undefined}
                    >
                      {formatGrade(grade)}
                    </td>
                    {weeks.map((week) => (
                      <td key={week.code} className="px-1 py-1.5">
                        {cellInput(
                          mixValues[mixCellKey(week.code, active, grade)] ?? 0,
                          (raw) => setMix(grade, week.code, raw),
                          `${formatGrade(grade)}, неделя ${week.index}`
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">
                      {rowTotal ? rowTotal.toLocaleString("ru-RU") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-hairline">
                <td className="px-4 py-2 text-accent sticky left-0 bg-surface z-10">
                  в т. ч. высшая
                </td>
                {weeks.map((week) => (
                  <td
                    key={week.code}
                    className="px-2 py-2 text-right tabular-nums text-accent whitespace-nowrap"
                  >
                    {totals.topByWeek[week.code]
                      ? totals.topByWeek[week.code].toLocaleString("ru-RU")
                      : "—"}
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-medium tabular-nums text-accent whitespace-nowrap">
                  {totals.topMonth ? totals.topMonth.toLocaleString("ru-RU") : "—"}
                </td>
              </tr>
              <tr className="bg-surface-plane">
                <td className="px-4 py-3 font-medium sticky left-0 bg-surface-plane z-10">
                  Итого по ростовке
                </td>
                {weeks.map((week) => (
                  <td
                    key={week.code}
                    className="px-2 py-3 text-right font-semibold tabular-nums whitespace-nowrap"
                  >
                    {totals.mixByWeek[week.code]
                      ? totals.mixByWeek[week.code].toLocaleString("ru-RU")
                      : "—"}
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap">
                  {totals.mixMonth.toLocaleString("ru-RU")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card !py-3">
          <div className="label !mb-0.5">Всего за месяц</div>
          <div className="text-lg font-semibold tabular-nums">
            {totals.sortMonth.toLocaleString("ru-RU")}{" "}
            <span className="text-sm font-normal">шт</span>
          </div>
          <div className="text-xs text-ink-muted mt-0.5">по сортам</div>
        </div>
        <div className="card !py-3">
          <div className="label !mb-0.5">Высшая категория</div>
          <div className="text-lg font-semibold tabular-nums">
            {totals.topMonth.toLocaleString("ru-RU")} <span className="text-sm font-normal">шт</span>
          </div>
          <div className="text-xs text-ink-muted mt-0.5">из ростовки</div>
        </div>
        <div className="card !py-3">
          <div className="label !mb-0.5">Выход высшей</div>
          <div className="text-lg font-semibold tabular-nums">
            {totals.mixMonth > 0
              ? `${(totals.topShare * 100).toFixed(1).replace(".", ",")} %`
              : "—"}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">высшая — {topGradeHint(active)}</div>
        </div>
      </div>

      {/* Сверка. Это подсказка, а не запрет: прогноз есть прогноз, и мешать
          сохранять из-за расхождения было бы вредно. Но молчать о нём — тоже. */}
      <ReconcileNote
        weeks={weeks}
        sortByWeek={totals.sortByWeek}
        mixByWeek={totals.mixByWeek}
        sortMonth={totals.sortMonth}
        mixMonth={totals.mixMonth}
      />

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {saved && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{saved}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || changedCount === 0}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? "Сохраняю…" : `Сохранить прогноз на ${periodLabel(month)}`}
        </button>
        <span className="text-sm text-ink-muted">
          {changedCount === 0 ? "Изменений нет" : `Изменено ячеек: ${changedCount}`}
        </span>
      </div>
    </div>
  );
}

/** Показывает, сходятся ли сумма по сортам и сумма по ростовке. */
function ReconcileNote({
  weeks,
  sortByWeek,
  mixByWeek,
  sortMonth,
  mixMonth,
}: {
  weeks: PlanWeek[];
  sortByWeek: Record<string, number>;
  mixByWeek: Record<string, number>;
  sortMonth: number;
  mixMonth: number;
}) {
  if (sortMonth === 0 && mixMonth === 0) return null;

  const off = weeks.filter((w) => {
    const a = sortByWeek[w.code] ?? 0;
    const b = mixByWeek[w.code] ?? 0;
    if (a === 0 && b === 0) return false;
    return a !== b;
  });

  if (off.length === 0) {
    return (
      <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">
        Сорта и ростовка сходятся во всех неделях.
      </div>
    );
  }

  return (
    <div className="text-sm bg-status-warning/10 border border-status-warning/30 rounded-lg px-3 py-2 space-y-1">
      <div className="font-medium">Сорта и ростовка расходятся</div>
      <div className="text-ink-secondary">
        Это один и тот же урожай, посчитанный с двух сторон, — суммы должны совпадать. Сохранить
        можно и так, но лучше проверить.
      </div>
      <ul className="text-ink-secondary">
        {off.map((w) => {
          const a = sortByWeek[w.code] ?? 0;
          const b = mixByWeek[w.code] ?? 0;
          return (
            <li key={w.code} className="tabular-nums">
              Неделя {w.index} ({w.shortLabel}): по сортам {a.toLocaleString("ru-RU")}, по ростовке{" "}
              {b.toLocaleString("ru-RU")} — разница{" "}
              {Math.abs(a - b).toLocaleString("ru-RU")}
            </li>
          );
        })}
        {sortMonth !== mixMonth && (
          <li className="tabular-nums font-medium">
            За месяц: {sortMonth.toLocaleString("ru-RU")} против {mixMonth.toLocaleString("ru-RU")}
          </li>
        )}
      </ul>
    </div>
  );
}
