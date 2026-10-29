import Link from "next/link";
import clsx from "clsx";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import GradeStackChart from "@/components/greenhouse/GradeStackChart";
import CycleDatesForm from "@/components/greenhouse/CycleDatesForm";
import { GradeBar, GradeLegend, SectionTitle, StatusChip, YieldBar, dm, gradeShort, grams, num, pct } from "@/components/greenhouse/parts";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { BLOCK_STATUS_LABELS, HARVEST_GRADES, TOP_GRADES, WASTE_KINDS, blockSource, cycleOf, summarizeBlock } from "@/lib/greenhouse/production";
import { compareBlocks } from "@/lib/payroll/work";
import { GRADE_COLORS } from "@/lib/greenhouse/views";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
import { greenhouseTabsFor } from "../../../tabs";
import { saveCycleAction } from "../../../actions";

export const dynamic = "force-dynamic";

/**
 * Блок в цикле — то, что в книге было листами «Данные по черенкованию по блокам», «Проценты по блокам» и «Аналитика по
 * блоку», одной страницей: путь блока по датам, что пришло и что посажено по сортам, что срезано по категориям, вес,
 * брак, срезка по дням и тот же блок в прошлых циклах.
 */
export default async function BlockPage({ params, searchParams }: { params: { cycle: string; block: string }; searchParams?: { farm?: string } }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, data, cycles } = p;
  const year = today.slice(0, 4);
  const cycle = cycleOf(params.cycle);
  const block = decodeURIComponent(params.block);
  if (!scope)
    return (
      <div className="space-y-5">
        <PageHeader area="greenhouse" title="Теплица" icon="leaf" />
        <div className="card text-sm text-ink-secondary">{GREENHOUSE_NO_ACCESS}</div>
      </div>
    );
  const cycleCard = cycles.find((c) => c.cycle === cycle);
  if (!cycle || !cycleCard || !cycleCard.blocks.some((b) => b.block === block)) notFound();

  const s = summarizeBlock(cycle, block, data, today);
  const t = s.totals;
  const blockName = /^\d+$/.test(block) ? `Блок ${block}` : block;
  const blocksOfCycle = cycleCard.blocks.map((b) => b.block).sort(compareBlocks);
  const idx = blocksOfCycle.indexOf(block);
  const prev = idx > 0 ? blocksOfCycle[idx - 1] : null;
  const next = idx >= 0 && idx < blocksOfCycle.length - 1 ? blocksOfCycle[idx + 1] : null;
  const href = (c: number, b: string) => ghHref(`/greenhouse/cycles/${c}/${encodeURIComponent(b)}`, farm);
  // Этот блок во всех циклах — «поблочно с циклами».
  const history = cycles
    .map((c) => ({ cycle: c.cycle, b: c.blocks.find((x) => x.block === block) }))
    .filter((x): x is { cycle: number; b: NonNullable<typeof x.b> } => !!x.b)
    .sort((a, b) => b.cycle - a.cycle);

  // Срезка по дням со стопкой категорий.
  const dayMap = new Map<string, Record<string, number>>();
  for (const h of data.harvest) {
    if (h.cycle !== cycle || h.block !== block) continue;
    const d = dayMap.get(h.date) ?? {};
    d[h.grade] = (d[h.grade] ?? 0) + h.qty;
    dayMap.set(h.date, d);
  }
  const chartData = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, g]) => ({ label: dm(date), ...g }));

  const source = blockSource(s);
  const loss = t.deptCull + t.nurseryCull + t.techCull + t.cull;
  const delay = s.firstHarvestAt && s.expectedHarvestAt ? Math.round((Date.parse(s.firstHarvestAt) - Date.parse(s.expectedHarvestAt)) / 86400000) : null;
  const days = (a: string, b: string) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null);
  const wasteKinds = WASTE_KINDS.filter((k) => k.code !== "tech" && (t.wasteByKind[k.code] ?? 0) > 0);
  const hasCuttingsData = s.varieties.some((v) => v.invoice || v.actual || v.fromStock);

  return (
    <div className="space-y-6">
      <PageHeader
        area="greenhouse"
        title={`${blockName} · цикл ${cycle}`}
        subtitle={FARM_LABELS[farm] ?? farm}
        icon="leaf"
        tabs={greenhouseTabsFor(scope, farm)}
        actions={
          <div className="flex items-center gap-1.5">
            {prev ? (
              <Link href={href(cycle, prev)} className="btn-secondary !py-1.5 !px-3" title="Предыдущий блок">
                ‹ {prev}
              </Link>
            ) : null}
            <Link href={ghHref("/greenhouse", farm, { cycle })} className="btn-secondary !py-1.5 !px-3">
              Все блоки цикла
            </Link>
            {next ? (
              <Link href={href(cycle, next)} className="btn-secondary !py-1.5 !px-3" title="Следующий блок">
                {next} ›
              </Link>
            ) : null}
          </div>
        }
      />

      {/* Путь блока */}
      <section className="card !p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={s.status} label={BLOCK_STATUS_LABELS[s.status]} />
          {history.length > 1 && (
            <div className="flex flex-wrap gap-1 ml-auto">
              <span className="text-xs text-ink-muted self-center mr-1">{blockName} в цикле:</span>
              {history.map((h) => (
                <Link
                  key={h.cycle}
                  href={href(h.cycle, block)}
                  className={clsx("h-7 min-w-[2.25rem] px-2 rounded-full text-xs inline-flex items-center justify-center", h.cycle === cycle ? "bg-section-greenhouse text-white" : "border border-line-hairline hover:bg-surface-plane")}
                >
                  {h.cycle}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <TimelineStep label="Черенкование" date={dm(s.dates.cuttingsAt, year)} done={!!s.dates.cuttingsAt} after={days(s.dates.cuttingsAt, s.dates.plantedAt)} afterLabel="до посадки" />
          <TimelineStep label="Посадка" date={dm(s.dates.plantedAt, year)} done={!!s.dates.plantedAt} after={days(s.dates.plantedAt, s.firstHarvestAt || "")} afterLabel="до первой срезки" />
          <TimelineStep
            label={s.firstHarvestAt ? "Первая срезка" : s.expectedIsEstimate ? "Срезка ≈ (посадка + 76 дн.)" : "Срезка по плану"}
            date={s.firstHarvestAt ? dm(s.firstHarvestAt, year) : dm(s.expectedHarvestAt, year)}
            done={!!s.firstHarvestAt}
            note={s.firstHarvestAt && s.expectedHarvestAt ? (delay === 0 ? "день в день с планом" : `${delay! > 0 ? "+" : ""}${delay} дн. к плану ${dm(s.expectedHarvestAt, year)}`) : undefined}
          />
          <TimelineStep
            label={s.status === "harvest" ? "Последняя срезка" : "Срезка закончена"}
            date={dm(s.lastHarvestAt, year)}
            done={!!s.lastHarvestAt && s.status === "done"}
            note={s.firstHarvestAt && s.lastHarvestAt ? `срезка ${days(s.firstHarvestAt, s.lastHarvestAt)! + 1} дн., ${s.harvestByDay.length} дн. со срезом` : undefined}
          />
        </div>
        {(s.dates.note || scope.editsLogs) && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {s.dates.note && <span className="text-ink-secondary">{s.dates.note}</span>}
            {scope.editsLogs && (
              <CycleDatesForm farm={farm} cycle={cycle} block={block} initial={{ cuttingsAt: s.dates.cuttingsAt, plantedAt: s.dates.plantedAt, plannedHarvestAt: s.dates.plannedHarvestAt, note: s.dates.note }} save={saveCycleAction} />
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile icon="leaf" label="Посажено" value={num(t.planted)} hint={source ? `пришло ${num(source)}, отход ${pct(source ? (loss * 100) / source : null, 1)}` : "черенкования не записано"} />
        <KpiTile icon="check" label="Срезано" value={num(t.harvested)} hint={t.harvested ? `${s.harvestByDay.length} дн. со срезом` : "срезки ещё не было"} />
        <KpiTile icon="chart" label="Выход" value={pct(t.yieldPct)} hint="срезано от посаженного" tone={t.yieldPct !== null && t.yieldPct >= 80 ? "good" : t.yieldPct !== null && t.yieldPct > 100 ? "warn" : undefined} />
        <KpiTile icon="trophy" label="Высшая + первая" value={pct(s.topShare)} hint="доля в срезке" />
        <KpiTile icon="chart" label="Средний вес" value={grams(t.avgWeight)} hint="стебля, по взвешенной срезке" />
        <KpiTile icon="alert" label={s.status === "done" ? "Не срезано" : "Ещё на блоке"} value={num(Math.max(0, t.remaining))} hint={t.wasteTotal ? `брак на блоке ${num(t.wasteTotal)} шт.` : "посажено − срезано"} />
      </div>

      {chartData.length > 0 && (
        <section className="card space-y-2">
          <SectionTitle title="Срезка по дням" hint={`${num(t.harvested)} шт. за ${s.harvestByDay.length} дн.`} />
          <GradeStackChart data={chartData} grades={s.grades} />
          <GradeLegend grades={s.grades} />
        </section>
      )}

      {/* Категории по сортам */}
      {t.harvested > 0 && (
        <section className="space-y-2">
          <SectionTitle title="Что срезали: категории по сортам" hint="Штуки и доля категорий в срезке сорта; вес — средний вес стебля по взвешенной срезке." />
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={TH}>Сорт</th>
                  <th className={clsx(TH, "text-right")}>Срезано</th>
                  {s.grades.map((g) => (
                    <th key={g} className={clsx(TH, "text-right whitespace-nowrap")}>
                      <span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: GRADE_COLORS[g] ?? "#bbb" }} />
                      {gradeShort(g)}
                    </th>
                  ))}
                  <th className={clsx(TH, "text-right")}>Высш.+1</th>
                  <th className={clsx(TH, "text-right")}>Вес</th>
                  <th className={clsx(TH, "w-32")}>Категории</th>
                </tr>
              </thead>
              <tbody>
                {s.varieties
                  .filter((v) => v.harvested > 0)
                  .map((v) => (
                    <tr key={v.variety} className={TR}>
                      <td className="px-4 py-2 whitespace-nowrap font-medium">{v.variety}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(v.harvested)}</td>
                      {s.grades.map((g) => (
                        <td key={g} className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                          {v.byGrade[g] ? (
                            <>
                              {num(v.byGrade[g])}
                              <span className="text-[11px] text-ink-muted ml-1">{Math.round((v.byGrade[g] * 100) / v.harvested)}%</span>
                            </>
                          ) : (
                            <span className="text-ink-muted">·</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right tabular-nums">{pct(v.harvested ? (TOP_GRADES.reduce((x, g) => x + (v.byGrade[g] ?? 0), 0) * 100) / v.harvested : null)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{grams(v.avgWeight)}</td>
                      <td className="px-4 py-2">
                        <GradeBar grades={HARVEST_GRADES.map((g) => ({ grade: g, qty: v.byGrade[g] ?? 0 })).filter((g) => g.qty > 0)} />
                      </td>
                    </tr>
                  ))}
                <tr className="bg-surface-plane/60 font-medium">
                  <td className="px-4 py-2">Итого</td>
                  <td className="px-4 py-2 text-right tabular-nums">{num(t.harvested)}</td>
                  {s.grades.map((g) => (
                    <td key={g} className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                      {num(t.byGrade[g])}
                      <span className="text-[11px] text-ink-muted ml-1">{Math.round(s.gradeShare[g] ?? 0)}%</span>
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right tabular-nums">{pct(s.topShare)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{grams(t.avgWeight)}</td>
                  <td className="px-4 py-2">
                    <GradeBar grades={HARVEST_GRADES.map((g) => ({ grade: g, qty: t.byGrade[g] ?? 0 })).filter((g) => g.qty > 0)} />
                  </td>
                </tr>
                {Object.keys(t.weightByGrade).length > 0 && (
                  <tr className="text-xs text-ink-secondary">
                    <td className="px-4 py-2">Вес стебля, г</td>
                    <td className="px-4 py-2" />
                    {s.grades.map((g) => (
                      <td key={g} className="px-4 py-2 text-right tabular-nums">
                        {t.weightByGrade[g] ? Math.round(t.weightByGrade[g]) : "—"}
                      </td>
                    ))}
                    <td colSpan={3} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Черенкование и посадка по сортам */}
      <section className="space-y-2">
        <SectionTitle title="Черенки и посадка по сортам" hint="Как лист книги «Данные по черенкованию по блокам»: что пришло, сколько ушло в брак и сколько посажено." />
        {hasCuttingsData ? (
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={TH}>Сорт</th>
                  <th className={clsx(TH, "text-right")}>Инвойс</th>
                  <th className={clsx(TH, "text-right")}>Факт</th>
                  <th className={clsx(TH, "text-right")}>% лишних</th>
                  <th className={clsx(TH, "text-right")}>С маточника</th>
                  <th className={clsx(TH, "text-right")}>Брак отд.</th>
                  <th className={clsx(TH, "text-right")}>Брак расс.</th>
                  <th className={clsx(TH, "text-right")}>Тех брак</th>
                  <th className={clsx(TH, "text-right")}>Выбраковка</th>
                  <th className={clsx(TH, "text-right")}>Посажено</th>
                  <th className={clsx(TH, "text-right")}>Срезано</th>
                  <th className={clsx(TH, "text-right")}>Остаток</th>
                  <th className={clsx(TH, "w-28")}>Выход</th>
                </tr>
              </thead>
              <tbody>
                {s.varieties.map((v) => (
                  <tr key={v.variety} className={TR}>
                    <td className="px-4 py-2 whitespace-nowrap font-medium">{v.variety}</td>
                    <Num v={v.invoice} />
                    <Num v={v.actual} />
                    <td className="px-4 py-2 text-right tabular-nums">{v.extraPct !== null ? pct(v.extraPct - 100, 1) : <span className="text-ink-muted">·</span>}</td>
                    <Num v={v.fromStock} />
                    <Num v={v.deptCull} bad />
                    <Num v={v.nurseryCull} bad />
                    <Num v={v.techCull} bad />
                    <Num v={v.cull} bad />
                    <Num v={v.planted} strong />
                    <Num v={v.harvested} strong />
                    <td className={clsx("px-4 py-2 text-right tabular-nums", v.remaining < 0 && "text-[#a12b2b]")}>{num(v.remaining)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <YieldBar value={v.yieldPct} className="flex-1 min-w-[2.5rem]" />
                        <span className="text-[11px] tabular-nums w-9 text-right">{v.yieldPct !== null ? `${Math.round(v.yieldPct)}%` : "—"}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-plane/60 font-medium">
                  <td className="px-4 py-2">Итого</td>
                  <Num v={t.invoice} />
                  <Num v={t.actual} />
                  <td className="px-4 py-2 text-right tabular-nums">{t.extraPct !== null ? pct(t.extraPct - 100, 1) : "—"}</td>
                  <Num v={t.fromStock} />
                  <Num v={t.deptCull} bad />
                  <Num v={t.nurseryCull} bad />
                  <Num v={t.techCull} bad />
                  <Num v={t.cull} bad />
                  <Num v={t.planted} strong />
                  <Num v={t.harvested} strong />
                  <td className="px-4 py-2 text-right tabular-nums">{num(t.remaining)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-xs">{pct(t.yieldPct)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card text-sm text-ink-secondary">
            Черенкование по этому блоку не записано — посажено считать не из чего.{" "}
            <Link className="underline" href={ghHref("/greenhouse/cuttings", farm, { cycle, block })}>
              Записать черенкование
            </Link>
          </div>
        )}
      </section>

      {wasteKinds.length > 0 && (
        <section className="space-y-2">
          <SectionTitle title="Брак на блоке" hint="Повилика, клещ, тля и прочее — из журнала брака; тех брак входит в расчёт посадки." />
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={TH}>Сорт</th>
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
                {s.varieties
                  .filter((v) => v.wasteTotal > 0)
                  .sort((a, b) => b.wasteTotal - a.wasteTotal)
                  .map((v) => (
                    <tr key={v.variety} className={TR}>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{v.variety}</td>
                      {wasteKinds.map((k) => (
                        <Num key={k.code} v={v.wasteByKind[k.code] ?? 0} />
                      ))}
                      <Num v={v.wasteTotal} strong />
                      <td className="px-4 py-2 text-right tabular-nums">{pct(v.planted ? (v.wasteTotal * 100) / v.planted : null, 1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {history.length > 1 && (
        <section className="space-y-2">
          <SectionTitle title={`${blockName} во всех циклах`} hint="Лучше или хуже этот блок, чем в прошлые разы." />
          <div className="card !p-0 overflow-hidden">
            <table className="w-full text-sm table-cards">
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={TH}>Цикл</th>
                  <th className={clsx(TH, "hidden sm:table-cell")}>Посадка</th>
                  <th className={clsx(TH, "text-right")}>Посажено</th>
                  <th className={clsx(TH, "text-right")}>Срезано</th>
                  <th className={clsx(TH, "w-40")}>Выход</th>
                  <th className={clsx(TH, "text-right")}>Высш.+1</th>
                  <th className={clsx(TH, "text-right")}>Вес</th>
                  <th className={clsx(TH, "w-32 hidden md:table-cell")}>Категории</th>
                </tr>
              </thead>
              <tbody>
                {history.map(({ cycle: c, b }) => (
                  <tr key={c} className={clsx(TR, c === cycle && "bg-section-greenhouse-soft/60")}>
                    <td className="px-4 py-2">
                      <Link href={href(c, block)} className="font-display font-bold hover:underline">
                        Цикл {c}
                      </Link>
                      <StatusChip status={b.status} label={b.statusLabel} className="ml-2" />
                    </td>
                    <td data-label="Посадка" className="px-4 py-2 hidden sm:table-cell text-ink-secondary">
                      {dm(b.plantedAt, year)}
                    </td>
                    <td data-label="Посажено" className="px-4 py-2 text-right tabular-nums">
                      {num(b.planted)}
                    </td>
                    <td data-label="Срезано" className="px-4 py-2 text-right tabular-nums">
                      {num(b.harvested)}
                    </td>
                    <td data-label="Выход" className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <YieldBar value={b.yieldPct} className="flex-1 min-w-[3rem]" />
                        <span className="tabular-nums text-xs w-11 text-right">{pct(b.yieldPct)}</span>
                      </div>
                    </td>
                    <td data-label="Высш.+1" className="px-4 py-2 text-right tabular-nums">
                      {pct(b.topShare)}
                    </td>
                    <td data-label="Вес" className="px-4 py-2 text-right tabular-nums">
                      {grams(b.avgWeight)}
                    </td>
                    <td data-label="Категории" className="px-4 py-2 hidden md:table-cell">
                      <GradeBar grades={b.grades} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <Link className="underline" href={ghHref("/greenhouse/harvest", farm, { cycle, block })}>
          Записи срезки блока
        </Link>
        <Link className="underline" href={ghHref("/greenhouse/cuttings", farm, { cycle, block })}>
          Черенкование блока
        </Link>
        <Link className="underline" href={ghHref("/greenhouse/waste", farm, { cycle, block })}>
          Брак блока
        </Link>
      </div>
    </div>
  );
}

function Num({ v, bad, strong }: { v: number; bad?: boolean; strong?: boolean }) {
  return (
    <td className={clsx("px-4 py-2 text-right tabular-nums", strong && "font-medium", bad && v > 0 && "text-[#a12b2b]")}>{v ? num(v) : <span className="text-ink-muted">·</span>}</td>
  );
}

function TimelineStep({ label, date, done, note, after, afterLabel }: { label: string; date: string; done: boolean; note?: string; after?: number | null; afterLabel?: string }) {
  return (
    <div className={clsx("rounded-xl px-3 py-2.5 border", done ? "border-section-greenhouse/25 bg-section-greenhouse-soft/70" : "border-dashed border-line-hairline")}>
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className={clsx("font-display font-bold text-[16px] tabular-nums", !done && "text-ink-secondary")}>{date}</div>
      {note && <div className="text-[11px] text-ink-secondary">{note}</div>}
      {after !== undefined && after !== null && after >= 0 && (
        <div className="text-[11px] text-ink-secondary">
          {after} дн. {afterLabel}
        </div>
      )}
    </div>
  );
}
