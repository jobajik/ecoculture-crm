import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import GhImportPanel from "@/components/greenhouse/GhImportPanel";
import CycleSelect from "@/components/greenhouse/CycleSelect";
import { StatusChip, YieldBar, dm, grams, num, pct } from "@/components/greenhouse/parts";
import { Delta, GradeList, QualityRows, RankList } from "@/components/greenhouse/rank";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { CYCLE_PHASE_LABELS, cycleOptions, cyclePhase, defaultCycle, nowByBlock, pointsDelta, previousFinished, qualitySplit, rankBlocks, rankVarieties, saneYield, type BlockCard } from "@/lib/greenhouse/views";
import { greenhouseTabsFor } from "./tabs";
import { importCyclesAction, importLogRowsAction, listLogIdsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * «Теплица» (29.10.2026, владелец после первой версии: «акцент на циклах, неудобный вид по категориям, убери шум,
 * сделай проще и интереснее»). Цикл — выбор списком в шапке (по умолчанию текущий, тот, что режется). Сверху одной
 * карточкой — что сейчас в теплице; ниже — выбранный цикл: сколько срезали из посаженного и как к прошлому циклу,
 * качество тремя группами, рейтинг блоков и сортов. Сравнение циклов и блоков между собой — во вкладке «Аналитика».
 */
export default async function GreenhousePage({ searchParams }: { searchParams?: { farm?: string; cycle?: string } }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, cycles, rows } = p;
  const year = today.slice(0, 4);
  const options = cycleOptions(cycles);
  const asked = Number(searchParams?.cycle);
  const selectedNo = cycles.some((c) => c.cycle === asked) ? asked : defaultCycle(cycles);
  const hrefs = Object.fromEntries(cycles.map((c) => [c.cycle, ghHref("/greenhouse", farm, { cycle: c.cycle })]));

  const header = (
    <PageHeader
      area="greenhouse"
      title="Теплица"
      subtitle={FARM_LABELS[farm] ?? farm}
      icon="leaf"
      tabs={greenhouseTabsFor(scope, farm)}
      actions={
        scope && (
          <>
            {cycles.length > 0 && <CycleSelect options={options} value={selectedNo} hrefs={hrefs} />}
            <GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref("/greenhouse", f)} />
          </>
        )
      }
    />
  );
  if (!scope)
    return (
      <div className="space-y-5">
        {header}
        <div className="card text-sm text-ink-secondary">{GREENHOUSE_NO_ACCESS}</div>
      </div>
    );
  const importPanel = (open = false, label?: string) =>
    scope.editsLogs ? <GhImportPanel farm={farm} today={today} open={open} label={label} listIds={listLogIdsAction} importRows={importLogRowsAction} importCycles={importCyclesAction} /> : null;

  if (!cycles.length)
    return (
      <div className="space-y-5">
        {header}
        <div className="card space-y-2">
          <div className="font-display font-extrabold text-[17px]">Данных по теплице пока нет</div>
          <p className="text-sm text-ink-secondary">Загрузите книгу агронома — срезка, черенкование, брак и даты лягут сюда сами. Дальше записи ведутся на сайте.</p>
        </div>
        {importPanel(true)}
      </div>
    );

  const c = cycles.find((x) => x.cycle === selectedNo)!;
  const row = rows.find((r) => r.cycle === selectedNo)!;
  const phase = cyclePhase(c);
  const isCurrent = options.find((o) => o.cycle === c.cycle)?.current ?? false;
  const prev = previousFinished(cycles, c.cycle);
  const quality = qualitySplit(c.grades);
  const prevQuality = prev ? qualitySplit(prev.grades) : null;
  const blocks = rankBlocks([c]);
  const varieties = rankVarieties([row], 500);
  const blockHref = (b: { cycle: number; block: string }) => ghHref(`/greenhouse/cycles/${b.cycle}/${encodeURIComponent(b.block)}`, farm);
  const lossPct = c.cullPct;
  const firstHarvest = c.blocks.map((b) => b.firstHarvestAt).filter(Boolean).sort()[0] ?? "";
  const yieldNow = saneYield(c.yieldPct);

  return (
    <div className="space-y-6">
      {header}

      <NowCard cycles={cycles} year={year} blockHref={blockHref} action={importPanel(false, "Загрузить книгу")} />

      {/* Выбранный цикл — главное */}
      <section className="card !p-5 space-y-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-display font-extrabold text-[20px]">Цикл {c.cycle}</h2>
          <span className={clsx("text-xs rounded-full px-2.5 py-0.5 border", phase === "harvest" ? "bg-[#e6f4ea] text-[#1f6b3a] border-[#1f6b3a]/20" : "bg-surface-sunk text-ink-secondary border-line-hairline")}>
            {CYCLE_PHASE_LABELS[phase]}
            {isCurrent ? " · текущий" : ""}
          </span>
          <span className="text-xs text-ink-muted">
            {[c.firstCuttingsAt && `черенкование с ${dm(c.firstCuttingsAt, year)}`, firstHarvest && `срезка с ${dm(firstHarvest, year)}`, phase === "done" && c.lastHarvestAt && `по ${dm(c.lastHarvestAt, year)}`].filter(Boolean).join(" · ")}
          </span>
        </div>

        {c.harvested > 0 ? (
          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5 items-end">
            <div>
              <div className="text-sm text-ink-secondary">
                Срезано <b className="text-ink-primary">{num(c.harvested)}</b> из <b className="text-ink-primary">{num(c.planted)}</b> посаженных
                {phase === "harvest" ? " — срезка ещё идёт" : ""}
              </div>
              <div className="flex items-end gap-3 mt-1">
                <span className="font-display font-extrabold text-[44px] leading-none tabular-nums">{yieldNow !== null ? `${Math.round(yieldNow)} %` : "—"}</span>
                <span className="text-sm text-ink-muted pb-1">выход</span>
                {prev && phase === "done" && (
                  <span className="pb-1">
                    <Delta value={pointsDelta(yieldNow, saneYield(prev.yieldPct))} /> <span className="text-xs text-ink-muted">к циклу {prev.cycle}</span>
                  </span>
                )}
              </div>
              <YieldBar value={yieldNow} className="mt-3 !h-2.5" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Высшая и 1-я" value={pct(c.topShare)} delta={prev ? pointsDelta(c.topShare, prev.topShare) : null} />
              <MiniStat label="Вес стебля" value={grams(c.avgWeight)} delta={prev ? pointsDelta(c.avgWeight, prev.avgWeight) : null} unit="г" />
              <MiniStat label="Отход при посадке" value={pct(lossPct, 1)} delta={prev ? pointsDelta(lossPct, prev.cullPct) : null} invert />
            </div>
          </div>
        ) : (
          <div className="text-sm text-ink-secondary">
            Посажено <b className="text-ink-primary">{num(c.planted)}</b> — срезки ещё не было.
          </div>
        )}
        {prev && c.harvested > 0 && <div className="text-[11px] text-ink-muted -mt-2">Стрелки — к прошлому завершённому циклу ({prev.cycle}).</div>}
      </section>

      {c.harvested > 0 && (
        <div className="grid lg:grid-cols-[1fr_1.3fr] gap-5 items-start">
          <section className="card !p-5 space-y-4">
            <h3 className="font-display font-bold text-[16px]">Качество срезки</h3>
            <QualityRows split={quality} prev={phase === "done" ? prevQuality : null} total={c.harvested} />
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-secondary text-xs">Все категории</summary>
              <div className="mt-2">
                <GradeList grades={c.grades} />
              </div>
            </details>
          </section>
          <section className="card !p-5 space-y-3">
            <div className="flex items-baseline gap-2">
              <h3 className="font-display font-bold text-[16px]">Блоки по выходу</h3>
              <span className="text-xs text-ink-muted">срезано из посаженного</span>
            </div>
            <RankList rows={blocks} metric="yield" href={(r) => blockHref({ cycle: c.cycle, block: r.key })} extra={(r) => (r.topShare !== null ? `высш. и 1-я ${Math.round(r.topShare)} %` : "")} />
          </section>
        </div>
      )}

      {varieties.length > 0 && (
        <section className="card !p-5 space-y-3">
          <div className="flex items-baseline gap-2">
            <h3 className="font-display font-bold text-[16px]">Сорта цикла</h3>
            <span className="text-xs text-ink-muted">по объёму срезки</span>
          </div>
          <VarietyTable rows={varieties} />
        </section>
      )}

      <div className="text-sm">
        <Link href={ghHref("/greenhouse/analytics", farm)} className="underline">
          Сравнить циклы, блоки и сорта →
        </Link>
      </div>
    </div>
  );
}

