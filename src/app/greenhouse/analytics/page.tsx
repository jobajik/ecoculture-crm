import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import CyclesTrendChart from "@/components/greenhouse/CyclesTrendChart";
import { grams, num, pct } from "@/components/greenhouse/parts";
import { Insights, RANK_METRICS, RankList, type RankMetric } from "@/components/greenhouse/rank";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import {
  blockInsights,
  cycleInsights,
  finishedCycles,
  rankBlocks,
  rankVarieties,
  saneYield,
  varietyInsights,
} from "@/lib/greenhouse/views";
import { greenhouseTabsFor } from "../tabs";
import GhSegments from "@/components/greenhouse/GhSegments";
import type { IconName } from "@/components/Icon";
import WorkAnalytics from "@/components/greenhouse/work/WorkAnalytics";
import WorkPayBoard from "@/components/greenhouse/work/WorkPayBoard";
import { isMonth } from "@/lib/payroll/rules";
import { shiftMonth } from "@/lib/payroll/timesheet";
import { WORK_AREAS, isWorkArea, monthRange, periodFor, previousPeriod, summarizeArea, type WorkArea } from "@/lib/payroll/work";
import { loadWorkContext } from "@/lib/payroll/workData";
import { listWork, listWorkBudgets } from "@/lib/repo/payrollWork";
import { saveWorkBudgetsAction } from "../work/actions";
import { LossView, PlanView } from "@/components/greenhouse/dash/PlanLossViews";
import HarvestAnalytics, { type SortKey } from "@/components/greenhouse/dash/HarvestAnalytics";
import { ForecastCard } from "@/components/greenhouse/dash/GhDashboard";
import GhFilterBar from "@/components/greenhouse/GhFilterBar";
import { compareRows, filterGh, periodInsights, qualitySeries } from "@/lib/greenhouse/analyticsView";
import { buildReport } from "@/lib/greenhouse/dashboard";
import { reportRange } from "@/lib/greenhouse/reportPeriod";
import { compareBlocks } from "@/lib/payroll/work";
import { dayLabel } from "@/lib/greenhouse/dashboard";
import { cachedAccuracy, greenhouseForecast, loadGreenhousePlan } from "@/lib/greenhouse/dashboardData";
import { planFact } from "@/lib/greenhouse/forecast";
import { lossByMonth, lossReport, previousRange } from "@/lib/greenhouse/insights";
import { canOpen } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * Аналитика теплицы (30.10.2026, владелец: «и Аналитику тоже переделай»; до этого — восемь тонких вкладок по одному
 * графику или рейтингу и без отбора). Теперь вопросов на экране четыре плюс выработка:
 *   Срезка — за период (неделя, месяц, квартал, год, свой) с отбором по блоку и сорту: цифры с изменением к такому же
 *     сроку перед ним, срезка во времени по качеству, блоки и сорта одной таблицей (нажатие сужает экран);
 *   Потери — тот же отбор: причины, где теряем больше, динамика по месяцам;
 *   Циклы — итог выращивания по завершённым циклам: блоки и сорта рядом, выход по циклам;
 *   План и прогноз — план агронома против факта и что ожидаем дальше;
 *   Люди и Оплата труда — выработка (у кого роль модуля зарплаты).
 * Старые адреса (`view=blocks`, `varieties`, `cycles`, `harvest`) открывают ближайший новый вид.
 */
type View = "harvest" | "losses" | "cycles" | "plan" | "people" | "pay";
type Params = {
  farm?: string;
  view?: string;
  span?: string;
  metric?: string;
  period?: string;
  date?: string;
  from?: string;
  to?: string;
  month?: string;
  area?: string;
  block?: string;
  variety?: string;
  sort?: string;
};

