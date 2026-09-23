import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getShipmentPlansForMonth, shipmentPlanKey } from "@/lib/repo/shipmentPlans";
import { getForecastForMonth } from "@/lib/repo/harvestForecast";
import { getMixForMonth } from "@/lib/repo/harvestMix";
import {
  FLOWER_TYPE_LABELS_PLURAL,
  ROLES,
  SHIPMENT_DIRECTIONS,
  periodLabel,
  weekOfDate,
  weeksOfMonth,
} from "@/lib/constants";
import { buildFlowerBalance, type DirectionPlan } from "@/lib/planBalance";
import { FLOWER_ORDER } from "@/lib/planOverview";
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import Hint from "@/components/Hint";
import HarvestWeeks, { type HarvestFlowerRow } from "@/components/HarvestWeeks";
import PlanBalanceBoard, { type BalanceInput } from "@/components/PlanBalanceBoard";
import { plansTabsFor } from "../tabs";
import { monthFrom, prefetchPlanTabs } from "../data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Планы → Срезка»: хватит ли прогноза агронома на план отгрузок — весь месяц
 * одной картинкой (`HarvestWeeks`), неделя за неделей по каждому цветку.
 *
 * Раньше страница начиналась с распределения остатка по направлениям — то есть
 * с ответа, когда вопрос ещё не задан. Распределение осталось (`PlanBalanceBoard`),
 * но ниже и свёрнутым: к нему идут, когда картинка уже показала, где не сходится.
 */
export default async function BalancePage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) redirect("/");

  const month = monthFrom(searchParams.period);
  const weeks = weeksOfMonth(month);

  await prefetchPlanTabs();
  const [plans, forecast, mix] = await Promise.all([
    getShipmentPlansForMonth(month),
    getForecastForMonth(month),
    getMixForMonth(month),
  ]);

  // По записи на каждую пару «цветок + неделя»: баланс считается понедельно,
  // месяц получается суммой.
  const inputs: BalanceInput[] = [];
  for (const flowerType of FLOWER_ORDER) {
    for (const week of weeks) {
      const planByDirection: Record<string, DirectionPlan> = {};
      for (const direction of SHIPMENT_DIRECTIONS) {
        const row = plans.get(shipmentPlanKey(week.code, direction, flowerType));
        planByDirection[direction] = {
          direction,
          stems: row?.targetStems ?? 0,
          amount: row?.targetAmount ?? 0,
        };
      }

      // Ростовка — для выхода высшей категории, сорта — для общего итога.
      const forecastByGrade: Record<string, number> = {};
      for (const row of mix.values()) {
        if (row.flowerType !== flowerType || row.period !== week.code) continue;
        forecastByGrade[row.grade] = (forecastByGrade[row.grade] ?? 0) + row.targetStems;
      }

      let varietyStems = 0;
      for (const row of forecast.values()) {
        if (row.flowerType !== flowerType || row.period !== week.code) continue;
        varietyStems += row.targetStems;
      }

      inputs.push({ flowerType, week: week.code, forecastByGrade, varietyStems, planByDirection });
    }
  }

  // Картинка считается той же функцией, что и распределение ниже: два разных
  // «остатка» на одной странице читались бы как ошибка.
  const rows: HarvestFlowerRow[] = FLOWER_ORDER.map((flowerType) => ({
    flowerType,
    label: FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType,
    weeks: weeks.map((w) => {
      const input = inputs.find((i) => i.flowerType === flowerType && i.week === w.code)!;
      const b = buildFlowerBalance(flowerType, input.forecastByGrade, input.planByDirection, input.varietyStems);
      return {
        code: w.code,
        index: w.index,
        label: w.shortLabel,
        forecast: b.forecastStems,
        planned: b.plannedStems,
        top: b.forecastTopStems,
      };
    }),
  }));

  const hasForecast = rows.some((r) => r.weeks.some((w) => w.forecast > 0));
  const hasPlan = rows.some((r) => r.weeks.some((w) => w.planned > 0));
  const shortWeeks = rows.flatMap((r) =>
    r.weeks
      .filter((w) => w.forecast > 0 && w.planned > w.forecast * 1.03)
      .map((w) => ({ label: r.label, week: w.index, missing: w.planned - w.forecast }))
  );
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Планы</h1>

      <SectionTabs tabs={plansTabsFor(role, month)} />

      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker period={month} />
        <span className="text-sm text-ink-secondary">
          Хватит ли срезки на план отгрузок
          <Hint>
            Срезка — прогноз агронома по сортам (если сорта не заполнены — по ростовке). План — сумма
            плана отгрузок по всем направлениям. Неделя «сходится», если разница не больше 3 %.
          </Hint>
        </span>
      </div>

      {!hasForecast && (
        <div className="card border-[#d9b25c] text-sm">
          <div className="font-medium">Прогноза срезки на {periodLabel(month).toLowerCase()} ещё нет</div>
          <div className="text-ink-secondary mt-0.5">
            Его загружает агроном файлом. Пока прогноза нет, не видно, хватит ли цветка на план.
            {role === ROLES.ADMIN && (
              <>
                {" "}
                <Link href={`/forecast?period=${month}`} className="text-accent hover:underline">
                  Открыть прогноз срезки
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {hasForecast && !hasPlan && (
        <div className="card border-[#d9b25c] text-sm">
          <div className="font-medium">План отгрузок на месяц не поставлен</div>
          <div className="text-ink-secondary mt-0.5">
            Вся срезка сейчас «без плана».{" "}
            <Link href={`/plans/shipments?period=${month}`} className="text-accent hover:underline">
              Поставить план
            </Link>
          </div>
        </div>
      )}

      {shortWeeks.length > 0 && (
        <div className="card border-status-critical/40 bg-status-critical/5 text-sm">
          <div className="font-medium text-status-critical">Срезки не хватит на план</div>
          <ul className="mt-1 space-y-0.5 text-ink-secondary">
            {shortWeeks.map((s) => (
              <li key={`${s.label}-${s.week}`}>
                {s.label}, неделя {s.week}: не хватит {nf(s.missing)} шт
              </li>
            ))}
          </ul>
        </div>
      )}

      {(hasForecast || hasPlan) && (
        <HarvestWeeks
          rows={rows}
          currentWeek={weeks.some((w) => w.code === weekOfDate(new Date())) ? weekOfDate(new Date()) : undefined}
        />
      )}

      {(hasForecast || hasPlan) && (
        <details className="card group">
          <summary className="cursor-pointer select-none font-medium list-none flex items-center justify-between gap-2">
            <span>Разложить остаток или ужать план по направлениям</span>
            <span className="text-ink-muted text-sm group-open:hidden">открыть</span>
            <span className="text-ink-muted text-sm hidden group-open:inline">свернуть</span>
          </summary>
          <div className="mt-4">
            <PlanBalanceBoard
              key={month}
              month={month}
              weeks={weeks}
              flowerTypes={FLOWER_ORDER}
              inputs={inputs}
            />
          </div>
        </details>
      )}
    </div>
  );
}