function MiniStat({ label, value, delta, unit = "п.", invert }: { label: string; value: string; delta: number | null; unit?: string; invert?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="font-display font-extrabold text-[22px] tabular-nums leading-tight">{value}</div>
      <Delta value={delta} unit={unit} invert={invert} />
    </div>
  );
}

/** «Сейчас в теплице» — три строки словами вместо пятнадцати плиток. */
function NowCard({ cycles, year, blockHref, action }: { cycles: Parameters<typeof nowByBlock>[0]; year: string; blockHref: (b: BlockCard) => string; action: React.ReactNode }) {
  const now = nowByBlock(cycles);
  // Режется — по всем циклам: блок уже пересажен под новый цикл, а старый ещё дорезают.
  const cutting = cycles.flatMap((c) => c.blocks.filter((b) => b.status === "harvest"));
  const growing = now.filter((b) => b.status === "growing").sort((a, b) => (a.daysToHarvest ?? 999) - (b.daysToHarvest ?? 999));
  const starting = now.filter((b) => b.status === "cuttings" || b.status === "planned");
  const next = growing[0];
  const name = (b: BlockCard) => (/^\d+$/.test(b.block) ? b.block : b.block);
  const links = (list: BlockCard[]) =>
    list.map((b, i) => (
      <span key={`${b.cycle}-${b.block}`}>
        {i > 0 && ", "}
        <Link href={blockHref(b)} className="hover:underline">
          {name(b)}
        </Link>
      </span>
    ));
  return (
    <section className="card !p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="space-y-2 text-sm flex-1 min-w-[16rem]">
          <div className="font-display font-bold text-[15px]">Сейчас в теплице</div>
          {cutting.length > 0 && (
            <div className="flex gap-2">
              <StatusChip status="harvest" label="срезка" className="flex-none" />
              <span>
                {cutting.length === 1 ? "блок" : "блоки"} {links(cutting)}
                <span className="text-ink-muted"> (цикл {Array.from(new Set(cutting.map((b) => b.cycle))).join(", ")})</span>
                <span className="text-ink-muted"> · срезано {num(cutting.reduce((s, b) => s + b.harvested, 0))}</span>
              </span>
            </div>
          )}
          {growing.length > 0 && (
            <div className="flex gap-2">
              <StatusChip status="growing" label="растут" className="flex-none" />
              <span>
                {growing.length} {growing.length === 1 ? "блок" : growing.length < 5 ? "блока" : "блоков"}
                {next && next.expectedHarvestAt && (
                  <span className="text-ink-muted">
                    {" "}
                    · первым начнёт резаться блок{" "}
                    <Link href={blockHref(next)} className="hover:underline text-ink-primary">
                      {name(next)}
                    </Link>{" "}
                    — {next.expectedIsEstimate ? "≈ " : ""}
                    {dm(next.expectedHarvestAt, year)}
                    {next.daysToHarvest !== null && next.daysToHarvest > 0 ? `, через ${next.daysToHarvest} дн.` : ""}
                  </span>
                )}
              </span>
            </div>
          )}
          {starting.length > 0 && (
            <div className="flex gap-2">
              <StatusChip status="cuttings" label="черенкование" className="flex-none" />
              <span>
                {starting.length === 1 ? "блок" : "блоки"} {links(starting)}
              </span>
            </div>
          )}
        </div>
        {action}
      </div>
    </section>
  );
}

