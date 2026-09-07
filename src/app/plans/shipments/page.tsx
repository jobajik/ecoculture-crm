import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getShipmentPlansForPeriod, shipmentPlanKey } from "@/lib/repo/shipmentPlans";
import {
  FLOWER_TYPES,
  ROLES,
  SHIPMENT_DIRECTIONS,
  isValidPeriod,
  periodOf,
} from "@/lib/constants";
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import ShipmentPlansForm, { type ShipmentPlanCell } from "@/components/ShipmentPlansForm";
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

  const period =
    searchParams.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());

  const saved = await getShipmentPlansForPeriod(period);

  const initial: Record<string, ShipmentPlanCell> = {};
  for (const direction of SHIPMENT_DIRECTIONS) {
    for (const flowerType of FLOWER_ORDER) {
      const row = saved.get(shipmentPlanKey(period, direction, flowerType));
      initial[`${direction}|${flowerType}`] = {
        stems: row?.targetStems ?? 0,
        amount: row?.targetAmount ?? 0,
      };
    }
  }

  const filled = Array.from(saved.values()).filter((r) => r.targetStems || r.targetAmount).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Планы</h1>
        <p className="text-sm text-ink-secondary">
          Сколько планируется отгрузить в каждое направление за месяц — в стеблях и в деньгах.
          План ставится по каждому цветку отдельно: так его можно сопоставить с прогнозом срезки
          агрономов и заранее увидеть, чего не хватит.
        </p>
      </div>

      <SectionTabs tabs={plansTabsFor(role)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={period} />
        <p className="text-sm text-ink-muted">
          {filled > 0 ? `Заполнено строк: ${filled}` : "Месяц ещё не заполнен"}
        </p>
      </div>

      <ShipmentPlansForm
        key={period}
        period={period}
        flowerTypes={FLOWER_ORDER as unknown as string[]}
        initial={initial}
      />
    </div>
  );
}
