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
} from "@/lib/constants";
import {
  buildFlowerBalance,
  distributeSurplus,
  targetsFor,
  trimToForecast,
  type DirectionPlan,
  type DistributeMode,
} from "@/lib/planBalance";

export interface BalanceInput {
  flowerType: string;
  /** Прогноз срезки: градация → стебли. */
  forecastByGrade: Record<string, number>;
  /** План отгрузок: направление → стебли и сумма. */
  planByDirection: Record<string, DirectionPlan>;
}

function fmt(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

/**
 * Баланс: сколько обещают срезать против того, сколько собираются отгрузить,
 * и что делать с расхождением.
 *
 * Ключевое решение — предпросмотр. Кнопка «распределить» ничего не пишет в
 * таблицу: она показывает колонку «станет» рядом с колонкой «сейчас», и только
 * отдельное «Сохранить» отправляет это в план. Распределение затрагивает сразу
 * девять строк, и увидеть их до записи важнее, чем сэкономить один клик.
 */
export default function PlanBalanceBoard({
  period,
  inputs,
}: {
  period: string;
  inputs: BalanceInput[];
}) {
  const router = useRouter();
  const [active, setActive] = useState(inputs[0]?.flowerType ?? "");
  const [mode, setMode] = useState<DistributeMode>("proportional");
  const [scope, setScope] = useState<string | null>(null);
  /** Предложенный план по цветку — пока не сохранён. */
  const [draft, setDraft] = useState<Record<string, Record<string, DirectionPlan>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [seenPeriod, setSeenPeriod] = useState(period);
  if (seenPeriod !== period) {
    setSeenPeriod(period);
    setDraft({});
    setSaved(null);
    setError(null);
  }

  const current = inputs.find((i) => i.flowerType === active);

  const balances = useMemo(
    () =>
      inputs.map((i) =>
        buildFlowerBalance(i.flowerType, i.forecastByGrade, i.planByDirection)
      ),
    [inputs]
  );

  const balance = balances.find((b) => b.flowerType === active);
  const activeDraft = draft[active];

  /** Баланс после предложенного распределения — чтобы показать, что получится. */
  const draftBalance = useMemo(() => {
    if (!current || !activeDraft) return null;
    return buildFlowerBalance(current.flowerType, current.forecastByGrade, activeDraft);
  }, [current, activeDraft]);

  if (inputs.length === 0 || !current || !balance) {
    return <div className="card text-sm text-ink-secondary">Нет данных за этот месяц.</div>;
  }

  function propose(next: Record<string, DirectionPlan>) {
    setDraft((prev) => ({ ...prev, [active]: next }));
    setSaved(null);
    setError(null);
  }

  function handleDistribute() {
    if (!balance || balance.diff <= 0) return;
    const base = activeDraft ?? current!.planByDirection;
    const targets = targetsFor(scope);
    const { next } = distributeSurplus(base, balance.diff - draftAdded(), targets, mode);
    propose(next);
  }

  /** Сколько уже добавлено в черновике — чтобы повторное нажатие не удвоило остаток. */
  function draftAdded(): number {
    if (!activeDraft) return 0;
    const before = SHIPMENT_DIRECTIONS.reduce(
      (s, d) => s + (current!.planByDirection[d]?.stems ?? 0),
      0
    );
    const after = SHIPMENT_DIRECTIONS.reduce((s, d) => s + (activeDraft[d]?.stems ?? 0), 0);
    return after - before;
  }

  function handleTrim() {
    if (!balance || balance.diff >= 0) return;
    const { next } = trimToForecast(current!.planByDirection, balance.forecastStems);
    propose(next);
  }

  function handleReset() {
    setDraft((prev) => {
      const copy = { ...prev };
      delete copy[active];
      return copy;
    });
    setSaved(null);
  }

  async function handleSave() {
    if (!activeDraft) return;
    setSaving(true);
    setError(null);
    try {
      const rows = SHIPMENT_DIRECTIONS.filter((d) => {
        const was = current!.planByDirection[d] ?? { direction: d, stems: 0, amount: 0 };
        const now = activeDraft[d] ?? { direction: d, stems: 0, amount: 0 };
        return was.stems !== now.stems || was.amount !== now.amount;
      }).map((d) => ({
        period,
        direction: d,
        flowerType: active,
        targetStems: activeDraft[d]?.stems ?? 0,
        targetAmount: activeDraft[d]?.amount ?? 0,
      }));

      await saveShipmentPlansAction(period, rows);
      setSaved(`План обновлён: строк ${rows.length}`);
      handleReset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить план");
    } finally {
      setSaving(false);
    }
  }

  const shown = draftBalance ?? balance;
  const surplus = shown.diff > 0;
  const deficit = shown.diff < 0;

  return (
    <div className="space-y-4">
      {/* Переключатель цветка со сводкой прямо на кнопке: видно, где беда, не заходя внутрь. */}
      <div className="flex flex-wrap gap-2">
        {balances.map((b) => {
          const isActive = b.flowerType === active;
          const state =
            b.forecastStems === 0 && b.plannedStems === 0
              ? "пусто"
              : b.diff > 0
                ? `остаток ${fmt(b.diff)}`
                : b.diff < 0
                  ? `не хватит ${fmt(-b.diff)}`
                  : "сходится";
          return (
            <button
              key={b.flowerType}
              type="button"
              onClick={() => setActive(b.flowerType)}
              className={clsx(
                "rounded-xl border px-4 py-2.5 text-left transition-colors",
                isActive
                  ? "border-accent bg-accent-soft"
                  : "border-line-hairline bg-surface hover:bg-surface-plane"
              )}
            >
              <div className={clsx("text-sm font-medium", isActive && "text-accent")}>
                {FLOWER_TYPE_LABELS_PLURAL[b.flowerType] ?? b.flowerType}
              </div>
              <div
                className={clsx(
                  "text-xs tabular-nums",
                  b.diff < 0 ? "text-status-critical" : "text-ink-muted"
                )}
              >
                {state}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card !py-3">
          <div className="label !mb-0.5">Прогноз срезки</div>
          <div className="text-lg font-semibold tabular-nums">
            {fmt(shown.forecastStems)} <span className="text-sm font-normal">шт</span>
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            из них высшей {fmt(shown.forecastTopStems)} шт
          </div>
        </div>
        <div className="card !py-3">
          <div className="label !mb-0.5">Запланировано отгрузить</div>
          <div className="text-lg font-semibold tabular-nums">
            {fmt(shown.plannedStems)} <span className="text-sm font-normal">шт</span>
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            на {fmt(shown.plannedAmount)} ₸
          </div>
        </div>
        <div
          className={clsx(
            "card !py-3",
            surplus && "border-status-warning/40 bg-status-warning/5",
            deficit && "border-status-critical/40 bg-status-critical/5"
          )}
        >
          <div className="label !mb-0.5">
            {surplus ? "Остаток без плана" : deficit ? "Не хватит срезки" : "Сходится"}
          </div>
          <div
            className={clsx(
              "text-lg font-semibold tabular-nums",
              deficit && "text-status-critical",
              surplus && "text-status-warning"
            )}
          >
            {shown.diff === 0 ? "0" : `${shown.diff > 0 ? "+" : "−"}${fmt(Math.abs(shown.diff))}`}{" "}
            <span className="text-sm font-normal">шт</span>
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            {surplus
              ? "эти стебли ещё никому не обещаны"
              : deficit
                ? "обещано больше, чем вырастет"
                : "план ровно под прогноз"}
          </div>
        </div>
      </div>

      {/* Управление: появляется только когда есть что делать. */}
      {surplus && (
        <div className="card space-y-3">
          <div>
            <h2 className="font-medium">Куда деть остаток</h2>
            <p className="text-sm text-ink-secondary mt-0.5">
              {fmt(shown.diff)} шт{" "}
              {FLOWER_TYPE_LABELS_PLURAL[active]?.toLowerCase() ?? ""} вырастет сверх того, что уже
              распределено. Разложу по направлениям — цифры покажу до сохранения.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="balance-scope">
                Между кем делить
              </label>
              <select
                id="balance-scope"
                className="input w-56"
                value={scope ?? ""}
                onChange={(e) => setScope(e.target.value || null)}
                disabled={saving}
              >
                <option value="">Все направления</option>
                {DIRECTION_GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="balance-mode">
                Как делить
              </label>
              <select
                id="balance-mode"
                className="input w-72"
                value={mode}
                onChange={(e) => setMode(e.target.value as DistributeMode)}
                disabled={saving}
              >
                <option value="proportional">Пропорционально текущему плану</option>
                <option value="equal">Поровну между направлениями</option>
              </select>
            </div>
            <button onClick={handleDistribute} className="btn-secondary" disabled={saving}>
              Разложить остаток
            </button>
          </div>

          <p className="text-xs text-ink-muted">
            «Пропорционально» сохраняет сложившиеся доли: кто берёт больше, тот больше и получит.
            «Поровну» даст и тем направлениям, где сейчас ноль. Сумма в тенге едет за стеблями по
            цене самого направления; там, где цены ещё нет, берётся средняя по цветку.
          </p>
        </div>
      )}

      {deficit && (
        <div className="card space-y-3">
          <div>
            <h2 className="font-medium">Обещано больше, чем вырастет</h2>
            <p className="text-sm text-ink-secondary mt-0.5">
              Не хватает {fmt(-shown.diff)} шт. Можно ужать план под прогноз — пропорционально по
              всем направлениям, чтобы недостача легла на всех, а не на последних в списке. Или
              оставить как есть и разбираться вручную.
            </p>
          </div>
          <button onClick={handleTrim} className="btn-secondary" disabled={saving}>
            Ужать план под прогноз
          </button>
        </div>
      )}

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Направление</th>
              <th className="px-4 py-3 font-medium text-right">Сейчас, шт</th>
              {activeDraft && <th className="px-4 py-3 font-medium text-right">Станет, шт</th>}
              <th className="px-4 py-3 font-medium text-right">Доля</th>
              <th className="px-4 py-3 font-medium text-right">
                {activeDraft ? "Станет, ₸" : "Сумма, ₸"}
              </th>
            </tr>
          </thead>
          <tbody>
            {DIRECTION_GROUPS.map((group) => {
              const groupNow = group.directions.reduce(
                (s, d) => s + (current.planByDirection[d]?.stems ?? 0),
                0
              );
              const groupNext = activeDraft
                ? group.directions.reduce((s, d) => s + (activeDraft[d]?.stems ?? 0), 0)
                : null;
              const groupShown = groupNext ?? groupNow;
              return (
                <Fragment key={group.key}>
                  <tr className="bg-surface-plane/60">
                    <td className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {group.label}
                    </td>
                    <td className="px-4 pt-3 pb-1 text-right text-xs text-ink-muted tabular-nums">
                      {fmt(groupNow)}
                    </td>
                    {activeDraft && (
                      <td className="px-4 pt-3 pb-1 text-right text-xs font-medium text-accent tabular-nums">
                        {fmt(groupNext ?? 0)}
                      </td>
                    )}
                    <td className="px-4 pt-3 pb-1 text-right text-xs text-ink-muted tabular-nums">
                      {shown.plannedStems > 0
                        ? `${Math.round((groupShown / shown.plannedStems) * 100)} %`
                        : "—"}
                    </td>
                    <td className="px-4 pt-3 pb-1" />
                  </tr>
                  {group.directions.map((direction) => {
                    const now = current.planByDirection[direction]?.stems ?? 0;
                    const next = activeDraft ? (activeDraft[direction]?.stems ?? 0) : null;
                    const amount = activeDraft
                      ? (activeDraft[direction]?.amount ?? 0)
                      : (current.planByDirection[direction]?.amount ?? 0);
                    const delta = next === null ? 0 : next - now;
                    return (
                      <tr key={direction} className="border-b border-line-hairline last:border-0">
                        <td className="px-4 py-2 pl-6">{direction}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                          {now ? fmt(now) : "—"}
                        </td>
                        {activeDraft && (
                          <td className="px-4 py-2 text-right tabular-nums font-medium">
                            {next ? fmt(next) : "—"}
                            {delta !== 0 && (
                              <span
                                className={clsx(
                                  "ml-2 text-xs",
                                  delta > 0 ? "text-status-good" : "text-status-critical"
                                )}
                              >
                                {delta > 0 ? "+" : "−"}
                                {fmt(Math.abs(delta))}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                          {shown.plannedStems > 0
                            ? `${Math.round(((next ?? now) / shown.plannedStems) * 100)} %`
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {amount ? fmt(amount) : "—"}
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
                Итого · {FLOWER_TYPE_LABELS_PLURAL[active] ?? active}
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  {farmLabel(getFarmFor(active))}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {fmt(balance.plannedStems)}
              </td>
              {activeDraft && (
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-accent">
                  {fmt(shown.plannedStems)}
                </td>
              )}
              <td className="px-4 py-3 text-right text-ink-muted">
                {shown.plannedStems > 0 ? "100 %" : "—"}
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {fmt(shown.plannedAmount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {saved && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{saved}</div>
      )}

      {activeDraft && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? "Сохраняю…" : `Записать в план на ${periodLabel(period)}`}
          </button>
          <button onClick={handleReset} disabled={saving} className="btn-secondary">
            Отменить предложение
          </button>
          <span className="text-sm text-ink-muted">
            Пока ничего не записано — это предпросмотр.
          </span>
        </div>
      )}
    </div>
  );
}
