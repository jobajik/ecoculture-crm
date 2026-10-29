import Link from "next/link";
import clsx from "clsx";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import GradeStackChart from "@/components/greenhouse/GradeStackChart";
import CycleDatesForm from "@/components/greenhouse/CycleDatesForm";
import CycleSelect from "@/components/greenhouse/CycleSelect";
import { GradeBar, GradeLegend, SectionTitle, StatusChip, YieldBar, dm, gradeShort, grams, num, pct } from "@/components/greenhouse/parts";
import { Delta, GradeList, QualityRows } from "@/components/greenhouse/rank";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { BLOCK_STATUS_LABELS, HARVEST_GRADES, TOP_GRADES, WASTE_KINDS, blockSource, cycleOf, summarizeBlock } from "@/lib/greenhouse/production";
import { compareBlocks } from "@/lib/payroll/work";
import { GRADE_COLORS, QUALITY_COLORS, QUALITY_GROUPS, nowByBlock, pointsDelta, qualityOf, qualitySplit, saneYield, type CycleOption } from "@/lib/greenhouse/views";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
import { greenhouseTabsFor } from "../../../tabs";
import { saveCycleAction } from "../../../actions";

export const dynamic = "force-dynamic";

/**
 * Блок в цикле (29.10.2026, после «убери шум»): сверху — путь блока по датам и главное число (выход и качество к
 * прошлому циклу этого блока), ниже — срезка по дням тремя группами качества и сорта одной полосой. Подробные таблицы
 * книги («категории по сортам», «черенки и посадка», «брак») свёрнуты — открываются, когда нужны. Цикл блока —
 * выбор списком в шапке.
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
  const prevBlock = idx > 0 ? blocksOfCycle[idx - 1] : null;
  const nextBlock = idx >= 0 && idx < blocksOfCycle.length - 1 ? blocksOfCycle[idx + 1] : null;
  const href = (c: number, b: string) => ghHref(`/greenhouse/cycles/${c}/${encodeURIComponent(b)}`, farm);
  // Этот блок во всех циклах.
  const history = cycles
    .map((c) => ({ cycle: c.cycle, b: c.blocks.find((x) => x.block === block) }))
    .filter((x): x is { cycle: number; b: NonNullable<typeof x.b> } => !!x.b)
    .sort((a, b) => b.cycle - a.cycle);
  const nowCycle = nowByBlock(cycles).find((b) => b.block === block)?.cycle;
  const options: CycleOption[] = history.map((h) => ({
    cycle: h.cycle,
    phase: "done",
    current: h.cycle === nowCycle,
    label: `Цикл ${h.cycle} — ${h.b.statusLabel}${h.cycle === nowCycle ? " · текущий" : ""}`,
  }));
  const optionHrefs = Object.fromEntries(history.map((h) => [h.cycle, href(h.cycle, block)]));
  const prevDone = history.find((h) => h.cycle < cycle && h.b.status === "done" && h.b.harvested > 0)?.b ?? null;

  // Срезка по дням — тремя группами качества.
  const dayMap = new Map<string, Record<string, number>>();
  for (const h of data.harvest) {
    if (h.cycle !== cycle || h.block !== block) continue;
    const d = dayMap.get(h.date) ?? {};
    const label = QUALITY_GROUPS.find((q) => q.key === qualityOf(h.grade))!.label;
    d[label] = (d[label] ?? 0) + h.qty;
    dayMap.set(h.date, d);
  }
  const chartData = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, g]) => ({ label: dm(date), ...g }));
  const groups = QUALITY_GROUPS.map((q) => q.label);
  const blockGrades = HARVEST_GRADES.map((g) => ({ grade: g, qty: t.byGrade[g] ?? 0 })).filter((g) => g.qty > 0);
  const quality = qualitySplit(blockGrades);

  const source = blockSource(s);
  const loss = t.deptCull + t.nurseryCull + t.techCull + t.cull;
  const delay = s.firstHarvestAt && s.expectedHarvestAt ? Math.round((Date.parse(s.firstHarvestAt) - Date.parse(s.expectedHarvestAt)) / 86400000) : null;
  const days = (a: string, b: string) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null);
  const wasteKinds = WASTE_KINDS.filter((k) => k.code !== "tech" && (t.wasteByKind[k.code] ?? 0) > 0);
  const hasCuttingsData = s.varieties.some((v) => v.invoice || v.actual || v.fromStock);
  const yieldNow = saneYield(t.yieldPct);
  const varietiesCut = s.varieties.filter((v) => v.harvested > 0);
  const maxCut = Math.max(...varietiesCut.map((v) => v.harvested), 1);

  return (
    <div className="space-y-5">
      <PageHeader
        area="greenhouse"
        title={blockName}
        subtitle={FARM_LABELS[farm] ?? farm}
        icon="leaf"
        tabs={greenhouseTabsFor(scope, farm)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CycleSelect options={options} value={cycle} hrefs={optionHrefs} />
            <div className="flex items-center gap-1">
              {prevBlock && (
                <Link href={href(cycle, prevBlock)} className="btn-secondary !py-1.5 !px-3" title="Предыдущий блок цикла">
                  ‹ {prevBlock}
                </Link>
              )}
              {nextBlock && (
                <Link href={href(cycle, nextBlock)} className="btn-secondary !py-1.5 !px-3" title="Следующий блок цикла">
                  {nextBlock} ›
                </Link>
              )}
            </div>
          </div>
        }
      />

      {/* Путь блока */}
      <section className="card !p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={s.status} label={BLOCK_STATUS_LABELS[s.status]} />
          <span className="text-xs text-ink-muted">
            цикл {cycle} ·{" "}
            <Link href={ghHref("/greenhouse", farm, { cycle })} className="hover:underline">
              все блоки цикла
            </Link>
          </span>
          {scope.editsLogs && (
            <span className="ml-auto">
              <CycleDatesForm farm={farm} cycle={cycle} block={block} initial={{ cuttingsAt: s.dates.cuttingsAt, plantedAt: s.dates.plantedAt, plannedHarvestAt: s.dates.plannedHarvestAt, note: s.dates.note }} save={saveCycleAction} />
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <TimelineStep label="Черенкование" date={dm(s.dates.cuttingsAt, year)} done={!!s.dates.cuttingsAt} after={days(s.dates.cuttingsAt, s.dates.plantedAt)} afterLabel="до посадки" />
          <TimelineStep label="Посадка" date={dm(s.dates.plantedAt, year)} done={!!s.dates.plantedAt} after={days(s.dates.plantedAt, s.firstHarvestAt || "")} afterLabel="до первой срезки" />
          <TimelineStep
            label={s.firstHarvestAt ? "Первая срезка" : s.expectedIsEstimate ? "Срезка ≈ (посадка + 76 дн.)" : "Срезка по плану"}
            date={s.firstHarvestAt ? dm(s.firstHarvestAt, year) : dm(s.expectedHarvestAt, year)}
            done={!!s.firstHarvestAt}
            note={s.firstHarvestAt && s.expectedHarvestAt ? (delay === 0 ? "день в день с планом" : `${delay! > 0 ? "+" : ""}${delay} дн. к плану`) : undefined}
          />
          <TimelineStep
            label={s.status === "harvest" ? "Последняя срезка" : "Срезка закончена"}
            date={dm(s.lastHarvestAt, year)}
            done={!!s.lastHarvestAt && s.status === "done"}
            note={s.firstHarvestAt && s.lastHarvestAt ? `${s.harvestByDay.length} дн. со срезом` : undefined}
          />
        </div>
        {s.dates.note && <div className="text-xs text-ink-secondary">{s.dates.note}</div>}
      </section>

      {/* Главное число */}
      <section className="card !p-5">
        {t.harvested > 0 ? (
          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5 items-end">
            <div>
              <div className="text-sm text-ink-secondary">
                Срезано <b className="text-ink-primary">{num(t.harvested)}</b> из <b className="text-ink-primary">{num(t.planted)}</b> посаженных
                {s.status === "harvest" ? " — срезка ещё идёт" : ""}
              </div>
              <div className="flex items-end gap-3 mt-1">
                <span className="font-display font-extrabold text-[40px] leading-none tabular-nums">{yieldNow !== null ? `${Math.round(yieldNow)} %` : "—"}</span>
                <span className="text-sm text-ink-muted pb-1">выход</span>
                {prevDone && s.status === "done" && (
                  <span className="pb-1">
                    <Delta value={pointsDelta(yieldNow, saneYield(prevDone.yieldPct))} /> <span className="text-xs text-ink-muted">к циклу {prevDone.cycle}</span>
                  </span>
                )}
              </div>
              <YieldBar value={yieldNow} className="mt-3 !h-2.5" />
              <div className="text-xs text-ink-muted mt-2">
                {source ? `Пришло черенков ${num(source)}, в посадку не пошло ${num(loss)} (${pct((loss * 100) / source, 1)}).` : "Черенкование по блоку не записано."}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {prevDone && <div className="col-span-3 -mb-1 text-[11px] text-ink-muted">Стрелки — к циклу {prevDone.cycle}, когда этот блок резали в прошлый раз.</div>}
              <MiniStat label="Высшая и 1-я" value={pct(s.topShare)} delta={prevDone ? pointsDelta(s.topShare, prevDone.topShare) : null} />
              <MiniStat label="Вес стебля" value={grams(t.avgWeight)} delta={prevDone ? pointsDelta(t.avgWeight, prevDone.avgWeight) : null} unit="г" />
              <MiniStat label={s.status === "done" ? "Не срезано" : "Ещё на блоке"} value={num(Math.max(0, t.remaining))} />
            </div>
          </div>
        ) : (
          <div className="text-sm text-ink-secondary">
            Посажено <b className="text-ink-primary">{num(t.planted)}</b>
            {source ? ` из ${num(source)} пришедших черенков` : ""} — срезки ещё не было.
          </div>
        )}
      </section>

      {t.harvested > 0 && (
        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-5 items-start">
          <section className="card !p-5 space-y-4">
            <h3 className="font-display font-bold text-[16px]">Качество срезки</h3>
            <QualityRows split={quality} total={t.harvested} />
            <details>
              <summary className="cursor-pointer text-ink-secondary text-xs">Все категории</summary>
              <div className="mt-2">
                <GradeList grades={blockGrades} />
              </div>
            </details>
          </section>
          <section className="card !p-5 space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="font-display font-bold text-[16px]">Срезка по дням</h3>
              <span className="text-xs text-ink-muted">{s.harvestByDay.length} дн. со срезом</span>
            </div>
            <GradeStackChart data={chartData} grades={groups} colors={QUALITY_COLORS} height={220} />
            <GradeLegend grades={groups} colors={QUALITY_COLORS} />
          </section>
        </div>
      )}

      {varietiesCut.length > 0 && (
        <section className="card !p-5 space-y-3">
          <div className="flex items-baseline gap-2">
            <h3 className="font-display font-bold text-[16px]">Сорта блока</h3>
            <span className="text-xs text-ink-muted">срезка и её качество · справа — выход</span>
          </div>
          <ul className="space-y-1">
            {varietiesCut.map((v) => {
              const q = qualitySplit(HARVEST_GRADES.map((g) => ({ grade: g, qty: v.byGrade[g] ?? 0 })));
              return (
                <li key={v.variety} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] sm:grid-cols-[10rem_1fr_6rem_5rem] items-center gap-3 py-1 text-sm">
                  <span className="truncate">{v.variety}</span>
                  <span className="h-2.5 rounded-full bg-surface-sunk overflow-hidden">
                    <span className="flex h-full" style={{ width: `${(v.harvested * 100) / maxCut}%` }}>
                      {q.map((x) => (
                        <span key={x.key} style={{ width: `${x.pct}%`, background: x.color }} title={`${x.label}: ${Math.round(x.pct)} %`} />
                      ))}
                    </span>
                  </span>
                  <span className="text-right tabular-nums font-medium">{num(v.harvested)}</span>
                  <span className="hidden sm:block text-right text-xs text-ink-muted">{saneYield(v.yieldPct) !== null ? `${Math.round(v.yieldPct!)} %` : "—"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="space-y-3">
      {/* Категории по сортам */}
      {t.harvested > 0 && (
        <details className="card !p-0 overflow-hidden">
          <summary className="cursor-pointer px-5 py-3.5 flex flex-wrap items-baseline gap-x-2 list-none [&::-webkit-details-marker]:hidden">
            <span className="text-ink-muted text-xs">▸</span>
            <span className="font-display font-bold text-[15px]">Все категории по сортам</span>
            <span className="text-xs text-ink-muted">Штуки и доля категорий в срезке сорта; вес — средний вес стебля по взвешенной срезке.</span>
          </summary>
          <div className="overflow-x-auto border-t border-line-hairline">
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
        </details>
      )}

      {/* Черенкование и посадка по сортам */}
      <details className="card !p-0 overflow-hidden">
          <summary className="cursor-pointer px-5 py-3.5 flex flex-wrap items-baseline gap-x-2 list-none [&::-webkit-details-marker]:hidden">
            <span className="text-ink-muted text-xs">▸</span>
            <span className="font-display font-bold text-[15px]">Черенки и посадка по сортам</span>
            <span className="text-xs text-ink-muted">Как лист книги «Данные по черенкованию по блокам»: что пришло, сколько ушло в брак и сколько посажено.</span>
          </summary>
        {hasCuttingsData ? (
          <div className="overflow-x-auto border-t border-line-hairline">
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
          <div className="px-5 pb-4 text-sm text-ink-secondary">
            Черенкование по этому блоку не записано — посажено считать не из чего.{" "}
            <Link className="underline" href={ghHref("/greenhouse/cuttings", farm, { cycle, block })}>
              Записать черенкование
            </Link>
          </div>
        )}
      </details>

      {wasteKinds.length > 0 && (
        <details className="card !p-0 overflow-hidden">
          <summary className="cursor-pointer px-5 py-3.5 flex flex-wrap items-baseline gap-x-2 list-none [&::-webkit-details-marker]:hidden">
            <span className="text-ink-muted text-xs">▸</span>
            <span className="font-display font-bold text-[15px]">Брак на блоке</span>
            <span className="text-xs text-ink-muted">Повилика, клещ, тля и прочее — из журнала брака; тех брак входит в расчёт посадки.</span>
          </summary>
          <div className="overflow-x-auto border-t border-line-hairline">
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
        </details>
      )}

      </div>

      {history.length > 1 && (
        <section className="card !p-5 space-y-3">
          <div className="flex items-baseline gap-2">
            <h3 className="font-display font-bold text-[16px]">{blockName} в прошлых циклах</h3>
            <span className="text-xs text-ink-muted">лучше или хуже, чем раньше</span>
          </div>
          <ul className="space-y-1">
            {history.map(({ cycle: c, b }) => {
              const y = saneYield(b.yieldPct);
              return (
                <li key={c}>
                  <Link href={href(c, block)} className={clsx("grid grid-cols-[5rem_1fr_3.5rem] sm:grid-cols-[6rem_1fr_3.5rem_7rem_6rem] items-center gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-surface-plane text-sm", c === cycle && "bg-section-greenhouse-soft/70")}>
                    <span className="font-medium">Цикл {c}</span>
                    {y !== null ? <YieldBar value={y} /> : <span className="text-xs text-ink-muted">{b.statusLabel}</span>}
                    <span className="text-right tabular-nums font-display font-bold">{y !== null ? `${Math.round(y)} %` : ""}</span>
                    <span className="hidden sm:block text-right text-xs text-ink-muted">{b.topShare !== null ? `высш. и 1-я ${Math.round(b.topShare)} %` : ""}</span>
                    <span className="hidden sm:block text-right text-xs text-ink-muted">{b.harvested ? `${num(b.harvested)} шт.` : ""}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
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

function MiniStat({ label, value, delta, unit = "п.", invert }: { label: string; value: string; delta?: number | null; unit?: string; invert?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="font-display font-extrabold text-[20px] tabular-nums leading-tight">{value}</div>
      {delta !== undefined && <Delta value={delta} unit={unit} invert={invert} />}
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