const VIEWS: { key: View; label: string; icon: IconName }[] = [
  { key: "harvest", label: "Срезка", icon: "chart" },
  { key: "losses", label: "Потери", icon: "alert" },
  { key: "cycles", label: "Циклы", icon: "clock" },
  { key: "plan", label: "План и прогноз", icon: "check" },
  { key: "people", label: "Люди", icon: "client" },
  { key: "pay", label: "Оплата труда", icon: "wallet" },
];
const OLD_VIEWS: Record<string, View> = { blocks: "cycles", varieties: "cycles" };

export default async function GreenhouseAnalyticsPage({ searchParams }: { searchParams?: Params }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, data, rows, cycles } = p;
  const sp = searchParams ?? {};
  // «Люди» — у кого есть роль в модуле зарплаты (выработка), «Оплата труда» — кому открыты деньги.
  const views = VIEWS.filter((v) => (v.key === "people" ? !!scope?.payroll : v.key === "pay" ? !!scope?.payroll?.seesMoney : true));
  const asked = OLD_VIEWS[sp.view ?? ""] ?? sp.view;
  const view: View = views.some((v) => v.key === asked) ? (asked as View) : "harvest";

  const header = (
    <PageHeader
      area="greenhouse"
      title="Аналитика"
      subtitle={FARM_LABELS[farm] ?? farm}
      icon="chart"
      tabs={greenhouseTabsFor(scope, farm)}
      actions={scope && <GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref("/greenhouse/analytics", f, { view })} />}
    />
  );
  if (!scope)
    return (
      <div className="space-y-5">
        {header}
        <div className="card text-sm text-ink-secondary">{GREENHOUSE_NO_ACCESS}</div>
      </div>
    );
  const segments = <GhSegments active={view} items={views.map((v) => ({ key: v.key, label: v.label, icon: v.icon, href: ghHref("/greenhouse/analytics", farm, { view: v.key }) }))} />;
  if (!cycles.length && (view === "harvest" || view === "losses" || view === "cycles"))
    return (
      <div className="space-y-5">
        {header}
        {segments}
        <div className="card text-sm text-ink-secondary">
          Данных пока нет — загрузите книгу агронома во вкладке{" "}
          <Link className="underline" href={ghHref("/greenhouse/records", farm)}>
            «Записи»
          </Link>
          .
        </div>
      </div>
    );

  const chip = (on: boolean, href: string, label: string) => (
    <Link key={label} href={href} className={clsx("text-xs px-3 py-1.5 rounded-full border whitespace-nowrap", on ? "bg-ink-primary text-white border-ink-primary" : "border-line-hairline bg-surface hover:bg-surface-plane")}>
      {label}
    </Link>
  );

  let body: React.ReactNode = null;
  if (view === "harvest" || view === "losses") {
    // Общий отбор: период со стрелками, блок, сорт.
    const range = reportRange({ period: sp.period ?? "month", date: sp.date, from: sp.from, to: sp.to }, today);
    const block = String(sp.block ?? "").trim();
    const variety = String(sp.variety ?? "").trim();
    const blocks = new Set<string>();
    for (const c of data.cycles) blocks.add(c.block);
    for (const h of data.harvest) if (h.block && h.block !== "—") blocks.add(h.block);
    const varieties = new Set<string>();
    for (const h of data.harvest) if (h.variety) varieties.add(h.variety);
    for (const w of data.waste) if (w.variety) varieties.add(w.variety);
    const keep: Record<string, string | undefined> = {
      view,
      period: range.period,
      date: range.period === "custom" ? undefined : range.anchor,
      from: range.period === "custom" ? range.from : undefined,
      to: range.period === "custom" ? range.to : undefined,
      block: block || undefined,
      variety: variety || undefined,
    };
    const filterBar = (
      <GhFilterBar
        path="/greenhouse/analytics"
        farm={farm}
        params={{ view }}
        period={range.period}
        from={range.from}
        to={range.to}
        anchor={range.anchor}
        title={range.title}
        prevAnchor={range.prevAnchor}
        nextAnchor={range.nextAnchor}
        periods={["week", "month", "quarter", "year", "custom"]}
        today={today}
        blocks={Array.from(blocks).sort(compareBlocks)}
        block={block}
        varieties={Array.from(varieties).sort((a, b) => a.localeCompare(b))}
        variety={variety}
      />
    );
    const fdata = filterGh(data, block, variety);
    const prevR = previousRange(range.from, range.to);
    if (view === "harvest") {
      const plan = block ? [] : (await loadGreenhousePlan(farm)).filter((x) => !variety || x.variety.trim().toLowerCase() === variety.toLowerCase());
      const rep = buildReport(fdata, plan, range.from, range.to);
      const prevRep = buildReport(fdata, plan, prevR.from, prevR.to);
      const bl = compareRows(rep.byBlock, prevRep.byBlock, rep.totals.qty);
      const vr = compareRows(rep.byVariety, prevRep.byVariety, rep.totals.qty);
      const series = qualitySeries(fdata.harvest, range.from, range.to);
      const sort: SortKey = (["qty", "top", "weight", "loss", "change"] as const).find((k) => k === sp.sort) ?? "qty";
      body = (
        <>
          {filterBar}
          <HarvestAnalytics
            rep={rep}
            insights={periodInsights(rep, prevRep, bl, vr)}
            series={series.points}
            seriesBy={series.by}
            blocks={bl}
            varieties={vr}
            sort={sort}
            sortHref={(s) => ghHref("/greenhouse/analytics", farm, { ...keep, sort: s === "qty" ? undefined : s })}
            blockHref={(r) => ghHref("/greenhouse/analytics", farm, { ...keep, block: r.key })}
            varietyHref={(r) => ghHref("/greenhouse/analytics", farm, { ...keep, variety: r.label })}
            showBlocks={!block}
            showVarieties={!variety}
          />
        </>
      );
    } else {
      body = (
        <>
          {filterBar}
          <LossView loss={lossReport(fdata, range.from, range.to)} prev={lossReport(fdata, prevR.from, prevR.to)} months={lossByMonth(fdata, range.to, 12)} periodChips={null} periodLabel={`сравнение с ${dayLabel(prevR.from)} — ${dayLabel(prevR.to)}`} />
        </>
      );
    }
  } else if (view === "cycles") {
    const span = sp.span === "1" || sp.span === "3" || sp.span === "6" ? Number(sp.span) : sp.span === "all" ? 0 : 3;
    const metric: RankMetric = RANK_METRICS.some((m) => m.key === sp.metric) ? (sp.metric as RankMetric) : "yield";
    const link = (patch: Partial<Params>) => ghHref("/greenhouse/analytics", farm, { view, span: span ? String(span) : "all", metric, ...patch } as Record<string, string | undefined>);
    const finished = finishedCycles(cycles);
    const chosen = span ? finished.slice(0, span) : finished;
    const spanLabel = chosen.length === 1 ? `цикл ${chosen[0].cycle}` : chosen.length ? `циклы ${chosen[chosen.length - 1].cycle}–${chosen[0].cycle}` : "нет завершённых циклов";
    const rankedBlocks = rankBlocks(chosen);
    const rankedVarieties = rankVarieties(rows.filter((r) => chosen.some((c) => c.cycle === r.cycle)));
    const latestOf = (blk: string) => chosen.find((c) => c.blocks.some((b) => b.block === blk))?.cycle;
    const list = [...finished].sort((a, b) => a.cycle - b.cycle);
    const chart = list.map((c) => ({ label: `Ц. ${c.cycle}`, yield: saneYield(c.yieldPct), top: c.topShare }));
    const mLabel = RANK_METRICS.find((m) => m.key === metric)!.label;
    body = (
      <>
        <div className="card !p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex flex-wrap gap-1.5">{[chip(span === 1, link({ span: "1" }), "Последний цикл"), chip(span === 3, link({ span: "3" }), "3 последних"), chip(span === 6, link({ span: "6" }), "6 последних"), chip(span === 0, link({ span: "all" }), "Все")]}</div>
            <div className="flex flex-wrap gap-1.5">{RANK_METRICS.map((m) => chip(m.key === metric, link({ metric: m.key }), m.label))}</div>
          </div>
          <div className="text-xs text-ink-muted">Только завершённые циклы — у тех, что ещё режутся, итог неполный. Сейчас: {spanLabel}.</div>
          <Insights lines={[...blockInsights(rankedBlocks), ...varietyInsights(rankedVarieties)].slice(0, 4)} />
        </div>
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <section className="card !p-4 space-y-3">
            <div className="flex items-baseline gap-2">
              <h3 className="font-display font-bold text-[15px]">Блоки</h3>
              <span className="text-xs text-ink-muted">{mLabel.toLowerCase()} · нажмите — откроется последний цикл блока</span>
            </div>
            <RankList
              rows={rankedBlocks}
              metric={metric}
              href={(r) => {
                const c = latestOf(r.key);
                return c ? ghHref(`/greenhouse/cycles/${c}/${encodeURIComponent(r.key)}`, farm) : undefined;
              }}
              extra={(r) => `${num(r.harvested)} шт.`}
            />
          </section>
          <section className="card !p-4 space-y-3">
            <div className="flex items-baseline gap-2">
              <h3 className="font-display font-bold text-[15px]">Сорта</h3>
              <span className="text-xs text-ink-muted">{mLabel.toLowerCase()}</span>
            </div>
            <RankList rows={rankedVarieties} metric={metric} extra={(r) => `${num(r.harvested)} шт.`} compactRest="Без выхода (посадка не записана)" />
          </section>
        </div>
        {chart.length > 1 && (
          <section className="card !p-4 space-y-3">
            <div className="flex items-baseline gap-2">
              <h3 className="font-display font-bold text-[15px]">Циклы</h3>
              <span className="text-xs text-ink-muted">выход и доля высшей и 1-й по завершённым циклам</span>
            </div>
            <Insights lines={cycleInsights(finished)} />
            <CyclesTrendChart data={chart} />
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-ink-secondary">Таблица по циклам</summary>
              <table className="w-full text-sm table-cards mt-2">
                <thead>
                  <tr className="text-left text-xs text-ink-muted border-b border-line-hairline">
                    <th className="py-2 font-medium">Цикл</th>
                    <th className="py-2 font-medium text-right">Посажено</th>
                    <th className="py-2 font-medium text-right">Срезано</th>
                    <th className="py-2 font-medium text-right">Выход</th>
                    <th className="py-2 font-medium text-right">Высшая и 1-я</th>
                    <th className="py-2 font-medium text-right">Вес</th>
                  </tr>
                </thead>
                <tbody>
                  {finished.map((c) => (
                    <tr key={c.cycle} className="border-b border-line-hairline last:border-0">
                      <td className="py-2">
                        <Link href={ghHref("/greenhouse", farm, { cycle: c.cycle })} className="font-medium hover:underline">
                          Цикл {c.cycle}
                        </Link>
                      </td>
                      <td data-label="Посажено" className="py-2 text-right tabular-nums">
                        {num(c.planted)}
                      </td>
                      <td data-label="Срезано" className="py-2 text-right tabular-nums">
                        {num(c.harvested)}
                      </td>
                      <td data-label="Выход" className="py-2 text-right tabular-nums font-medium">
                        {saneYield(c.yieldPct) !== null ? pct(c.yieldPct) : <span className="text-ink-muted text-xs">посадка неполная</span>}
                      </td>
                      <td data-label="Высшая и 1-я" className="py-2 text-right tabular-nums">
                        {pct(c.topShare)}
                      </td>
                      <td data-label="Вес" className="py-2 text-right tabular-nums">
                        {grams(c.avgWeight)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
        )}
      </>
    );
  } else if (view === "plan") {
    const month = sp.month && isMonth(sp.month) ? sp.month : today.slice(0, 7);
    const isCurrent = month === today.slice(0, 7);
    const monthEnd = monthRange(month).to;
    const plan = await loadGreenhousePlan(farm);
    const pf = planFact(plan, data.harvest, month, today);
    const forecast = greenhouseForecast(rows, data, today);
    const accuracy = forecast ? cachedAccuracy(farm, data, today) : null;
    const next = shiftMonth(month, 1);
    body = (
      <>
        <PlanView
          pf={pf}
          isCurrent={isCurrent}
          forecast={isCurrent ? forecast : null}
          monthEnd={monthEnd}
          prevHref={ghHref("/greenhouse/analytics", farm, { view, month: shiftMonth(month, -1) })}
          nextHref={next <= today.slice(0, 7) ? ghHref("/greenhouse/analytics", farm, { view, month: next }) : null}
          forecastHref={canOpen(p.role, "/forecast") ? `/forecast?period=${month}` : null}
        />
        <ForecastCard forecast={forecast} accuracy={accuracy} farm={farm} blockHref={(cycle, blk) => ghHref(`/greenhouse/cycles/${cycle}/${encodeURIComponent(blk)}`, farm)} />
      </>
    );
  } else {
    body = await workView(view, farm, sp, today);
  }

  return (
    <div className="space-y-5">
      {header}
      {segments}
      {body}
    </div>
  );
}

/** «Люди» (выработка по участкам) и «Оплата труда» (бюджеты и доли) — то, что раньше было вкладками «Выработки». */
async function workView(view: "people" | "pay", farm: string, sp: Params, today: string): Promise<React.ReactNode> {
  const ctx = await loadWorkContext({ farm });
  const scope = ctx.scope;
  if (!scope) return null;
  if (view === "people") {
    const period = periodFor(sp, today);
    const prev = previousPeriod(period.from, period.to);
    const area: WorkArea = sp.area && isWorkArea(sp.area) ? sp.area : "cut";
    const entries = await listWork({ farm, from: prev.from, to: period.to });
    const now = entries.filter((e) => e.date >= period.from);
    const before = entries.filter((e) => e.date < period.from);
    return (
      <WorkAnalytics
        key={`${farm}-${period.from}-${period.to}-${area}`}
        farm={farm}
        today={today}
        from={period.from}
        to={period.to}
        prevFrom={prev.from}
        prevTo={prev.to}
        area={area}
        summaries={Object.fromEntries(WORK_AREAS.map((a) => [a, summarizeArea(a, now, ctx.names)]))}
        previous={Object.fromEntries(WORK_AREAS.map((a) => [a, summarizeArea(a, before, ctx.names)]))}
      />
    );
  }
  const month = sp.month && isMonth(sp.month) ? sp.month : today.slice(0, 7);
  const range = monthRange(month);
  const prevMonth = shiftMonth(month, -1);
  const [entries, budgets, prevBudgets] = await Promise.all([listWork({ farm, from: range.from, to: range.to }), listWorkBudgets(farm, month), listWorkBudgets(farm, prevMonth)]);
  return (
    <WorkPayBoard
      key={`${farm}-${month}`}
      farm={farm}
      farmLabel={FARM_LABELS[farm] ?? farm}
      month={month}
      entries={entries.map((e) => ({ area: e.area, employeeId: e.employeeId, name: e.name, workType: e.workType, qty: e.qty, hours: e.hours }))}
      names={Object.fromEntries(ctx.names)}
      budgets={budgets.map((b) => ({ area: b.area, workType: b.workType, amount: b.amount, note: b.note }))}
      prevBudgets={prevBudgets.map((b) => ({ area: b.area, workType: b.workType, amount: b.amount, note: b.note }))}
      prevMonth={prevMonth}
      canEdit={scope.editsRates}
      save={saveWorkBudgetsAction}
    />
  );
}
