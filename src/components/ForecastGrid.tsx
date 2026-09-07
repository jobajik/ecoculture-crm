"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { saveForecastAction } from "@/app/forecast/actions";
import {
  FLOWER_TYPE_LABELS_PLURAL,
  GRADE_LABELS,
  formatGrade,
  getGradesFor,
  isTopGrade,
  periodLabel,
  topGradeHint,
} from "@/lib/constants";
import { parseNumber } from "./NumberCell";
import { forecastCellKey } from "@/lib/forecastCell";

/**
 * Ростовка: сорта по строкам, длины (у хризантемы — категории) по колонкам.
 *
 * Такой вид выбран не случайно. Ростовка — это по смыслу распределение одного
 * сорта по длинам, и агроном думает именно строкой: «Freedom даст столько-то
 * шестидесяток и столько-то восьмидесяток». В виде плоского списка «сорт,
 * длина, количество» эта же мысль разваливается на десять несвязанных строк.
 */
export default function ForecastGrid({
  period,
  flowerTypes,
  varieties,
  initial,
  readOnly,
}: {
  period: string;
  flowerTypes: string[];
  /** Сорта по типам цветка. */
  varieties: Record<string, string[]>;
  /** Ключ — «цветок|сорт|градация». */
  initial: Record<string, number>;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, number>>(initial);
  const [active, setActive] = useState(flowerTypes[0] ?? "");
  const [filter, setFilter] = useState("");
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [seenPeriod, setSeenPeriod] = useState(period);
  if (seenPeriod !== period) {
    setSeenPeriod(period);
    setValues(initial);
    setSaved(null);
    setError(null);
  }

  const grades = getGradesFor(active);
  // useMemo здесь не для скорости: без него `varieties[active] ?? []` создаёт
  // новый массив на каждый набранный символ, и все зависящие от него расчёты
  // пересчитываются вхолостую.
  const allVarieties = useMemo(() => varieties[active] ?? [], [varieties, active]);

  const shownVarieties = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return allVarieties.filter((variety) => {
      if (needle && !variety.toLowerCase().includes(needle)) return false;
      if (onlyFilled) {
        const has = grades.some((g) => (values[forecastCellKey(active, variety, g)] ?? 0) > 0);
        if (!has) return false;
      }
      return true;
    });
  }, [allVarieties, filter, onlyFilled, grades, values, active]);

  const changed = useMemo(() => {
    const result: { flowerType: string; variety: string; grade: string; stems: number }[] = [];
    for (const flowerType of flowerTypes) {
      for (const variety of varieties[flowerType] ?? []) {
        for (const grade of getGradesFor(flowerType)) {
          const key = forecastCellKey(flowerType, variety, grade);
          const now = values[key] ?? 0;
          const was = initial[key] ?? 0;
          if (now !== was) result.push({ flowerType, variety, grade, stems: now });
        }
      }
    }
    return result;
  }, [values, initial, flowerTypes, varieties]);

  /** Итоги по активному цветку: всего и сколько из этого высшей категории. */
  const totals = useMemo(() => {
    let total = 0;
    let top = 0;
    const byGrade: Record<string, number> = {};
    for (const variety of allVarieties) {
      for (const grade of grades) {
        const value = values[forecastCellKey(active, variety, grade)] ?? 0;
        total += value;
        byGrade[grade] = (byGrade[grade] ?? 0) + value;
        if (isTopGrade(active, grade)) top += value;
      }
    }
    return { total, top, byGrade, share: total > 0 ? top / total : 0 };
  }, [values, allVarieties, grades, active]);

  function rowTotal(variety: string): number {
    return grades.reduce((sum, g) => sum + (values[forecastCellKey(active, variety, g)] ?? 0), 0);
  }

  function setCell(variety: string, grade: string, raw: string) {
    const key = forecastCellKey(active, variety, grade);
    setValues((prev) => ({ ...prev, [key]: parseNumber(raw) }));
    setSaved(null);
  }

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveForecastAction(
        period,
        changed.map((c) => ({
          period,
          flowerType: c.flowerType,
          variety: c.variety,
          grade: c.grade,
          targetStems: c.stems,
        }))
      );
      setSaved(`Сохранено позиций: ${changed.length}`);
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

  return (
    <div className="space-y-4">
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

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card !py-3">
          <div className="label !mb-0.5">Всего по прогнозу</div>
          <div className="text-lg font-semibold tabular-nums">
            {totals.total.toLocaleString("ru-RU")} <span className="text-sm font-normal">шт</span>
          </div>
        </div>
        <div className="card !py-3">
          <div className="label !mb-0.5">Высшая категория</div>
          <div className="text-lg font-semibold tabular-nums">
            {totals.top.toLocaleString("ru-RU")} <span className="text-sm font-normal">шт</span>
          </div>
        </div>
        <div className="card !py-3">
          <div className="label !mb-0.5">Выход высшей</div>
          <div className="text-lg font-semibold tabular-nums">
            {totals.total > 0 ? `${(totals.share * 100).toFixed(1).replace(".", ",")} %` : "—"}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">высшая — {topGradeHint(active)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Поиск по сорту"
          className="input max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-ink-secondary select-none">
          <input
            type="checkbox"
            checked={onlyFilled}
            onChange={(e) => setOnlyFilled(e.target.checked)}
          />
          Только заполненные сорта
        </label>
        <span className="text-sm text-ink-muted">
          Показано сортов: {shownVarieties.length} из {allVarieties.length}
        </span>
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium sticky left-0 bg-surface z-10 min-w-[11rem]">
                Сорт
              </th>
              {grades.map((grade) => (
                <th
                  key={grade}
                  className={clsx(
                    "px-2 py-3 font-medium text-center whitespace-nowrap",
                    isTopGrade(active, grade) && "text-accent"
                  )}
                  title={
                    isTopGrade(active, grade)
                      ? "Входит в высшую категорию выхода"
                      : `${GRADE_LABELS[active] ?? "Градация"}`
                  }
                >
                  {formatGrade(grade)}
                </th>
              ))}
              <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Итого</th>
            </tr>
          </thead>
          <tbody>
            {shownVarieties.map((variety) => {
              const total = rowTotal(variety);
              return (
                <tr key={variety} className="border-b border-line-hairline last:border-0">
                  <td
                    className={clsx(
                      "px-4 py-1.5 sticky left-0 z-10",
                      total > 0 ? "bg-surface font-medium" : "bg-surface text-ink-secondary"
                    )}
                  >
                    {variety}
                  </td>
                  {grades.map((grade) => {
                    const value = values[forecastCellKey(active, variety, grade)] ?? 0;
                    return (
                      <td key={grade} className="px-1 py-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          disabled={saving || readOnly}
                          aria-label={`${variety}, ${formatGrade(grade)}`}
                          value={value ? value.toLocaleString("ru-RU") : ""}
                          placeholder="—"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setCell(variety, grade, e.target.value)}
                          className={clsx(
                            "input !px-2 !py-1 w-24 text-right tabular-nums disabled:opacity-60",
                            value > 0 && isTopGrade(active, grade) && "border-accent/40 bg-accent-soft"
                          )}
                        />
                      </td>
                    );
                  })}
                  <td className="px-4 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">
                    {total ? total.toLocaleString("ru-RU") : "—"}
                  </td>
                </tr>
              );
            })}
            {shownVarieties.length === 0 && (
              <tr>
                <td colSpan={grades.length + 2} className="px-4 py-8 text-center text-ink-muted">
                  Ни одного сорта не подошло под фильтр
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane">
              <td className="px-4 py-3 font-medium sticky left-0 bg-surface-plane z-10">
                Итого по длинам
              </td>
              {grades.map((grade) => (
                <td
                  key={grade}
                  className={clsx(
                    "px-2 py-3 text-right font-semibold tabular-nums whitespace-nowrap",
                    isTopGrade(active, grade) && "text-accent"
                  )}
                >
                  {totals.byGrade[grade]
                    ? totals.byGrade[grade].toLocaleString("ru-RU")
                    : "—"}
                </td>
              ))}
              <td className="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap">
                {totals.total.toLocaleString("ru-RU")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-ink-muted">
        Итог по длинам — это и есть ростовка на {periodLabel(period)}. Колонки высшей категории
        подсвечены.
      </p>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {saved && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{saved}</div>
      )}

      {!readOnly && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || changed.length === 0}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? "Сохраняю…" : `Сохранить прогноз на ${periodLabel(period)}`}
          </button>
          <span className="text-sm text-ink-muted">
            {changed.length === 0 ? "Изменений нет" : `Изменено позиций: ${changed.length}`}
          </span>
        </div>
      )}
    </div>
  );
}
