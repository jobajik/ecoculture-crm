import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getShipmentPlansForMonth, shipmentPlanKey } from "@/lib/repo/shipmentPlans";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { buildDirectionFact } from "@/lib/direction";
import { getCurrentPrices } from "@/lib/repo/prices";
import { BASE_VARIETY, priceKey } from "@/lib/priceList";
import {
  FLOWER_TYPES,
  ORDER_STATUSES,
  ROLES,
  SHIPMENT_DIRECTIONS,
  getGradesFor,
  weeksOfMonth,
} from "@/lib/constants";
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import ShipmentPlanGrid, { type ShipmentFactCell, type ShipmentPlanCell } from "@/components/ShipmentPlanGrid";
import ShipmentsViewSwitch from "../ShipmentsViewSwitch";
import { forecastByWeek, monthFrom, prefetchPlanTabs } from "../data";
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

  const month = monthFrom(searchParams.period);

  const weeks = weeksOfMonth(month);
  await prefetchPlanTabs();
  const [saved, forecast, prices, orders] = await Promise.all([
    getShipmentPlansForMonth(month),
    forecastByWeek(month),
    getCurrentPrices(),
    listOrdersWithItems(),
  ]);

  // Факт в каждой клетке сетки: заказано и отгружено на эту неделю, это
  // направление и этот цветок — по дате доставки, как и весь план отгрузок
  // (`buildDirectionFact`). Раньше сетка была полями без единой цифры факта.
  const fact: Record<string, ShipmentFactCell> = {};
  for (const flowerType of FLOWER_ORDER) {
    for (const week of weeks) {
      const f = buildDirectionFact({
        orders,
        plans: [],
        from: week.from,
        to: week.to,
        planPeriods: [],
        cancelledStatus: ORDER_STATUSES.CANCELLED,
        flowerType,
      });
      for (const row of f.groups.flatMap((g) => g.rows)) {
        if (row.orderedStems > 0) {
          fact[planCellKey(week.code, row.direction, flowerType)] = {
            ordered: row.orderedStems,
            shipped: row.shippedStems,
          };
        }
      }
    }
  }

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
  const averagePrice: Record<string, number> = {};
  for (const flowerType of FLOWER_ORDER) {
    const values = getGradesFor(flowerType)
      .map((grade) => prices.get(priceKey(flowerType, BASE_VARIETY, grade))?.price ?? 0)
      .filter((price) => price > 0);
    averagePrice[flowerType] =
      values.length > 0 ? Math.round(values.reduce((s, p) => s + p, 0) / values.length) : 0;
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Планы</h1>

      <SectionTabs tabs={plansTabsFor(role, month)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={month} />
        <ShipmentsViewSwitch view="plan" month={month} />
      </div>

      <ShipmentPlanGrid
        key={month}
        month={month}
        weeks={weeks}
        flowerTypes={FLOWER_ORDER as unknown as string[]}
        initial={initial}
        prices={averagePrice}
        forecast={forecast}
        fact={fact}
      />
    </div>
  );
}
