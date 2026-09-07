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
import {
  buildFlowerBalance,
  distributeSurplus,
  targetsFor,
  trimToForecast,
  type DirectionPlan,
  type DistributeMode,
} from "@/lib/planBalance";
import WeekTabs from "./WeekTabs";

export interface BalanceInput {
  flowerType: string;
  week: string;
  /** Прогноз срезки за эту неделю: градация → стебли. */
  forecastByGrade: Record<string, number>;
  /** План отгрузок за эту неделю: направление → стебли и сумма. */
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
  month,
  weeks,
  flowerTypes,
  inputs,
}: {
  month: string;
  weeks: PlanWeek[];
  flowerTypes: string[];
  /** По одной записи на цветок и неделю. */
  inputs: BalanceInput[];
}) {
  const router = useRouter();
  const [active, setActive] = useState(flowerTypes[0] ?? "");
  const [activeWeek, setActiveWeek] = useState(weeks[0]?.code ?? "");
  const [mode, setMode] = useState<DistributeMode>("proportional");
  const [scope, setScope] = useState<string | null>(null);
  /** Предложенный план по цветку — пока не сохранён. */
  const [draft, setDraft] = useState<Record<string, Record<string, DirectionPlan>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [seenMonth, setSeenMonth] = useState(month);
  if (seenMonth !== month) {
    setSeenMonth(month);
    setDraft({});
    setActiveWeek(weeks[0]?.code ?? "");
    setSaved(null);
    setError(null);
  }

  const current = inputs.find((i) => i.flowerType === active && i.week === activeWeek);

  /** Баланс каждой пары «цветок + неделя». */
  const balances = useMemo(
    () =>
      inputs.map((i) => ({
        week: i.week,
        ...buildFlowerBalance(i.flowerType, i.forecastByGrade, i.planByDirection),
      })),
    [inputs]
  );

  /** Итог по цветку за месяц — сумма его недель. */
  const monthByFlower = useMemo(() => {
    const map: Record<string, { forecast: number; planned: number; diff: number }> = {};
    for (const flowerType of flowerTypes) {
      const own = balances.filter((b) => b.flowerType === flowerType);
      const forecast = own.reduce((s, b) => s + b.forecastStems, 0);
      const planned = own.reduce((s, b) => s + b.plannedStems, 0);
      map[flowerType] = { forecast, planned, diff: forecast - planned };
    }
    return map;
  }, [balances, flowerTypes]);

  const balance = balances.find((b) => b.flowerType === active && b.week === activeWeek);
  const draftKey = `${active}|${activeWeek}`;
  const activeDraft = draft[draftKey];

  /** Баланс после предложенного распределения — чтобы показать, что получится. */
  const draftBalance = useMemo(() => {
    if (!current || !activeDraft) return null;
    return buildFlowerBalance(current.flowerType, current.forecastByGrade, activeDraft);
  }, [current, activeDraft]);

  if (inputs.length === 0 || !current || !balance) {
    return <div className="card text-sm text-ink-secondary">Нет данных за этот месяц.</div>;
  }

  function propose(next: Record<string, DirectionPlan>) {
    setDraft((prev) => ({ ...prev, [draftKey]: next }));
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
      delete copy[draftKey];
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
        period: activeWeek,
        direction: d,
        flowerType: active,
        targetStems: activeDraft[d]?.stems ?? 0,
        targetAmount: activeDraft[d]?.amount ?? 0,
      }));

      await saveShipmentPlansAction(activeWeek, rows);
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
      {/* Переключатель цветка со сводкой за месяц: видно, где беда, не заходя внутрь. */}
      <div className="flex flex-wrap gap-2">
        {flowerTypes.map((flowerType) => {
          const b = monthByFlower[flowerType] ?? { forecast: 0, planned: 0, diff: 0 };
          const isActive = flowerType === active;
          const state =
            b.forecast === 0 && b.planned === 0
              ? "пусто"
              : b.diff > 0
                ? `остаток ${fmt(b.diff)}`
                : b.diff < 0
                  ? `не хватит ${fmt(-b.diff)}`
                  : "сходится";
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
              <div
                className={clsx(
                  "text-xs tabular-nums",
                  b.diff < 0 ? "text-status-critical" : "text-ink-muted"
                )}
              >
                {state} · за месяц
              </div>
            </button>
          );
        })}
      </div>

      {/* Недели: под каждой — её собственное расхождение. Так сразу видно,
          в какой именно неделе не сходится, а не «где-то в месяце». */}
      <WeekTabs
        weeks={weeks}
        active={activeWeek}
        onSelect={setActiveWeek}
        disabled={saving}
        summary={(week) => {
          const b = balances.find((x) => x.flowerType === active && x.week === week.code);
          if (!b || (b.forecastStems === 0 && b.plannedStems === 0)) return { text: "пусто" };
          if (b.diff === 0) return { text: "сходится" };
          return {
            text: b.diff > 0 ? `остаток ${fmt(b.diff)}` : `не хватит ${fmt(-b.diff)}`,
            warn: b.diff < 0,
          };
        }}
      />

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card !py-3">
          <div className="label !mb-0.5">Прогноз срезки · {weekLabel(activeWeek)}</div>
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
              <th className="px-4 py-3 font-medium">
                Направление
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  {weekLabel(activeWeek)}
                </span>
              </th>
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

      {/* Месяц по неделям: ради этой таблицы понедельное планирование и нужно —
          видно, в какой неделе перекос, и что сумма недель складывается в месяц. */}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">
                Месяц по неделям · {FLOWER_TYPE_LABELS_PLURAL[active] ?? active}
              </th>
              <th className="px-4 py-3 font-medium text-right">Срезка</th>
              <th className="px-4 py-3 font-medium text-right">План отгрузок</th>
              <th className="px-4 py-3 font-medium text-right">Разница</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              const b = balances.find((x) => x.flowerType === active && x.week === week.code);
              const forecast = b?.forecastStems ?? 0;
              const planned = b?.plannedStems ?? 0;
              const diff = forecast - planned;
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
                    {forecast ? fmt(forecast) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {planned ? fmt(planned) : "—"}
                  </td>
                  <td
                    className={clsx(
                      "px-4 py-2 text-right tabular-nums font-medium",
                      diff < 0 && "text-status-critical",
                      diff > 0 && "text-status-warning"
                    )}
                  >
                    {forecast === 0 && planned === 0
                      ? "—"
                      : diff === 0
                        ? "0"
                        : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane">
              <td className="px-4 py-3 font-medium capitalize">{periodLabel(month)}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {fmt(monthByFlower[active]?.forecast ?? 0)}
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {fmt(monthByFlower[active]?.planned ?? 0)}
              </td>
              <td
                className={clsx(
                  "px-4 py-3 text-right font-semibold tabular-nums",
                  (monthByFlower[active]?.diff ?? 0) < 0 && "text-status-critical",
                  (monthByFlower[active]?.diff ?? 0) > 0 && "text-status-warning"
                )}
              >
                {(() => {
                  const d = monthByFlower[active]?.diff ?? 0;
                  return d === 0 ? "0" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`;
                })()}
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
            {saving ? "Сохраняю…" : `Записать в план на ${weekLabel(activeWeek)}`}
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
