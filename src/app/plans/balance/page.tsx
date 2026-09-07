import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getShipmentPlansForPeriod, shipmentPlanKey } from "@/lib/repo/shipmentPlans";
import { getForecastForPeriod } from "@/lib/repo/harvestForecast";
import {
  FLOWER_TYPES,
  ROLES,
  SHIPMENT_DIRECTIONS,
  isValidPeriod,
  periodOf,
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

  const period =
    searchParams.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());

  const [plans, forecast] = await Promise.all([
    getShipmentPlansForPeriod(period),
    getForecastForPeriod(period),
  ]);

  const inputs: BalanceInput[] = FLOWER_ORDER.map((flowerType) => {
    const planByDirection: Record<string, DirectionPlan> = {};
    for (const direction of SHIPMENT_DIRECTIONS) {
      const row = plans.get(shipmentPlanKey(period, direction, flowerType));
      planByDirection[direction] = {
        direction,
        stems: row?.targetStems ?? 0,
        amount: row?.targetAmount ?? 0,
      };
    }

    const forecastByGrade: Record<string, number> = {};
    for (const row of forecast.values()) {
      if (row.flowerType !== flowerType) continue;
      forecastByGrade[row.grade] = (forecastByGrade[row.grade] ?? 0) + row.targetStems;
    }

    return { flowerType, forecastByGrade, planByDirection };
  });

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
          Хватит ли того, что вырастет, на то, что уже обещано клиентам. Остаток можно разложить по
          направлениям, нехватку — ужать по всем сразу.
        </p>
      </div>

      <SectionTabs tabs={plansTabsFor(role)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={period} />
      </div>

      {nothingYet ? (
        <div className="card text-sm text-ink-secondary">
          За этот месяц пока нет ни прогноза срезки, ни плана отгрузок. Баланс появится, как только
          агрономы внесут ростовку, а вы — план по направлениям.
        </div>
      ) : (
        <PlanBalanceBoard key={period} period={period} inputs={inputs} />
      )}
    </div>
  );
}
