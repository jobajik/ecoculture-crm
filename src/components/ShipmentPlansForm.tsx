"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { saveShipmentPlansAction } from "@/app/plans/actions";
import {
  FLOWER_TYPE_LABELS_PLURAL,
  SHIPMENT_DIRECTIONS,
  farmLabel,
  getFarmFor,
  periodLabel,
} from "@/lib/constants";
import NumberCell from "./NumberCell";

/** Ключ ячейки: направление + цветок. */
function cellKey(direction: string, flowerType: string) {
  return `${direction}|${flowerType}`;
}

export interface ShipmentPlanCell {
  stems: number;
  amount: number;
}

/**
 * План отгрузок: направления × цветок, стебли и деньги.
 *
 * Показываем по одному цветку за раз, а не всё сразу: девять направлений на три
 * цветка в два поля — это 54 поля в одной таблице, в которой невозможно не
 * промахнуться. С переключателем видно девять строк и две колонки, а цифры по
 * остальным цветкам никуда не деваются — они рядом, в счётчиках на кнопках.
 */
export default function ShipmentPlansForm({
  period,
  flowerTypes,
  initial,
}: {
  period: string;
  flowerTypes: string[];
  /** Ключ — «направление|цветок». */
  initial: Record<string, ShipmentPlanCell>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, ShipmentPlanCell>>(initial);
  const [active, setActive] = useState(flowerTypes[0] ?? "");
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

  function get(direction: string, flowerType: string): ShipmentPlanCell {
    return values[cellKey(direction, flowerType)] ?? { stems: 0, amount: 0 };
  }

  function update(direction: string, flowerType: string, patch: Partial<ShipmentPlanCell>) {
    const key = cellKey(direction, flowerType);
    setValues((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { stems: 0, amount: 0 }), ...patch },
    }));
    setSaved(null);
  }

  // Считаем изменённые ячейки по всем цветкам сразу: человек мог переключить
  // вкладку и править дальше — сохраняем всё, что он тронул.
  const changed = useMemo(() => {
    const result: { direction: string; flowerType: string; cell: ShipmentPlanCell }[] = [];
    for (const direction of SHIPMENT_DIRECTIONS) {
      for (const flowerType of flowerTypes) {
        const key = cellKey(direction, flowerType);
        const now = values[key] ?? { stems: 0, amount: 0 };
        const was = initial[key] ?? { stems: 0, amount: 0 };
        if (now.stems !== was.stems || now.amount !== was.amount) {
          result.push({ direction, flowerType, cell: now });
        }
      }
    }
    return result;
  }, [values, initial, flowerTypes]);

  const totalsByFlower = useMemo(() => {
    const map: Record<string, ShipmentPlanCell> = {};
    for (const flowerType of flowerTypes) {
      map[flowerType] = SHIPMENT_DIRECTIONS.reduce(
        (acc, direction) => {
          const cell = values[cellKey(direction, flowerType)] ?? { stems: 0, amount: 0 };
          return { stems: acc.stems + cell.stems, amount: acc.amount + cell.amount };
        },
        { stems: 0, amount: 0 }
      );
    }
    return map;
  }, [values, flowerTypes]);

  const grandTotal = useMemo(
    () =>
      Object.values(totalsByFlower).reduce(
        (acc, t) => ({ stems: acc.stems + t.stems, amount: acc.amount + t.amount }),
        { stems: 0, amount: 0 }
      ),
    [totalsByFlower]
  );

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveShipmentPlansAction(
        period,
        changed.map((c) => ({
          period,
          direction: c.direction,
          flowerType: c.flowerType,
          targetStems: c.cell.stems,
          targetAmount: c.cell.amount,
        }))
      );
      setSaved(`Сохранено строк: ${changed.length}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  const activeTotals = totalsByFlower[active] ?? { stems: 0, amount: 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {flowerTypes.map((flowerType) => {
          const totals = totalsByFlower[flowerType] ?? { stems: 0, amount: 0 };
          const isActive = flowerType === active;
          return (
            <button
              key={flowerType}
              type="button"
              onClick={() => setActive(flowerType)}
              className={clsx(
                "rounded-xl border px-4 py-2.5 text-left transition-colors",
                isActive
                  ? "border-accent bg-accent-soft"
                  : "border-line-hairline bg-surface hover:bg-surface-plane"
              )}
            >
              <div className={clsx("text-sm font-medium", isActive && "text-accent")}>
                {FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType}
              </div>
              <div className="text-xs text-ink-muted tabular-nums">
                {totals.stems ? `${totals.stems.toLocaleString("ru-RU")} шт` : "не заполнено"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Направление</th>
              <th className="px-4 py-3 font-medium w-48">Отгрузить</th>
              <th className="px-4 py-3 font-medium w-48">На сумму</th>
            </tr>
          </thead>
          <tbody>
            {SHIPMENT_DIRECTIONS.map((direction) => {
              const cell = get(direction, active);
              return (
                <tr key={direction} className="border-b border-line-hairline last:border-0">
                  <td className="px-4 py-2 font-medium">{direction}</td>
                  <td className="px-4 py-2">
                    <NumberCell
                      value={cell.stems}
                      onChange={(v) => update(direction, active, { stems: v })}
                      disabled={saving}
                      suffix="шт"
                      ariaLabel={`${direction}, стеблей`}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <NumberCell
                      value={cell.amount}
                      onChange={(v) => update(direction, active, { amount: v })}
                      disabled={saving}
                      suffix="₸"
                      ariaLabel={`${direction}, сумма`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane">
              <td className="px-4 py-3 font-medium">
                Итого · {FLOWER_TYPE_LABELS_PLURAL[active] ?? active}
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  {farmLabel(getFarmFor(active))}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {activeTotals.stems.toLocaleString("ru-RU")} шт
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {activeTotals.amount.toLocaleString("ru-RU")} ₸
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 !py-3">
        <span className="text-sm text-ink-secondary">Всего по всем цветкам за месяц</span>
        <span className="font-semibold tabular-nums">
          {grandTotal.stems.toLocaleString("ru-RU")} шт ·{" "}
          {grandTotal.amount.toLocaleString("ru-RU")} ₸
        </span>
      </div>

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
          disabled={saving || changed.length === 0}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? "Сохраняю…" : `Сохранить план на ${periodLabel(period)}`}
        </button>
        <span className="text-sm text-ink-muted">
          {changed.length === 0
            ? "Изменений нет"
            : `Изменено строк: ${changed.length} (по всем цветкам)`}
        </span>
      </div>
    </div>
  );
}
