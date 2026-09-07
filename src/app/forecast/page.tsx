import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getForecastForMonth } from "@/lib/repo/harvestForecast";
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
import ForecastGrid from "@/components/ForecastGrid";
import { forecastCellKey } from "@/lib/forecastCell";
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

  const [varieties, saved] = await Promise.all([
    listVarietiesByType(),
    getForecastForMonth(month, allowedTypes),
  ]);

  const initial: Record<string, number> = {};
  for (const row of saved.values()) {
    initial[forecastCellKey(row.period, row.flowerType, row.variety, row.grade)] = row.targetStems;
  }

  const filledWeeks = weeks.filter((w) =>
    Array.from(saved.values()).some((r) => r.period === w.code && r.targetStems > 0)
  ).length;

  const lastUpdate = Array.from(saved.values())
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
          Сколько стеблей какой длины вы рассчитываете срезать — по неделям. Прогноз можно править
          сколько угодно раз: цифры переписываются, а не копятся.
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

      <ForecastImportForm key={`import-${month}`} month={month} weeks={weeks} />

      <div>
        <h2 className="font-medium mb-1">Ростовка по сортам</h2>
        <p className="text-sm text-ink-secondary mb-3">
          Можно заполнить прямо здесь — или загрузить файлом выше, а тут поправить.
        </p>
        <ForecastGrid
          key={month}
          month={month}
          weeks={weeks}
          flowerTypes={allowedTypes}
          varieties={varieties}
          initial={initial}
        />
      </div>
    </div>
  );
}
