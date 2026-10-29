import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import GhImportPanel from "@/components/greenhouse/GhImportPanel";
import LogBoard, { type LogRowView } from "@/components/greenhouse/LogBoard";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { CUTTING_KINDS, GH_VARIETIES, HARVEST_GRADES, WASTE_KINDS, currentCycleFor, cycleOf, type LogKind } from "@/lib/greenhouse/production";
import { compareBlocks, KNOWN_BLOCKS } from "@/lib/payroll/work";
import { toIsoDate } from "@/lib/sheetDate";
import { greenhouseTabsFor } from "./tabs";
import { deleteLogRowAction, importCyclesAction, importLogRowsAction, listLogIdsAction, saveLogRowsAction } from "./actions";

/**
 * Общая страница трёх журналов теплицы. Записи отбираются на сервере (период, цикл, блок), в браузер уходит не
 * больше `LIMIT` последних: срезки в книге — тысячи строк.
 */
const LIMIT = 1500;

const META: Record<LogKind, { path: string; title: string; subtitle: string; icon: "check" | "leaf" | "alert" }> = {
  harvest: { path: "/greenhouse/harvest", title: "Срезка", subtitle: "Учёт цветка: что срезали по блокам, сортам и категориям", icon: "check" },
  cuttings: { path: "/greenhouse/cuttings", title: "Черенкование", subtitle: "Приход черенков, факт, брак, выбраковка и маточник", icon: "leaf" },
  waste: { path: "/greenhouse/waste", title: "Брак", subtitle: "Повилика, клещ, тля, тех брак — что выбросили с блоков", icon: "alert" },
};

export async function renderLogPage(log: LogKind, searchParams?: { farm?: string; from?: string; to?: string; cycle?: string; block?: string }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, data } = p;
  const meta = META[log];
  const header = (
    <PageHeader
      area="greenhouse"
      title={meta.title}
      subtitle={`${meta.subtitle} · ${FARM_LABELS[farm] ?? farm}`}
      icon={meta.icon}
      tabs={greenhouseTabsFor(scope, farm)}
      actions={scope && <GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref(meta.path, f)} />}
    />
  );
  if (!scope)
    return (
      <div className="space-y-5">
        {header}
        <div className="card text-sm text-ink-secondary">{GREENHOUSE_NO_ACCESS}</div>
      </div>
    );

  const cycle = cycleOf(searchParams?.cycle) || null;
  const block = String(searchParams?.block ?? "").trim();
  // По циклу или блоку — за всё время (там вопрос «что было с блоком»), иначе по умолчанию 30 дней.
  const defFrom = cycle || block ? "2000-01-01" : shiftDay(today, -29);
  const from = searchParams?.from && toIsoDate(searchParams.from) === searchParams.from ? searchParams.from : defFrom;
  const to = searchParams?.to && toIsoDate(searchParams.to) === searchParams.to ? searchParams.to : today;

  const all: LogRowView[] =
    log === "harvest"
      ? data.harvest.map((h) => ({ id: h.id, date: h.date, cycle: h.cycle, block: h.block, variety: h.variety, kind: h.grade, qty: h.qty, weightKg: h.weightKg, part: "", line: "", note: h.note }))
      : log === "cuttings"
        ? data.cuttings.map((c) => ({ id: c.id, date: c.date, cycle: c.cycle, block: c.block, variety: c.variety, kind: c.kind, qty: c.qty, weightKg: 0, part: c.part, line: c.line, note: c.note }))
        : data.waste.map((w) => ({ id: w.id, date: w.date, cycle: w.cycle, block: w.block, variety: w.variety, kind: w.kind, qty: w.qty, weightKg: 0, part: "", line: "", note: w.note }));
  const matched = all
    .filter((r) => r.date >= from && r.date <= to && (!cycle || r.cycle === cycle) && (!block || r.block === block))
    .sort((a, b) => b.date.localeCompare(a.date) || compareBlocks(a.block, b.block) || a.variety.localeCompare(b.variety));
  const rows = matched.slice(0, LIMIT);

  const blocksSet = new Set<string>(KNOWN_BLOCKS.filter((b) => b !== "Маточник"));
  for (const c of data.cycles) blocksSet.add(c.block);
  for (const r of all) if (r.block && r.block !== "—") blocksSet.add(r.block);
  const blocks = Array.from(blocksSet).sort(compareBlocks);
  const cycles = Array.from(new Set([...data.cycles.map((c) => c.cycle), ...all.map((r) => r.cycle)])).filter(Boolean).sort((a, b) => b - a);
  const blockCycle: Record<string, number> = {};
  for (const b of blocks) {
    const c = currentCycleFor(b, today, data);
    if (c) blockCycle[b] = c;
  }
  const varietySet = new Set<string>(GH_VARIETIES);
  for (const list of [data.harvest, data.cuttings, data.waste]) for (const x of list) if (x.variety) varietySet.add(x.variety);
  const varieties = Array.from(varietySet).sort((a, b) => a.localeCompare(b));
  const kinds = log === "harvest" ? HARVEST_GRADES.map((g) => ({ code: g, label: g })) : log === "cuttings" ? CUTTING_KINDS.map((k) => ({ code: k.code, label: k.label })) : WASTE_KINDS.map((k) => ({ code: k.code, label: k.label }));

  return (
    <div className="space-y-5">
      {header}
      {scope.editsLogs && all.length === 0 && (
        <GhImportPanel farm={farm} today={today} only={log} open listIds={listLogIdsAction} importRows={importLogRowsAction} importCycles={importCyclesAction} />
      )}
      <LogBoard
        key={`${farm}-${from}-${to}-${cycle ?? ""}-${block}`}
        log={log}
        path={meta.path}
        farm={farm}
        today={today}
        from={from}
        to={to}
        cycle={cycle}
        block={block}
        rows={rows}
        shownLimit={LIMIT}
        totalMatched={matched.length}
        kinds={kinds}
        blocks={blocks}
        cycles={cycles}
        blockCycle={blockCycle}
        varieties={varieties}
        canEdit={scope.editsLogs}
        save={saveLogRowsAction}
        remove={deleteLogRowAction}
      />
      {scope.editsLogs && all.length > 0 && (
        <div className="pt-2">
          <GhImportPanel farm={farm} today={today} only={log} label="Догрузить из книги агронома" listIds={listLogIdsAction} importRows={importLogRowsAction} importCycles={importCyclesAction} />
        </div>
      )}
    </div>
  );
}

function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
