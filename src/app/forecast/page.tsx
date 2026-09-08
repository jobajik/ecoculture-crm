import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getForecastForMonth } from "@/lib/repo/harvestForecast";
import { getMixForMonth } from "@/lib/repo/harvestMix";
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
import ForecastView from "@/components/ForecastView";
import ForecastImportForm from "@/components/ForecastImportForm";
import { buildForecastSummary } from "@/lib/forecastSummary";
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

  const [savedVarieties, savedMix] = await Promise.all([
    getForecastForMonth(month, allowedTypes),
    getMixForMonth(month, allowedTypes),
  ]);

  const summary = buildForecastSummary({
    month,
    weeks,
    flowerTypes: allowedTypes,
    varieties: Array.from(savedVarieties.values()),
    mix: Array.from(savedMix.values()),
  });

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
          Прогноз ведётся файлом: скачали шаблон, заполнили в Excel, загрузили обратно. Каждая
          загрузка заменяет месяц целиком, поэтому здесь всегда лежит то, что в последнем файле.
          Ниже — что из этого вырастет: по неделям, по сортам и по ростовке.
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
            : "Файл за этот месяц ещё не загружали"}
          {lastUpdate && ` · последняя правка ${new Date(lastUpdate).toLocaleString("ru-RU")}`}
        </p>
      </div>

      <ForecastImportForm key={`import-${month}`} month={month} />

      <ForecastView key={month} summary={summary} />
    </div>
  );
}
