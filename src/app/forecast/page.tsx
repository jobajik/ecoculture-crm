import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getForecastForMonth } from "@/lib/repo/harvestForecast";
import { getMixForMonth } from "@/lib/repo/harvestMix";
import { listVarietiesByType } from "@/lib/repo/varieties";
import {
  FLOWER_TYPES,
  ROLES,
  farmLabel,
  flowerTypesForFarm,
  isValidPeriod,
  periodOf,
  weeksOfMonth,
} from "@/lib/constants";
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import ForecastBoard from "@/components/ForecastBoard";
import { forecastCellKey, mixCellKey } from "@/lib/forecastCell";
import ForecastImportForm from "@/components/ForecastImportForm";
import { plansTabsFor } from "../plans/tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FLOWER_ORDER = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.AGRONOMIST && role !== ROLES.ADMIN) redirect("/");

  // Агроном ведёт прогноз только по своему производству, администратор — по всем.
  const farm = role === ROLES.ADMIN ? null : session?.user?.farm ?? null;
  const allowedTypes = FLOWER_ORDER.filter((t) =>
    (flowerTypesForFarm(farm) as string[]).includes(t)
  ) as string[];

  const month =
    searchParams.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());

  const weeks = weeksOfMonth(month);

  const [varieties, savedVarieties, savedMix] = await Promise.all([
    listVarietiesByType(),
    getForecastForMonth(month, allowedTypes),
    getMixForMonth(month, allowedTypes),
  ]);

  const initialVarieties: Record<string, number> = {};
  for (const row of savedVarieties.values()) {
    initialVarieties[forecastCellKey(row.period, row.flowerType, row.variety)] = row.targetStems;
  }

  const initialMix: Record<string, number> = {};
  for (const row of savedMix.values()) {
    initialMix[mixCellKey(row.period, row.flowerType, row.grade)] = row.targetStems;
  }

  const filledWeeks = weeks.filter(
    (w) =>
      Array.from(savedVarieties.values()).some((r) => r.period === w.code && r.targetStems > 0) ||
      Array.from(savedMix.values()).some((r) => r.period === w.code && r.targetStems > 0)
  ).length;

  const lastUpdate = [...savedVarieties.values(), ...savedMix.values()]
    .map((r) => r.updatedAt)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">
          Прогноз срезки{farm ? ` · ${farmLabel(farm)}` : ""}
        </h1>
        <p className="text-sm text-ink-secondary">
          Сколько даст каждый сорт и какая получится ростовка — по неделям месяца. Прогноз можно
          править сколько угодно раз: цифры переписываются, а не копятся.
        </p>
      </div>

      {/* Администратору показываем вкладки раздела «Планы»: у него прогноз
          срезки не отдельный пункт меню, а вкладка внутри планирования. */}
      {role === ROLES.ADMIN && <SectionTabs tabs={plansTabsFor(role)} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={month} />
        <p className="text-sm text-ink-muted">
          {filledWeeks > 0
            ? `Заполнено недель: ${filledWeeks} из ${weeks.length}`
            : "Месяц ещё не заполнен"}
          {lastUpdate && ` · последняя правка ${new Date(lastUpdate).toLocaleString("ru-RU")}`}
        </p>
      </div>

      <ForecastImportForm key={`import-${month}`} month={month} />

      <ForecastBoard
        key={month}
        month={month}
        weeks={weeks}
        flowerTypes={allowedTypes}
        varieties={varieties}
        initialVarieties={initialVarieties}
        initialMix={initialMix}
      />
    </div>
  );
}
