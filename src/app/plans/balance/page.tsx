import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getShipmentPlansForMonth, shipmentPlanKey } from "@/lib/repo/shipmentPlans";
import { getForecastForMonth } from "@/lib/repo/harvestForecast";
import {
  FLOWER_TYPES,
  ROLES,
  SHIPMENT_DIRECTIONS,
  isValidPeriod,
  periodOf,
  weeksOfMonth,
} from "@/lib/constants";
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import PlanBalanceBoard, { type BalanceInput } from "@/components/PlanBalanceBoard";
import type { DirectionPlan } from "@/lib/planBalance";
import { plansTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FLOWER_ORDER = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];

export default async function BalancePage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) redirect("/");

  const month =
    searchParams.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());

  const weeks = weeksOfMonth(month);

  const [plans, forecast] = await Promise.all([
    getShipmentPlansForMonth(month),
    getForecastForMonth(month),
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

      const forecastByGrade: Record<string, number> = {};
      for (const row of forecast.values()) {
        if (row.flowerType !== flowerType || row.period !== week.code) continue;
        forecastByGrade[row.grade] = (forecastByGrade[row.grade] ?? 0) + row.targetStems;
      }

      inputs.push({ flowerType, week: week.code, forecastByGrade, planByDirection });
    }
  }

  const nothingYet = inputs.every(
    (i) =>
      Object.values(i.forecastByGrade).every((v) => !v) &&
      Object.values(i.planByDirection).every((p) => !p.stems && !p.amount)
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Планы</h1>
        <p className="text-sm text-ink-secondary">
          Хватит ли того, что вырастет, на то, что уже обещано клиентам — по каждой неделе. Остаток
          можно разложить по направлениям, нехватку — ужать по всем сразу.
        </p>
      </div>

      <SectionTabs tabs={plansTabsFor(role)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={month} />
      </div>

      {nothingYet ? (
        <div className="card text-sm text-ink-secondary">
          За этот месяц пока нет ни прогноза срезки, ни плана отгрузок. Баланс появится, как только
          агрономы внесут ростовку, а вы — план по направлениям.
        </div>
      ) : (
        <PlanBalanceBoard
          key={month}
          month={month}
          weeks={weeks}
          flowerTypes={FLOWER_ORDER as unknown as string[]}
          inputs={inputs}
        />
      )}
    </div>
  );
}