function VarietyTable({ rows }: { rows: ReturnType<typeof rankVarieties> }) {
  const list = [...rows].sort((a, b) => b.harvested - a.harvested).slice(0, 10);
  const max = Math.max(...list.map((r) => r.harvested), 1);
  return (
    <ul className="space-y-1">
      {list.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] sm:grid-cols-[11rem_1fr_6rem_8rem] items-center gap-3 py-1 text-sm">
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 rounded-full bg-surface-sunk overflow-hidden">
            <span className="flex h-full" style={{ width: `${(r.harvested * 100) / max}%` }}>
              {r.quality.map((q) => (
                <span key={q.key} style={{ width: `${q.pct}%`, background: q.color }} title={`${q.label}: ${Math.round(q.pct)} %`} />
              ))}
            </span>
          </span>
          <span className="text-right tabular-nums font-medium">{num(r.harvested)}</span>
          <span className="hidden sm:block text-right text-xs text-ink-muted">{r.yieldPct !== null ? `выход ${Math.round(r.yieldPct)} %` : r.note}</span>
        </li>
      ))}
      <li className="pt-1 text-[11px] text-ink-muted flex flex-wrap gap-x-3">
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-[#2f8a55] mr-1" />
          высшая и 1-я
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-[#e2c14a] mr-1" />
          2-я и 3-я
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-[#d9826b] mr-1" />
          4-я, мини и брак
        </span>
      </li>
    </ul>
  );
}
