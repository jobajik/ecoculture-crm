import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import GradeStackChart from "@/components/greenhouse/GradeStackChart";
import { GradeBar, GradeLegend, SectionTitle, YieldBar, dm, grams, num, pct } from "@/components/greenhouse/parts";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { HARVEST_GRADES, WASTE_KINDS, blockTimeline, summarizeVarieties, type CycleRow } from "@/lib/greenhouse/production";
import { HEAT_METRICS, harvestBuckets, heatValue, wasteByCycle, type BlockCard, type HeatMetric } from "@/lib/greenhouse/views";
import { compareBlocks, shiftDay } from "@/lib/payroll/work";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
import { greenhouseTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * Аналитика теплицы — замена листам книги «Аналитика по блоку», «Проценты по блокам», «Процент брака», «Аналитика по
 * черенкам»: блоки × циклы тепловой картой по выбранной мере, сорта поверх циклов, срезка по неделям/месяцам, сроки
 * роста и брак по причинам.
 */
type Params = { farm?: string; metric?: string; span?: string; by?: string; vsort?: string; vall?: string };

export default async function GreenhouseAnalyticsPage({ searchParams }: { searchParams?: Params }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, data, rows, cycles } = p;
  const year = today.slice(0, 4);
  const sp = searchParams ?? {};
  const link = (patch: Partial<Params>) => ghHref("/greenhouse/analytics", farm, { metric: sp.metric, span: sp.span, by: sp.by, vsort: sp.vsort, ...patch } as Record<string, string | undefined>);
  const header = (
    <PageHeader
      area="greenhouse"
      title="Аналитика теплицы"
      subtitle={FARM_LABELS[farm] ?? farm}
      icon="chart"
      tabs={greenhouseTabsFor(scope, farm)}
      actions={scope && <GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref("/greenhouse/analytics", f)} />}
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

  const metric: HeatMetric = HEAT_METRICS.some((m) => m.key === sp.metric) ? (sp.metric as HeatMetric) : "yield";
  const metricMeta = HEAT_METRICS.find((m) => m.key === metric)!;
  const span = sp.span === "3" || sp.span === "6" ? Number(sp.span) : 0;
  const withHarvest = cycles.filter((c) => c.harvested > 0 || c.planted > 0);
  const shownCycles = (span ? withHarvest.slice(0, span) : withHarvest).slice().sort((a, b) => a.cycle - b.cycle);
  const blockNames = Array.from(new Set(shownCycles.flatMap((c) => c.blocks.map((b) => b.block)))).sort(compareBlocks);
  const cell = (cycle: number, block: string): BlockCard | undefined => shownCycles.find((c) => c.cycle === cycle)?.blocks.find((b) => b.block === block);

  // Шкала цвета — по значениям на экране; для «меньше — лучше» перевёрнута.
  const values: number[] = [];
  for (const c of shownCycles) for (const b of c.blocks) {
    const v = heatValue(b, metric);
    if (v !== null && Number.isFinite(v)) values.push(v);
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
  const hi = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
  const tone = (v: number | null) => {
    if (v === null) return undefined;
    let x = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    x = Math.max(0, Math.min(1, x));
    if (metricMeta.better === "low") x = 1 - x;
    // От тёплого песочного (хуже) к зелёному (лучше).
    const from = [244, 226, 196];
    const to = [120, 186, 140];
    const c = from.map((f, i) => Math.round(f + (to[i] - f) * x));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  };
  const fmt = (v: number | null) => (v === null ? "" : metricMeta.unit === "%" ? `${Math.round(v)}` : metricMeta.unit === "г" ? `${Math.round(v)}` : v >= 10000 ? `${Math.round(v / 1000)}к` : num(v));
  const avg = (list: (number | null)[]) => {
    const xs = list.filter((x): x is number => x !== null && Number.isFinite(x));
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  };

  // Сорта
  const spanRows: CycleRow[] = span ? rows.filter((r) => shownCycles.some((c) => c.cycle === r.cycle)) : rows;
  const vsort = ["harvested", "yield", "top", "weight", "waste"].includes(sp.vsort ?? "") ? sp.vsort! : "harvested";
  const varieties = summarizeVarieties(spanRows)
    .filter((v) => v.harvested > 0 || v.planted > 0)
    .sort((a, b) => {
      const k = (x: typeof a) => (vsort === "yield" ? x.yieldPct ?? -1 : vsort === "top" ? x.topShare ?? -1 : vsort === "weight" ? x.avgWeight ?? -1 : vsort === "waste" ? x.wasteTotal : x.harvested);
      return k(b) - k(a);
    });

  // Срезка по времени
  const by = sp.by === "week" ? "week" : "month";
  const fromDate = by === "week" ? shiftDay(today, -7 * 16) : `${Number(year) - 1}-${today.slice(5, 7)}-01`;
  const buckets = harvestBuckets(data.harvest, fromDate, today, by);
  const bucketGrades = HARVEST_GRADES.filter((g) => buckets.some((b) => b.byGrade[g]));
  const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const chart = buckets.map((b) => ({ label: by === "week" ? dm(b.key) : `${MON[Number(b.key.slice(5, 7)) - 1]} ${b.key.slice(2, 4)}`, ...b.byGrade }));

  // Сроки роста по циклам
  const timing = shownCycles
    .slice()
    .sort((a, b) => b.cycle - a.cycle)
    .map((c) => {
      const row = rows.find((r) => r.cycle === c.cycle);
      const t = (row?.blocks ?? []).map((b) => ({ ...blockTimeline(b), delayExp: b.firstHarvestAt && b.expectedHarvestAt ? Math.round((Date.parse(b.firstHarvestAt) - Date.parse(b.expectedHarvestAt)) / 86400000) : null }));
      return {
        cycle: c.cycle,
        rooting: avg(t.map((x) => x.rooting)),
        growing: avg(t.map((x) => x.growing)),
        harvesting: avg(t.map((x) => (x.harvesting !== null ? x.harvesting + 1 : null))),
        delay: avg(t.map((x) => x.delayExp)),
      };
    });

  // Брак
  const waste = wasteByCycle(data.waste).filter((w) => !span || shownCycles.some((c) => c.cycle === w.cycle));
  const wasteKinds = WASTE_KINDS.filter((k) => waste.some((w) => w.byKind[k.code]));

  const chip = (on: boolean, href: string, label: string) => (
    <Link key={label} href={href} className={clsx("text-xs px-2.5 py-1 rounded-full border whitespace-nowrap", on ? "bg-ink-primary text-white border-ink-primary" : "border-line-hairline hover:bg-surface-plane")}>
      {label}
    </Link>
  );
  const blockHref = (cycle: number, block: string) => ghHref(`/greenhouse/cycles/${cycle}/${encodeURIComponent(block)}`, farm);

  return (
    <div className="space-y-7">
      {header}

      {/* Блоки × циклы */}
      <section className="space-y-3">
        <SectionTitle
          title="Блоки по циклам"
          hint="Каждая клетка — блок в цикле. Зеленее — лучше, песочнее — хуже (относительно остальных клеток). Нажмите клетку — откроется блок."
          actions={<div className="flex flex-wrap gap-1.5">{[chip(span === 0, link({ span: undefined }), "Все циклы"), chip(span === 6, link({ span: "6" }), "Последние 6"), chip(span === 3, link({ span: "3" }), "Последние 3")]}</div>}
        />
        <div className="flex flex-wrap gap-1.5">{HEAT_METRICS.map((m) => chip(m.key === metric, link({ metric: m.key }), m.label))}</div>
        <div className="card !p-0 overflow-x-auto">
          <table className="text-sm border-separate border-spacing-0 w-full">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={clsx(TH, "sticky left-0 bg-surface z-10")}>Блок</th>
                {shownCycles.map((c) => (
                  <th key={c.cycle} className={clsx(TH, "text-center whitespace-nowrap")}>
                    <Link className="hover:underline" href={ghHref("/greenhouse", farm, { cycle: c.cycle })}>
                      Ц. {c.cycle}
                    </Link>
                  </th>
                ))}
                <th className={clsx(TH, "text-center")}>Среднее</th>
              </tr>
            </thead>
            <tbody>
              {blockNames.map((b) => {
                const vals = shownCycles.map((c) => {
                  const card = cell(c.cycle, b);
                  return card ? heatValue(card, metric) : null;
                });
                return (
                  <tr key={b}>
                    <td className="px-4 py-1.5 whitespace-nowrap font-medium sticky left-0 bg-surface z-10 border-b border-line-hairline">{/^\d+$/.test(b) ? `Блок ${b}` : b}</td>
                    {shownCycles.map((c, i) => {
                      const card = cell(c.cycle, b);
                      const v = vals[i];
                      return (
                        <td key={c.cycle} className="p-0.5 border-b border-line-hairline">
                          {card ? (
                            <Link
                              href={blockHref(c.cycle, b)}
                              className="block rounded-md text-center tabular-nums text-xs py-1.5 min-w-[2.75rem] hover:ring-2 hover:ring-section-greenhouse/40"
                              style={{ background: tone(v) ?? "transparent" }}
                              title={`Блок ${b}, цикл ${c.cycle}: ${v === null ? "нет данных" : `${num(v)} ${metricMeta.unit}`}`}
                            >
                              {fmt(v) || <span className="text-ink-muted">·</span>}
                            </Link>
                          ) : (
                            <div className="text-center text-ink-muted text-xs py-1.5">—</div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-center tabular-nums text-xs font-medium border-b border-line-hairline">{fmt(avg(vals))}</td>
                  </tr>
                );
              })}
              <tr className="bg-surface-plane/60">
                <td className="px-4 py-2 text-xs font-medium sticky left-0 bg-surface-plane z-10">По циклу</td>
                {shownCycles.map((c) => {
                  const v = metric === "yield" ? c.yieldPct : metric === "harvested" ? c.harvested : metric === "top" ? c.topShare : metric === "weight" ? c.avgWeight : metric === "loss" ? c.cullPct : c.wasteTotal;
                  return (
                    <td key={c.cycle} className="px-1 py-2 text-center tabular-nums text-xs font-semibold">
                      {fmt(v ?? null)}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="text-xs text-ink-muted">
          {metricMeta.label}
          {metric === "yield" && ". Больше 100 % — в книге посажено записано меньше, чем было на самом деле (недоучёт черенков или маточника)."}
        </div>
      </section>

      {/* Срезка по времени */}
      <section className="card space-y-3">
        <SectionTitle
          title={by === "week" ? "Срезка по неделям" : "Срезка по месяцам"}
          hint={by === "week" ? "Последние 16 недель, категории стопкой." : "Последние 12 месяцев, категории стопкой."}
          actions={<div className="flex gap-1.5">{[chip(by === "month", link({ by: undefined }), "По месяцам"), chip(by === "week", link({ by: "week" }), "По неделям")]}</div>}
        />
        {chart.length ? <GradeStackChart data={chart} grades={bucketGrades} height={260} /> : <div className="text-sm text-ink-secondary">За этот срок срезки нет.</div>}
        <GradeLegend grades={bucketGrades} />
      </section>

      {/* Сорта */}
      <section className="space-y-3">
        <SectionTitle
          title="Сорта"
          hint={`${span ? `Последние ${span} циклов` : "Все циклы"}. Нажмите заголовок, чтобы отсортировать.`}
        />
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Сорт</th>
                <th className={clsx(TH, "text-right")}>Циклов</th>
                <th className={clsx(TH, "text-right")}>Посажено</th>
                <SortTh label="Срезано" on={vsort === "harvested"} href={link({ vsort: undefined })} />
                <SortTh label="Выход" on={vsort === "yield"} href={link({ vsort: "yield" })} wide />
                <SortTh label="Высш.+1" on={vsort === "top"} href={link({ vsort: "top" })} />
                <SortTh label="Вес" on={vsort === "weight"} href={link({ vsort: "weight" })} />
                <SortTh label="Брак" on={vsort === "waste"} href={link({ vsort: "waste" })} />
              </tr>
            </thead>
            <tbody>
              {(sp.vall ? varieties : varieties.slice(0, 20)).map((v) => (
                <tr key={v.variety} className={TR}>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">{v.variety}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{v.cycles}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(v.planted)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{num(v.harvested)}</td>
                  <td className="px-4 py-2 w-40">
                    <div className="flex items-center gap-2">
                      <YieldBar value={v.yieldPct} className="flex-1 min-w-[3rem]" />
                      <span className="tabular-nums text-xs w-10 text-right">{v.yieldPct !== null ? `${Math.round(v.yieldPct)}%` : "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(v.topShare)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{grams(v.avgWeight)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{v.wasteTotal ? num(v.wasteTotal) : "·"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {varieties.length > 20 && (
          <Link className="text-sm underline" href={link({ vall: sp.vall ? undefined : "1" })}>
            {sp.vall ? "Свернуть до 20" : `Показать все ${varieties.length}`}
          </Link>
        )}
        <div className="text-xs text-ink-muted">Посажено 0 при срезке — сорт не записан в черенковании этих блоков или записан под другим именем; выход у него не считается.</div>
      </section>

      {/* Сроки */}
      <section className="space-y-3">
        <SectionTitle title="Сроки по циклам" hint="Средние по блокам цикла, в днях. Опоздание — первая срезка против плана (или посадка + 76 дней, где плана нет)." />
        <div className="card !p-0 overflow-hidden">
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Цикл</th>
                <th className={clsx(TH, "text-right")}>Черенкование → посадка</th>
                <th className={clsx(TH, "text-right")}>Посадка → первая срезка</th>
                <th className={clsx(TH, "text-right")}>Срезка длится</th>
                <th className={clsx(TH, "text-right")}>Опоздание к плану</th>
                <th className={clsx(TH, "w-40 hidden md:table-cell")}>Категории</th>
              </tr>
            </thead>
            <tbody>
              {timing.map((t) => {
                const c = cycles.find((x) => x.cycle === t.cycle)!;
                return (
                  <tr key={t.cycle} className={TR}>
                    <td className="px-4 py-2 font-display font-bold">
                      <Link href={ghHref("/greenhouse", farm, { cycle: t.cycle })} className="hover:underline">
                        Цикл {t.cycle}
                      </Link>
                    </td>
                    <td data-label="Черенк. → посадка" className="px-4 py-2 text-right tabular-nums">
                      {t.rooting !== null ? `${Math.round(t.rooting)} дн.` : "—"}
                    </td>
                    <td data-label="Посадка → срезка" className="px-4 py-2 text-right tabular-nums">
                      {t.growing !== null ? `${Math.round(t.growing)} дн.` : "—"}
                    </td>
                    <td data-label="Срезка длится" className="px-4 py-2 text-right tabular-nums">
                      {t.harvesting !== null ? `${Math.round(t.harvesting)} дн.` : "—"}
                    </td>
                    <td data-label="Опоздание" className={clsx("px-4 py-2 text-right tabular-nums", t.delay !== null && t.delay > 3 && "text-[#a12b2b]")}>
                      {t.delay !== null ? `${t.delay > 0 ? "+" : ""}${Math.round(t.delay)} дн.` : "—"}
                    </td>
                    <td data-label="Категории" className="px-4 py-2 hidden md:table-cell">
                      <GradeBar grades={c.grades} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Брак по причинам */}
      {waste.length > 0 && (
        <section className="space-y-3">
          <SectionTitle title="Брак на блоках по причинам" hint="Из журнала брака, штук. Тех брак учитывается и в посадке." />
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={TH}>Цикл</th>
                  {wasteKinds.map((k) => (
                    <th key={k.code} className={clsx(TH, "text-right")}>
                      {k.label}
                    </th>
                  ))}
                  <th className={clsx(TH, "text-right")}>Всего</th>
                  <th className={clsx(TH, "text-right")}>От посаженного</th>
                </tr>
              </thead>
              <tbody>
                {waste.map((w) => {
                  const c = cycles.find((x) => x.cycle === w.cycle);
                  return (
                    <tr key={w.cycle} className={TR}>
                      <td className="px-4 py-2 font-medium">Цикл {w.cycle}</td>
                      {wasteKinds.map((k) => (
                        <td key={k.code} className="px-4 py-2 text-right tabular-nums">
                          {w.byKind[k.code] ? num(w.byKind[k.code]) : <span className="text-ink-muted">·</span>}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{num(w.total)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c && c.planted ? pct((w.total * 100) / c.planted, 1) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="text-xs text-ink-muted">Данные на {dm(today, year)}.</div>
    </div>
  );
}

function SortTh({ label, on, href, wide }: { label: string; on: boolean; href: string; wide?: boolean }) {
  return (
    <th className={clsx(TH, wide ? "" : "text-right")}>
      <Link href={href} className={clsx("hover:underline", on && "text-ink-primary font-semibold")}>
        {label}
        {on ? " ↓" : ""}
      </Link>
    </th>
  );
}
