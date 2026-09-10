"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { savePricesAction } from "@/app/prices/actions";
import {
  FLOWER_TYPE_LABELS_PLURAL,
  GRADE_LABELS,
  formatGrade,
  getGradesFor,
} from "@/lib/constants";
import { BASE_VARIETY, BASE_VARIETY_LABEL, priceKey } from "@/lib/priceList";
import { parseNumber } from "./NumberCell";
import MoreToggle from "./MoreToggle";

/**
 * Прайс-лист: строка «Все сорта» и, по желанию, отдельные сорта.
 *
 * Строка «Все сорта» открыта всегда и стоит первой — в ней вся суть: цена по
 * длине. Сорта спрятаны под кнопку, потому что их девятнадцать, а отличается
 * ценой обычно два-три, и разворачивать на весь экран таблицу из трёхсот пустых
 * ячеек значит гарантированно её не заполнить.
 *
 * Пустая ячейка сорта — не ноль, а «как у всех»: в подсказке видно, какая цена
 * подставится. Ноль пишется отдельно и означает «цены нет».
 */
export default function PriceBoard({
  flowerTypes,
  varieties,
  initial,
  canEdit,
  kind = "",
}: {
  flowerTypes: string[];
  varieties: Record<string, string[]>;
  /** Ключ — «цветок|сорт|градация», пустой сорт = строка «Все сорта». */
  initial: Record<string, number>;
  canEdit: boolean;
  /** Какой прайс правим: пусто — клиентский, «retail» — внутренний. */
  kind?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const changed = useMemo(() => {
    const out: { flowerType: string; variety: string; grade: string; price: number }[] = [];
    const keys = new Set([...Object.keys(values), ...Object.keys(initial)]);
    for (const key of keys) {
      const now = values[key] ?? 0;
      if (now === (initial[key] ?? 0)) continue;
      const [flowerType, variety, grade] = key.split("|");
      out.push({ flowerType, variety, grade, price: now });
    }
    return out;
  }, [values, initial]);

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await savePricesAction(changed, kind);
      setSaved(`Сохранено цен: ${changed.length}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить прайс");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {flowerTypes.map((flowerType) => (
        <FlowerPrices
          key={flowerType}
          flowerType={flowerType}
          varieties={varieties[flowerType] ?? []}
          values={values}
          onChange={(key, price) => {
            setValues((prev) => ({ ...prev, [key]: price }));
            setSaved(null);
          }}
          canEdit={canEdit}
        />
      ))}

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {saved && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{saved}</div>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || changed.length === 0}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? "Сохраняю…" : "Сохранить прайс"}
          </button>
          <span className="text-sm text-ink-muted">
            {changed.length === 0 ? "Изменений нет" : `Изменено цен: ${changed.length}`}
          </span>
        </div>
      )}
    </div>
  );
}

function FlowerPrices({
  flowerType,
  varieties,
  values,
  onChange,
  canEdit,
}: {
  flowerType: string;
  varieties: string[];
  values: Record<string, number>;
  onChange: (key: string, price: number) => void;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const grades = getGradesFor(flowerType);

  /** Сколько сортов уже имеют собственную цену — их прячем только вместе со всеми. */
  const withOwn = varieties.filter((v) =>
    grades.some((g) => (values[priceKey(flowerType, v, g)] ?? 0) > 0)
  );
  const shownVarieties = open ? varieties : withOwn;
  const hidden = varieties.length - shownVarieties.length;

  const cell = (variety: string, grade: string, base?: number) => {
    const key = priceKey(flowerType, variety, grade);
    const value = values[key] ?? 0;
    return (
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={!canEdit}
        aria-label={`${variety || BASE_VARIETY_LABEL}, ${formatGrade(grade)}`}
        value={value ? value.toLocaleString("ru-RU") : ""}
        placeholder={base ? base.toLocaleString("ru-RU") : "—"}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(key, parseNumber(e.target.value))}
        className={clsx(
          "input !px-2 !py-1 !min-h-0 !text-sm w-20 text-right tabular-nums",
          "disabled:opacity-70 disabled:bg-surface-plane",
          !value && base ? "placeholder:text-ink-muted/70" : ""
        )}
      />
    );
  };

  return (
    <div>
      <h3 className="font-medium mb-1">
        {FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType}
        <span className="text-sm font-normal text-ink-muted">
          {" "}
          — цена за стебель, ₸ · по колонке «{GRADE_LABELS[flowerType] ?? "Длина"}»
        </span>
      </h3>

      <div className="card !p-0 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium sticky left-0 bg-surface z-10 min-w-[12rem]">
                Сорт
              </th>
              {grades.map((grade) => (
                <th key={grade} className="px-2 py-3 font-medium text-center whitespace-nowrap">
                  {formatGrade(grade)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Основная строка. Её одной хватает, чтобы оценить весь цветок. */}
            <tr className="border-b border-line-hairline bg-accent-soft/40">
              <td className="px-4 py-2 font-medium sticky left-0 bg-accent-soft/40 z-10">
                {BASE_VARIETY_LABEL}
              </td>
              {grades.map((grade) => (
                <td key={grade} className="px-1 py-2">
                  {cell(BASE_VARIETY, grade)}
                </td>
              ))}
            </tr>

            {shownVarieties.map((variety) => (
              <tr key={variety} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-1.5 sticky left-0 bg-surface z-10 text-ink-secondary">
                  {variety}
                </td>
                {grades.map((grade) => (
                  <td key={grade} className="px-1 py-1.5">
                    {cell(variety, grade, values[priceKey(flowerType, BASE_VARIETY, grade)] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <MoreToggle
          expanded={open}
          hidden={hidden}
          onToggle={() => setOpen((v) => !v)}
          what="сортов"
        />
        <span className="text-xs text-ink-muted">
          Пустая ячейка сорта — цена как в строке «{BASE_VARIETY_LABEL}» (она подсказана серым).
        </span>
      </div>
    </div>
  );
}
