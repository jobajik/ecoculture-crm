import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getShipmentPlansForMonth, shipmentPlanKey } from "@/lib/repo/shipmentPlans";
import { getForecastForMonth } from "@/lib/repo/harvestForecast";
import { getCurrentPrices } from "@/lib/repo/prices";
import { BASE_VARIETY, priceKey } from "@/lib/priceList";
import {
  FLOWER_TYPES,
  ROLES,
  SHIPMENT_DIRECTIONS,
  getGradesFor,
  isValidPeriod,
  periodOf,
  weeksOfMonth,
} from "@/lib/constants";
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import ShipmentPlanGrid, { type ShipmentPlanCell } from "@/components/ShipmentPlanGrid";
import { planCellKey } from "@/lib/planCell";
import { plansTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Порядок цветков в переключателе — тот же, что везде в системе.
const FLOWER_ORDER = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];

export default async function ShipmentPlansPage({
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
  const [saved, forecastRows, prices] = await Promise.all([
    getShipmentPlansForMonth(month),
    getForecastForMonth(month),
    getCurrentPrices(),
  ]);

  const initial: Record<string, ShipmentPlanCell> = {};
  for (const week of weeks) {
    for (const direction of SHIPMENT_DIRECTIONS) {
      for (const flowerType of FLOWER_ORDER) {
        const row = saved.get(shipmentPlanKey(week.code, direction, flowerType));
        initial[planCellKey(week.code, direction, flowerType)] = {
          stems: row?.targetStems ?? 0,
          amount: row?.targetAmount ?? 0,
        };
      }
    }
  }

  // Прогноз срезки по неделям — чтобы РОП видел, из чего он раздаёт план, не
  // уходя на вкладку «Баланс».
  const forecast: Record<string, Record<string, number>> = {};
  for (const flowerType of FLOWER_ORDER) forecast[flowerType] = {};
  for (const row of forecastRows.values()) {
    if (!forecast[row.flowerType]) continue;
    forecast[row.flowerType][row.period] =
      (forecast[row.flowerType][row.period] ?? 0) + row.targetStems;
  }

  /**
   * Средняя цена стебля по прайсу: среднее по заполненным строкам «Все сорта».
   * Это оценка для суммы плана, а не точная выручка — состав ростовки заранее
   * неизвестен. Поэтому цену видно на странице и её можно поправить руками.
   */
  const averagePrice: Record<string, number> = {};
  for (const flowerType of FLOWER_ORDER) {
    const values = getGradesFor(flowerType)
      .map((grade) => prices.get(priceKey(flowerType, BASE_VARIETY, grade))?.price ?? 0)
      .filter((price) => price > 0);
    averagePrice[flowerType] =
      values.length > 0 ? Math.round(values.reduce((s, p) => s + p, 0) / values.length) : 0;
  }

  const filledWeeks = weeks.filter((w) =>
    Array.from(saved.values()).some((r) => r.period === w.code && r.targetStems > 0)
  ).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Планы</h1>
        <p className="text-sm text-ink-secondary">
          Сколько планируется отгрузить в каждое направление — по неделям, весь месяц на одном
          экране. Сумма считается сама по цене из прайса. План ставится по каждому цветку отдельно:
          так его видно рядом с прогнозом срезки агронома.
        </p>
      </div>

      <SectionTabs tabs={plansTabsFor(role)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={month} />
        <p className="text-sm text-ink-muted">
          {filledWeeks > 0
            ? `Заполнено недель: ${filledWeeks} из ${weeks.length}`
            : "Месяц ещё не заполнен"}
        </p>
      </div>

      <ShipmentPlanGrid
        key={month}
        month={month}
        weeks={weeks}
        flowerTypes={FLOWER_ORDER as unknown as string[]}
        initial={initial}
        prices={averagePrice}
        forecast={forecast}
      />
    </div>
  );
}
