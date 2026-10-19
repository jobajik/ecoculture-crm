import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getForecastForMonth } from "@/lib/repo/harvestForecast";
import { getMixForMonth } from "@/lib/repo/harvestMix";
import Link from "next/link";
import {
  FARM_ORDER,
  FLOWER_TYPES,
  ROLES,
  farmLabel,
  flowerTypesForFarm,
  isValidPeriod,
  periodOf,
  weeksOfMonth,
} from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
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
  searchParams: { period?: string; farm?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.AGRONOMIST && role !== ROLES.ADMIN) redirect("/");

  // Агроном ведёт прогноз только по своему производству. Администратор видит
  // оба и переключает компанию (?farm=rose_farm | esentai), по умолчанию — всё.
  const isAdmin = role === ROLES.ADMIN;
  const chosenFarm =
    isAdmin && FARM_ORDER.includes(searchParams.farm ?? "") ? searchParams.farm! : null;
  const farm = isAdmin ? chosenFarm : session?.user?.farm ?? null;
  const allowedTypes = FLOWER_ORDER.filter((t) =>
    (flowerTypesForFarm(farm) as string[]).includes(t)
  ) as string[];

  const month =
    searchParams.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());

  const weeks = weeksOfMonth(month);
  const farmHref = (f: string) => `/forecast?period=${month}${f ? `&farm=${f}` : ""}`;

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
    <div>
      {/* Администратору показываем вкладки раздела «Планы»: у него прогноз
          срезки не отдельный пункт меню, а вкладка внутри планирования. */}
      <PageHeader
        area="forecast"
        title={`Прогноз срезки${farm ? ` · ${farmLabel(farm)}` : ""}`}
        icon="leaf"
        tabs={role === ROLES.ADMIN ? plansTabsFor(role) : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {isAdmin && (
              <div className="inline-flex rounded-lg border border-line-hairline bg-surface-plane p-1">
                {[
                  { key: "", label: "Все" },
                  ...FARM_ORDER.map((f) => ({ key: f, label: farmLabel(f) })),
                ].map((f) => (
                  <Link
                    key={f.key || "all"}
                    href={farmHref(f.key)}
                    className={
                      (farm ?? "") === f.key
                        ? "rounded-md px-3 py-1.5 text-sm bg-surface shadow-sm font-medium"
                        : "rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:text-ink-primary"
                    }
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            )}
            <PeriodPicker period={month} />
          </div>
        }
      />

      <div className="mb-5">
        <ForecastImportForm
          key={`import-${month}-${farm ?? ""}`}
          month={month}
          farm={farm}
          status={
            <>
              {filledWeeks > 0 ? `Заполнено недель: ${filledWeeks} из ${weeks.length}` : "Файл за этот месяц ещё не загружали"}
              {lastUpdate && ` · последняя правка ${new Date(lastUpdate).toLocaleString("ru-RU")}`}
            </>
          }
        />
      </div>

      <ForecastView key={`${month}-${farm ?? ""}`} summary={summary} />
    </div>
  );
}
