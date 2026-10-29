import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import { ghHref } from "@/lib/greenhouse/farm";
import WorkTabs from "@/components/greenhouse/work/WorkTabs";
import WorkAnalytics from "@/components/greenhouse/work/WorkAnalytics";
import { FARM_LABELS } from "@/lib/constants";
import { WORK_AREAS, isWorkArea, periodFor, previousPeriod, summarizeArea, type WorkArea } from "@/lib/payroll/work";
import { loadWorkContext } from "@/lib/payroll/workData";
import { listWork } from "@/lib/repo/payrollWork";
import { localDayKey } from "@/lib/timezone";
import { greenhouseTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";

/**
 * Аналитика выработки: сколько сделано по участкам, стеблей в час, кто сколько, по блокам и по дням, сравнение с
 * таким же периодом перед этим. Считается чистыми функциями (`summarizeArea`), страница только читает записи периода.
 */
export default async function WorkAnalyticsPage({ searchParams }: { searchParams?: { farm?: string; from?: string; to?: string; month?: string; area?: string } }) {
  const ctx = await loadWorkContext(searchParams);
  if (!ctx.scope) redirect(ghHref("/greenhouse", ctx.farm));
  const { scope, farm } = ctx;
  const today = localDayKey();
  const period = periodFor(searchParams, today);
  const prev = previousPeriod(period.from, period.to);
  const area: WorkArea = searchParams?.area && isWorkArea(searchParams.area) ? searchParams.area : "cut";
  const entries = await listWork({ farm, from: prev.from, to: period.to });
  const now = entries.filter((e) => e.date >= period.from);
  const before = entries.filter((e) => e.date < period.from);
  const summaries = Object.fromEntries(WORK_AREAS.map((a) => [a, summarizeArea(a, now, ctx.names)]));
  const previous = Object.fromEntries(WORK_AREAS.map((a) => [a, summarizeArea(a, before, ctx.names)]));
  const href = (f: string) => ghHref("/greenhouse/work/analytics", f, { from: period.from, to: period.to, area });

  return (
    <div className="space-y-5">
      <PageHeader area="greenhouse" title="Выработка — аналитика" subtitle={FARM_LABELS[farm] ?? farm} icon="chart" tabs={greenhouseTabsFor(ctx.gh, farm)} actions={<GhFarmSwitch farm={farm} href={href} locked={!!ctx.gh?.farmLocked} />}>
        <WorkTabs active="analytics" farm={farm} seesMoney={scope.seesMoney} />
      </PageHeader>
      <WorkAnalytics
        key={`${farm}-${period.from}-${period.to}-${area}`}
        farm={farm}
        today={today}
        from={period.from}
        to={period.to}
        prevFrom={prev.from}
        prevTo={prev.to}
        area={area}
        summaries={summaries}
        previous={previous}
      />
    </div>
  );
}
