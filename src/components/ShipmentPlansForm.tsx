"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { saveShipmentPlansAction } from "@/app/plans/actions";
import {
  DIRECTION_GROUPS,
  FLOWER_TYPE_LABELS_PLURAL,
  SHIPMENT_DIRECTIONS,
  farmLabel,
  getFarmFor,
  periodLabel,
  weekLabel,
  type PlanWeek,
} from "@/lib/constants";
import NumberCell from "./NumberCell";
import WeekTabs from "./WeekTabs";
import { planCellKey } from "@/lib/planCell";

export interface ShipmentPlanCell {
  stems: number;
  amount: number;
}

/**
 * План отгрузок: недели × направления × цветок, стебли и деньги.
 *
 * Три измерения сразу на экран не помещаются, поэтому два из них вынесены в
 * переключатели (неделя и цветок), а в таблице остаются направления. Цифры по
 * остальным неделям и цветкам не пропадают — они видны в подписях на кнопках и
 * в сводке за месяц внизу.
 */
export default function ShipmentPlansForm({
  month,
  weeks,
  flowerTypes,
  initial,
}: {
  month: string;
  weeks: PlanWeek[];
  flowerTypes: string[];
  /** Ключ — «неделя|направление|цветок». */
  initial: Record<string, ShipmentPlanCell>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, ShipmentPlanCell>>(initial);
  const [activeFlower, setActiveFlower] = useState(flowerTypes[0] ?? "");
  const [activeWeek, setActiveWeek] = useState(weeks[0]?.code ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [seenMonth, setSeenMonth] = useState(month);
  if (seenMonth !== month) {
    setSeenMonth(month);
    setValues(initial);
    setActiveWeek(weeks[0]?.code ?? "");
    setSaved(null);
    setError(null);
  }

  function get(week: string, direction: string, flowerType: string): ShipmentPlanCell {
    return values[planCellKey(week, direction, flowerType)] ?? { stems: 0, amount: 0 };
  }

  function update(direction: string, patch: Partial<ShipmentPlanCell>) {
    const key = planCellKey(activeWeek, direction, activeFlower);
    setValues((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { stems: 0, amount: 0 }), ...patch },
    }));
    setSaved(null);
  }

  /** Изменённые ячейки по всем неделям и цветкам сразу. */
  const changed = useMemo(() => {
    const result: {
      week: string;
      direction: string;
      flowerType: string;
      cell: ShipmentPlanCell;
    }[] = [];
    for (const week of weeks) {
      for (const direction of SHIPMENT_DIRECTIONS) {
        for (const flowerType of flowerTypes) {
          const key = planCellKey(week.code, direction, flowerType);
          const now = values[key] ?? { stems: 0, amount: 0 };
          const was = initial[key] ?? { stems: 0, amount: 0 };
          if (now.stems !== was.stems || now.amount !== was.amount) {
            result.push({ week: week.code, direction, flowerType, cell: now });
          }
        }
      }
    }
    return result;
  }, [values, initial, weeks, flowerTypes]);

  /** Итоги: [цветок][неделя] и месячные суммы. */
  const totals = useMemo(() => {
    const byWeek: Record<string, Record<string, ShipmentPlanCell>> = {};
    const byFlowerMonth: Record<string, ShipmentPlanCell> = {};
    for (const flowerType of flowerTypes) {
      byWeek[flowerType] = {};
      let mStems = 0;
      let mAmount = 0;
      for (const week of weeks) {
        let stems = 0;
        let amount = 0;
        for (const direction of SHIPMENT_DIRECTIONS) {
          const cell = get(week.code, direction, flowerType);
          stems += cell.stems;
          amount += cell.amount;
        }
        byWeek[flowerType][week.code] = { stems, amount };
        mStems += stems;
        mAmount += amount;
      }
      byFlowerMonth[flowerType] = { stems: mStems, amount: mAmount };
    }
    return { byWeek, byFlowerMonth };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, weeks, flowerTypes]);

  const monthGrand = useMemo(
    () =>
      Object.values(totals.byFlowerMonth).reduce(
        (acc, t) => ({ stems: acc.stems + t.stems, amount: acc.amount + t.amount }),
        { stems: 0, amount: 0 }
      ),
    [totals]
  );

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Сохраняем по неделям: одна неделя — один вызов, чтобы серверная
      // проверка недели оставалась простой и однозначной.
      const byWeek = new Map<string, typeof changed>();
      for (const item of changed) {
        const list = byWeek.get(item.week) ?? [];
        list.push(item);
        byWeek.set(item.week, list);
      }
      for (const [week, items] of byWeek) {
        await saveShipmentPlansAction(
          week,
          items.map((c) => ({
            period: week,
            direction: c.direction,
            flowerType: c.flowerType,
            targetStems: c.cell.stems,
            targetAmount: c.cell.amount,
          }))
        );
      }
      setSaved(`Сохранено строк: ${changed.length}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  const weekTotals = totals.byWeek[activeFlower]?.[activeWeek] ?? { stems: 0, amount: 0 };
  const monthTotals = totals.byFlowerMonth[activeFlower] ?? { stems: 0, amount: 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {flowerTypes.map((flowerType) => {
          const t = totals.byFlowerMonth[flowerType] ?? { stems: 0, amount: 0 };
          const isActive = flowerType === activeFlower;
          return (
            <button
              key={flowerType}
              type="button"
              onClick={() => setActiveFlower(flowerType)}
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
                {t.stems ? `${t.stems.toLocaleString("ru-RU")} шт за месяц` : "не заполнено"}
              </div>
            </button>
          );
        })}
      </div>

      <WeekTabs
        weeks={weeks}
        active={activeWeek}
        onSelect={setActiveWeek}
        disabled={saving}
        summary={(week) => {
          const t = totals.byWeek[activeFlower]?.[week.code] ?? { stems: 0, amount: 0 };
          return { text: t.stems ? `${t.stems.toLocaleString("ru-RU")} шт` : "пусто" };
        }}
      />

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">
                Направление
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  {weekLabel(activeWeek)}
                </span>
              </th>
              <th className="px-4 py-3 font-medium w-48">Отгрузить</th>
              <th className="px-4 py-3 font-medium w-48">На сумму</th>
            </tr>
          </thead>
          <tbody>
            {DIRECTION_GROUPS.map((group) => {
              const groupTotals = group.directions.reduce(
                (acc, direction) => {
                  const cell = get(activeWeek, direction, activeFlower);
                  return { stems: acc.stems + cell.stems, amount: acc.amount + cell.amount };
                },
                { stems: 0, amount: 0 }
              );
              return (
                <Fragment key={group.key}>
                  <tr className="bg-surface-plane/60">
                    <td className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {group.label}
                    </td>
                    <td className="px-4 pt-3 pb-1 text-right text-xs text-ink-muted tabular-nums">
                      {groupTotals.stems ? `${groupTotals.stems.toLocaleString("ru-RU")} шт` : ""}
                    </td>
                    <td className="px-4 pt-3 pb-1 text-right text-xs text-ink-muted tabular-nums">
                      {groupTotals.amount ? `${groupTotals.amount.toLocaleString("ru-RU")} ₸` : ""}
                    </td>
                  </tr>
                  {group.directions.map((direction) => {
                    const cell = get(activeWeek, direction, activeFlower);
                    return (
                      <tr key={direction} className="border-b border-line-hairline last:border-0">
                        <td className="px-4 py-2 pl-6 font-medium">{direction}</td>
                        <td className="px-4 py-2">
                          <NumberCell
                            value={cell.stems}
                            onChange={(v) => update(direction, { stems: v })}
                            disabled={saving}
                            suffix="шт"
                            ariaLabel={`${direction}, стеблей`}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <NumberCell
                            value={cell.amount}
                            onChange={(v) => update(direction, { amount: v })}
                            disabled={saving}
                            suffix="₸"
                            ariaLabel={`${direction}, сумма`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane">
              <td className="px-4 py-3 font-medium">
                Итого за неделю · {FLOWER_TYPE_LABELS_PLURAL[activeFlower] ?? activeFlower}
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  {farmLabel(getFarmFor(activeFlower))}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {weekTotals.stems.toLocaleString("ru-RU")} шт
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {weekTotals.amount.toLocaleString("ru-RU")} ₸
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Сводка за месяц: недели в строках. Ради неё всё и затевалось —
          видно и разбивку, и что сумма недель складывается в месяц. */}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">
                Месяц по неделям · {FLOWER_TYPE_LABELS_PLURAL[activeFlower] ?? activeFlower}
              </th>
              <th className="px-4 py-3 font-medium text-right">Стеблей</th>
              <th className="px-4 py-3 font-medium text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              const t = totals.byWeek[activeFlower]?.[week.code] ?? { stems: 0, amount: 0 };
              return (
                <tr
                  key={week.code}
                  className={clsx(
                    "border-b border-line-hairline last:border-0 cursor-pointer hover:bg-surface-plane",
                    week.code === activeWeek && "bg-accent-soft/40"
                  )}
                  onClick={() => setActiveWeek(week.code)}
                >
                  <td className="px-4 py-2">
                    Неделя {week.index}
                    <span className="ml-2 text-xs text-ink-muted">{week.label}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {t.stems ? t.stems.toLocaleString("ru-RU") : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {t.amount ? t.amount.toLocaleString("ru-RU") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane">
              <td className="px-4 py-3 font-medium capitalize">{periodLabel(month)}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {monthTotals.stems.toLocaleString("ru-RU")} шт
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {monthTotals.amount.toLocaleString("ru-RU")} ₸
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 !py-3">
        <span className="text-sm text-ink-secondary">Всего по всем цветкам за месяц</span>
        <span className="font-semibold tabular-nums">
          {monthGrand.stems.toLocaleString("ru-RU")} шт ·{" "}
          {monthGrand.amount.toLocaleString("ru-RU")} ₸
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
          {saving ? "Сохраняю…" : `Сохранить план на ${periodLabel(month)}`}
        </button>
        <span className="text-sm text-ink-muted">
          {changed.length === 0
            ? "Изменений нет"
            : `Изменено строк: ${changed.length} (по всем неделям и цветкам)`}
        </span>
      </div>
    </div>
  );
}
