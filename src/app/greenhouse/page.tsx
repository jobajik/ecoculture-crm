import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import GhImportPanel from "@/components/greenhouse/GhImportPanel";
import { GradeBar, GradeLegend, SectionTitle, Stat, StatusChip, YieldBar, dm, grams, num, pct } from "@/components/greenhouse/parts";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { BLOCK_STATUS_LABELS, HARVEST_GRADES, type BlockStatus } from "@/lib/greenhouse/production";
import { defaultCycle, nowByBlock, type BlockCard, type CycleCard } from "@/lib/greenhouse/views";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
import { greenhouseTabsFor } from "./tabs";
import { importCyclesAction, importLogRowsAction, listLogIdsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * «Теплица» — циклы и блоки (29.10.2026, владелец: «не вижу аналитику поблочно с циклами»). Сверху — что сейчас
 * в каждом блоке; ниже — выбранный цикл блоками (даты, посажено, срезано, выход, категории); внизу — все циклы
 * одной таблицей. Всё считается из журналов (`production.ts`), отдельно ничего не хранится.
 */
export default async function GreenhouseCyclesPage({ searchParams }: { searchParams?: { farm?: string; cycle?: string } }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, cycles } = p;
  const year = today.slice(0, 4);
  const header = (children?: React.ReactNode) => (
    <PageHeader
      area="greenhouse"
      title="Теплица"
      subtitle={`Циклы и блоки · ${FARM_LABELS[farm] ?? farm}`}
      icon="leaf"
      tabs={greenhouseTabsFor(scope, farm)}
      actions={scope && <GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref("/greenhouse", f)} />}
    >
      {children}
    </PageHeader>
  );
  if (!scope)
    return (
      <div className="space-y-5">
        {header()}
        <div className="card text-sm text-ink-secondary">{GREENHOUSE_NO_ACCESS}</div>
      </div>
    );

  const importPanel = (open = false) =>
    scope.editsLogs ? <GhImportPanel farm={farm} today={today} open={open} listIds={listLogIdsAction} importRows={importLogRowsAction} importCycles={importCyclesAction} /> : null;

  if (!cycles.length)
    return (
      <div className="space-y-5">
        {header()}
        <div className="card space-y-2">
          <div className="font-display font-extrabold text-[17px]">Данных по теплице пока нет</div>
          <p className="text-sm text-ink-secondary">
            Загрузите книгу агронома — листы «Учёт цветка», «Черенкование», «Учёт отбракованного товара» и «Данные по датам» лягут сюда сами, и циклы с
            блоками посчитаются. Дальше срезку, черенкование и брак записывают прямо на сайте, во вкладках выше.
          </p>
        </div>
        {importPanel(true)}
      </div>
    );

  const cycleNumbers = cycles.map((c) => c.cycle);
  const asked = Number(searchParams?.cycle);
  const selectedNo = cycleNumbers.includes(asked) ? asked : defaultCycle(cycles);
  const selected = cycles.find((c) => c.cycle === selectedNo) ?? cycles[0];
  const now = nowByBlock(cycles);
  const counts = now.reduce<Partial<Record<BlockStatus, number>>>((acc, b) => ({ ...acc, [b.status]: (acc[b.status] ?? 0) + 1 }), {});
  const blockHref = (b: { cycle: number; block: string }) => ghHref(`/greenhouse/cycles/${b.cycle}/${encodeURIComponent(b.block)}`, farm);

  return (
    <div className="space-y-7">
      {header()}

      {/* Сейчас в теплице */}
      <section className="space-y-3">
        <SectionTitle
          title="Сейчас в теплице"
          hint={(["harvest", "growing", "cuttings", "planned"] as BlockStatus[])
            .filter((s) => counts[s])
            .map((s) => `${BLOCK_STATUS_LABELS[s]} — ${counts[s]}`)
            .join(" · ")}
          actions={importPanel()}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
          {now.map((b) => (
            <NowTile key={b.block} b={b} href={blockHref(b)} year={year} today={today} />
          ))}
        </div>
      </section>

      {/* Выбранный цикл */}
      <section className="space-y-3">
        <SectionTitle title={`Цикл ${selected.cycle}`} hint={cycleHint(selected, year)} />
        <div className="flex gap-1.5 overflow-x-auto scroll-x-hidden -mx-1 px-1 pb-0.5">
          {cycleNumbers.map((n) => {
            const c = cycles.find((x) => x.cycle === n)!;
            const live = (c.statusCounts.harvest ?? 0) > 0;
            return (
              <Link
                key={n}
                href={ghHref("/greenhouse", farm, { cycle: n })}
                className={clsx(
                  "h-9 min-w-[3.25rem] px-3 rounded-full text-sm whitespace-nowrap inline-flex items-center justify-center gap-1.5 transition-colors",
                  n === selected.cycle ? "bg-section-greenhouse text-white font-medium" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane"
                )}
              >
                {live && <span className={clsx("w-1.5 h-1.5 rounded-full", n === selected.cycle ? "bg-white" : "bg-[#2f8a55]")} />}
                {n}
              </Link>
            );
          })}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiTile icon="leaf" label="Посажено" value={num(selected.planted)} hint={`${selected.blocks.length} ${plural(selected.blocks.length, "блок", "блока", "блоков")}`} />
          <KpiTile icon="check" label="Срезано" value={num(selected.harvested)} hint={selected.yieldPct !== null ? `выход ${pct(selected.yieldPct)} от посаженного` : "срезки ещё не было"} tone={selected.yieldPct !== null && selected.yieldPct >= 80 ? "good" : undefined} />
          <KpiTile icon="trophy" label="Высшая + первая" value={pct(selected.topShare)} hint="доля в срезке" />
          <KpiTile icon="chart" label="Средний вес стебля" value={grams(selected.avgWeight)} hint="по взвешенной срезке" />
          <KpiTile icon="alert" label="Отход при посадке" value={pct(selected.cullPct, 1)} hint="брак черенков и выбраковка" tone={selected.cullPct !== null && selected.cullPct > 15 ? "warn" : undefined} />
          <KpiTile icon="alert" label="Брак на блоках" value={num(selected.wasteTotal)} hint="повилика, клещ и т. п., шт." />
        </div>
        {selected.grades.length > 0 && (
          <div className="card !p-4 space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="font-medium">Категории срезки цикла</span>
              <span className="text-xs text-ink-muted">{selected.grades.map((g) => `${g.grade} ${Math.round((g.qty * 100) / Math.max(1, selected.harvested))} %`).join(" · ")}</span>
            </div>
            <GradeBar grades={selected.grades} height="h-3" />
          </div>
        )}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {selected.blocks.map((b) => (
            <BlockCardView key={b.block} b={b} href={blockHref(b)} year={year} />
          ))}
        </div>
        <GradeLegend grades={HARVEST_GRADES.filter((g) => selected.grades.some((x) => x.grade === g))} />
      </section>

      {/* Все циклы */}
      <section className="space-y-3">
        <SectionTitle
          title="Все циклы"
          hint="Выход — срезано от посаженного. Посажено = черенки (факт или инвойс) + с маточника − брак с отделения и рассадника − тех брак − выбраковка."
          actions={
            <Link href={ghHref("/greenhouse/analytics", farm)} className="text-sm underline">
              Сравнить блоки по циклам →
            </Link>
          }
        />
        <div className="card !p-0 overflow-hidden">
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Цикл</th>
                <th className={clsx(TH, "hidden md:table-cell")}>Черенкование с</th>
                <th className={clsx(TH, "text-right")}>Посажено</th>
                <th className={clsx(TH, "text-right")}>Срезано</th>
                <th className={clsx(TH, "w-40")}>Выход</th>
                <th className={clsx(TH, "text-right")}>Высш. + 1</th>
                <th className={clsx(TH, "text-right hidden lg:table-cell")}>Вес</th>
                <th className={clsx(TH, "text-right hidden lg:table-cell")}>Отход</th>
                <th className={clsx(TH, "hidden sm:table-cell")}>Блоки</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.cycle} className={clsx(TR, c.cycle === selected.cycle && "bg-section-greenhouse-soft/60")}>
                  <td className="px-4 py-2.5">
                    <Link href={ghHref("/greenhouse", farm, { cycle: c.cycle })} className="font-display font-bold hover:underline">
                      Цикл {c.cycle}
                    </Link>
                  </td>
                  <td data-label="Черенкование с" className="px-4 py-2.5 hidden md:table-cell text-ink-secondary">
                    {dm(c.firstCuttingsAt, year)}
                  </td>
                  <td data-label="Посажено" className="px-4 py-2.5 text-right tabular-nums">
                    {num(c.planted)}
                  </td>
                  <td data-label="Срезано" className="px-4 py-2.5 text-right tabular-nums">
                    {num(c.harvested)}
                  </td>
                  <td data-label="Выход" className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <YieldBar value={c.yieldPct} className="flex-1 min-w-[3rem]" />
                      <span className="tabular-nums text-xs w-12 text-right">{pct(c.yieldPct)}</span>
                    </div>
                  </td>
                  <td data-label="Высш. + 1" className="px-4 py-2.5 text-right tabular-nums">
                    {pct(c.topShare)}
                  </td>
                  <td data-label="Вес" className="px-4 py-2.5 text-right tabular-nums hidden lg:table-cell">
                    {grams(c.avgWeight)}
                  </td>
                  <td data-label="Отход" className="px-4 py-2.5 text-right tabular-nums hidden lg:table-cell">
                    {pct(c.cullPct, 1)}
                  </td>
                  <td data-label="Блоки" className="px-4 py-2.5 hidden sm:table-cell text-xs text-ink-secondary">
                    {statusLine(c)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function statusLine(c: CycleCard): string {
  return (["harvest", "growing", "cuttings", "planned", "done", "noharvest"] as BlockStatus[])
    .filter((s) => c.statusCounts[s])
    .map((s) => `${BLOCK_STATUS_LABELS[s]} ${c.statusCounts[s]}`)
    .join(" · ");
}

function cycleHint(c: CycleCard, year: string): string {
  const parts: string[] = [];
  if (c.firstCuttingsAt) parts.push(`черенкование с ${dm(c.firstCuttingsAt, year)}`);
  if (c.lastHarvestAt) parts.push(`последняя срезка ${dm(c.lastHarvestAt, year)}`);
  const s = statusLine(c);
  if (s) parts.push(s);
  return parts.join(" · ");
}

/** Плитка «Сейчас»: блок, его текущий цикл и одна главная строка по состоянию. */
function NowTile({ b, href, year, today }: { b: BlockCard; href: string; year: string; today: string }) {
  let main: React.ReactNode = null;
  let bar: React.ReactNode = null;
  if (b.status === "harvest") {
    main = (
      <>
        срезано <b className="tabular-nums">{num(b.harvested)}</b> · {pct(b.yieldPct)}
      </>
    );
    bar = <YieldBar value={b.yieldPct} />;
  } else if (b.status === "growing") {
    main = b.expectedHarvestAt ? (
      <>
        срезка {b.expectedIsEstimate ? "≈ " : ""}
        {dm(b.expectedHarvestAt, year)}
        {b.daysToHarvest !== null && b.daysToHarvest > 0 ? ` · через ${b.daysToHarvest} дн.` : b.daysToHarvest !== null ? " · уже пора" : ""}
      </>
    ) : (
      <>посажено {dm(b.plantedAt, year)}</>
    );
    const total = b.plantedAt && b.expectedHarvestAt ? Date.parse(b.expectedHarvestAt) - Date.parse(b.plantedAt) : 0;
    const passed = b.plantedAt ? Date.parse(today) - Date.parse(b.plantedAt) : 0;
    bar = (
      <div className="h-1.5 rounded-full bg-surface-sunk overflow-hidden">
        <div className="h-full rounded-full bg-[#7aa6d6]" style={{ width: `${total > 0 ? Math.max(4, Math.min(100, (passed * 100) / total)) : 0}%` }} />
      </div>
    );
  } else if (b.status === "cuttings") {
    main = <>черенкование {dm(b.cuttingsAt, year)}</>;
  } else if (b.status === "done") {
    main = (
      <>
        завершён {dm(b.lastHarvestAt, year)} · выход {pct(b.yieldPct)}
      </>
    );
  } else if (b.status === "noharvest") {
    main = <>посажено {dm(b.plantedAt, year)}, срезки не записано</>;
  } else if (b.status === "planned") {
    main = <>черенкование {dm(b.cuttingsAt, year)}</>;
  } else main = <span className="text-ink-muted">нет данных</span>;
  return (
    <Link href={href} className="card !p-3 block hover:shadow-card-hover transition-shadow space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="whitespace-nowrap">
          <span className="font-display font-extrabold text-[15px]">{/^\d+$/.test(b.block) ? `Блок ${b.block}` : b.block}</span>
          <span className="text-[11px] text-ink-muted ml-1.5">ц. {b.cycle}</span>
        </div>
        <StatusChip status={b.status} label={b.statusLabel} />
      </div>
      <div className="text-xs text-ink-secondary leading-snug">{main}</div>
      {bar}
    </Link>
  );
}

function BlockCardView({ b, href, year }: { b: BlockCard; href: string; year: string }) {
  const delay = b.firstHarvestAt && b.expectedHarvestAt ? Math.round((Date.parse(b.firstHarvestAt) - Date.parse(b.expectedHarvestAt)) / 86400000) : null;
  return (
    <Link href={href} className="card !p-4 block hover:shadow-card-hover transition-shadow space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display font-extrabold text-[17px]">{/^\d+$/.test(b.block) ? `Блок ${b.block}` : b.block}</span>
        <StatusChip status={b.status} label={b.statusLabel} />
      </div>
      {/* Путь блока: черенкование → посадка → срезка */}
      <div className="grid grid-cols-3 gap-1 text-[11px]">
        <Step label="Черенкование" value={dm(b.cuttingsAt, year)} done={!!b.cuttingsAt} />
        <Step label="Посадка" value={dm(b.plantedAt, year)} done={!!b.plantedAt} />
        <Step
          label={b.firstHarvestAt ? "Срезка" : b.expectedIsEstimate ? "Срезка ≈" : "Срезка, план"}
          value={b.firstHarvestAt ? `${dm(b.firstHarvestAt, year)}${b.lastHarvestAt && b.lastHarvestAt !== b.firstHarvestAt ? `–${dm(b.lastHarvestAt, year)}` : ""}` : dm(b.expectedHarvestAt, year)}
          done={!!b.firstHarvestAt}
          note={delay !== null && delay !== 0 ? `${delay > 0 ? "+" : ""}${delay} дн. к плану` : undefined}
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Посажено" value={num(b.planted)} />
        <Stat label="Срезано" value={num(b.harvested)} />
        <Stat label="Выход" value={pct(b.yieldPct)} />
        <Stat label="Высш.+1" value={pct(b.topShare)} />
      </div>
      <div className="space-y-1.5">
        <YieldBar value={b.yieldPct} />
        <GradeBar grades={b.grades} />
      </div>
      {b.varieties.length > 0 && (
        <div className="text-[11px] text-ink-secondary truncate">
          {b.varieties
            .slice(0, 4)
            .map((v) => v.name)
            .join(", ")}
          {b.varieties.length > 4 ? ` и ещё ${b.varieties.length - 4}` : ""}
        </div>
      )}
    </Link>
  );
}

function Step({ label, value, done, note }: { label: string; value: string; done: boolean; note?: string }) {
  return (
    <div className={clsx("rounded-lg px-2 py-1.5 border", done ? "border-section-greenhouse/20 bg-section-greenhouse-soft/60" : "border-dashed border-line-hairline")}>
      <div className="text-ink-muted truncate">{label}</div>
      <div className={clsx("font-medium tabular-nums truncate", !done && "text-ink-secondary")}>{value}</div>
      {note && <div className="text-ink-muted truncate">{note}</div>}
    </div>
  );
}
