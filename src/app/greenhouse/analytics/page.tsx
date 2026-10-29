import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import GradeStackChart from "@/components/greenhouse/GradeStackChart";
import CyclesTrendChart from "@/components/greenhouse/CyclesTrendChart";
import { GradeLegend, grams, num, pct } from "@/components/greenhouse/parts";
import { Insights, RANK_METRICS, RankList, type RankMetric } from "@/components/greenhouse/rank";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import {
  QUALITY_COLORS,
  QUALITY_GROUPS,
  blockInsights,
  cycleInsights,
  finishedCycles,
  harvestBuckets,
  harvestInsight,
  qualityOf,
  rankBlocks,
  rankVarieties,
  saneYield,
  varietyInsights,
} from "@/lib/greenhouse/views";
import { shiftDay } from "@/lib/payroll/work";
import { greenhouseTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * Аналитика теплицы (29.10.2026, владелец: «сделай анализ проще, понятнее, но интереснее; убери шум»). Один вопрос на
 * экран: «Блоки», «Сорта», «Циклы», «Срезка». Сверху каждого — выводы словами, ниже рейтинг полосами или график.
 * Выход считается только по ЗАВЕРШЁННЫМ блокам и циклам: у тех, что ещё режутся, он неполный.
 */
type View = "blocks" | "varieties" | "cycles" | "harvest";
type Params = { farm?: string; view?: string; span?: string; metric?: string; by?: string };

const VIEWS: { key: View; label: string }[] = [
  { key: "blocks", label: "Блоки" },
  { key: "varieties", label: "Сорта" },
  { key: "cycles", label: "Циклы" },
  { key: "harvest", label: "Срезка по месяцам" },
];

export default async function GreenhouseAnalyticsPage({ searchParams }: { searchParams?: Params }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, data, rows, cycles } = p;
  const sp = searchParams ?? {};
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "blocks";
  const span = sp.span === "1" || sp.span === "3" || sp.span === "6" ? Number(sp.span) : sp.span === "all" ? 0 : 3;
  const metric: RankMetric = RANK_METRICS.some((m) => m.key === sp.metric) ? (sp.metric as RankMetric) : "yield";
  const by = sp.by === "week" ? "week" : "month";
  const link = (patch: Partial<Params>) => ghHref("/greenhouse/analytics", farm, { view, span: span ? String(span) : "all", metric, by, ...patch } as Record<string, string | undefined>);

  const header = (
    <PageHeader
      area="greenhouse"
      title="Аналитика теплицы"
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
  if (!cycles.length)
    return (
      <div className="space-y-5">
        {header}
        <div className="card text-sm text-ink-secondary">
          Данных пока нет — загрузите книгу агронома на вкладке{" "}
          <Link className="underline" href={ghHref("/greenhouse", farm)}>
            «Циклы и блоки»
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

  const finished = finishedCycles(cycles);
  const chosen = span ? finished.slice(0, span) : finished;
  const spanLabel = chosen.length === 1 ? `цикл ${chosen[0].cycle}` : chosen.length ? `циклы ${chosen[chosen.length - 1].cycle}–${chosen[0].cycle}` : "нет завершённых циклов";
  const spanChips = (
    <div className="flex flex-wrap gap-1.5">
      {[chip(span === 1, link({ span: "1" }), "Последний цикл"), chip(span === 3, link({ span: "3" }), "3 последних"), chip(span === 6, link({ span: "6" }), "6 последних"), chip(span === 0, link({ span: "all" }), "Все")]}
    </div>
  );
  const metricChips = <div className="flex flex-wrap gap-1.5">{RANK_METRICS.map((m) => chip(m.key === metric, link({ metric: m.key }), m.label))}</div>;

  let body: React.ReactNode = null;
  if (view === "blocks") {
    const ranked = rankBlocks(chosen);
    const latestOf = (block: string) => chosen.find((c) => c.blocks.some((b) => b.block === block))?.cycle;
    body = (
      <>
        <div className="card !p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            {spanChips}
            {metricChips}
          </div>
          <Insights lines={blockInsights(ranked)} />
        </div>
        <section className="card !p-5 space-y-3">
          <div className="text-xs text-ink-muted">
            {RANK_METRICS.find((m) => m.key === metric)!.label} по блокам · {spanLabel}. Зелёным — лучший, оранжевым — отстающий. Нажмите блок — откроется его последний цикл.
          </div>
          <RankList
            rows={ranked}
            metric={metric}
            href={(r) => {
              const c = latestOf(r.key);
              return c ? ghHref(`/greenhouse/cycles/${c}/${encodeURIComponent(r.key)}`, farm) : undefined;
            }}
            extra={(r) => `${num(r.harvested)} шт.`}
          />
        </section>
      </>
    );
  } else if (view === "varieties") {
    const chosenRows = rows.filter((r) => chosen.some((c) => c.cycle === r.cycle));
    const ranked = rankVarieties(chosenRows);
    body = (
      <>
        <div className="card !p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            {spanChips}
            {metricChips}
          </div>
          <Insights lines={varietyInsights(ranked)} />
        </div>
        <section className="card !p-5 space-y-3">
          <div className="text-xs text-ink-muted">
            {RANK_METRICS.find((m) => m.key === metric)!.label} по сортам · {spanLabel}. Выход — только у сортов с записанной посадкой.
          </div>
          <RankList rows={ranked} metric={metric} extra={(r) => `${num(r.harvested)} шт.`} compactRest="Без выхода (посадка не записана)" />
        </section>
      </>
    );
  } else if (view === "cycles") {
    const list = [...finished].sort((a, b) => a.cycle - b.cycle);
    const chart = list.map((c) => ({ label: `Ц. ${c.cycle}`, yield: saneYield(c.yieldPct), top: c.topShare }));
    body = (
      <>
        <div className="card !p-5 space-y-4">
          <Insights lines={cycleInsights(finished)} />
          {chart.length > 1 && <CyclesTrendChart data={chart} />}
        </div>
        <section className="card !p-0 overflow-hidden">
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                <th className="px-4 py-2.5 font-medium">Цикл</th>
                <th className="px-4 py-2.5 font-medium text-right">Посажено</th>
                <th className="px-4 py-2.5 font-medium text-right">Срезано</th>
                <th className="px-4 py-2.5 font-medium text-right">Выход</th>
                <th className="px-4 py-2.5 font-medium text-right">Высшая и 1-я</th>
                <th className="px-4 py-2.5 font-medium text-right">Вес</th>
              </tr>
            </thead>
            <tbody>
              {[...finished].map((c) => (
                <tr key={c.cycle} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane/60">
                  <td className="px-4 py-2.5">
                    <Link href={ghHref("/greenhouse", farm, { cycle: c.cycle })} className="font-medium hover:underline">
                      Цикл {c.cycle}
                    </Link>
                  </td>
                  <td data-label="Посажено" className="px-4 py-2.5 text-right tabular-nums">
                    {num(c.planted)}
                  </td>
                  <td data-label="Срезано" className="px-4 py-2.5 text-right tabular-nums">
                    {num(c.harvested)}
                  </td>
                  <td data-label="Выход" className="px-4 py-2.5 text-right tabular-nums font-medium">
                    {saneYield(c.yieldPct) !== null ? pct(c.yieldPct) : <span className="text-ink-muted text-xs">посадка неполная</span>}
                  </td>
                  <td data-label="Высшая и 1-я" className="px-4 py-2.5 text-right tabular-nums">
                    {pct(c.topShare)}
                  </td>
                  <td data-label="Вес" className="px-4 py-2.5 text-right tabular-nums">
                    {grams(c.avgWeight)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="text-xs text-ink-muted">Здесь только завершённые циклы: у тех, что ещё режутся, выход неполный.</div>
      </>
    );
  } else {
    const fromDate = by === "week" ? shiftDay(today, -7 * 16) : `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
    const buckets = harvestBuckets(data.harvest, fromDate, today, by);
    const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    const chart = buckets.map((b) => {
      const g: Record<string, number> = {};
      for (const [grade, qty] of Object.entries(b.byGrade)) {
        const label = QUALITY_GROUPS.find((q) => q.key === qualityOf(grade))!.label;
        g[label] = (g[label] ?? 0) + qty;
      }
      const [y, m, d] = b.key.split("-");
      return { label: by === "week" ? `${Number(d)} ${MON[Number(m) - 1]}` : `${MON[Number(m) - 1]} ${y.slice(2)}`, ...g };
    });
    const groups = QUALITY_GROUPS.map((q) => q.label);
    const insight = harvestInsight(buckets, by);
    body = (
      <section className="card !p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex gap-1.5">{[chip(by === "month", link({ by: "month" }), "По месяцам"), chip(by === "week", link({ by: "week" }), "По неделям")]}</div>
          <span className="text-xs text-ink-muted">{by === "week" ? "последние 16 недель" : "последние 12 месяцев"}</span>
        </div>
        <Insights lines={insight ? [insight] : []} />
        {chart.length ? <GradeStackChart data={chart} grades={groups} colors={QUALITY_COLORS} height={280} /> : <div className="text-sm text-ink-secondary">За этот срок срезки нет.</div>}
        <GradeLegend grades={groups} colors={QUALITY_COLORS} />
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-1 px-1 py-0.5">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={link({ view: v.key })}
            className={clsx("h-9 px-4 rounded-full text-sm whitespace-nowrap inline-flex items-center", v.key === view ? "bg-section-greenhouse text-white font-medium" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane")}
          >
            {v.label}
          </Link>
        ))}
      </div>
      {body}
    </div>
  );
}
