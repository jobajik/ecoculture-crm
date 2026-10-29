import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import GhImportPanel from "@/components/greenhouse/GhImportPanel";
import GhSegments from "@/components/greenhouse/GhSegments";
import LogBoard, { type LogRowView } from "@/components/greenhouse/LogBoard";
import WorkJournal, { type JournalRow } from "@/components/greenhouse/work/WorkJournal";
import type { IconName } from "@/components/Icon";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { CUTTING_KINDS, GH_VARIETIES, HARVEST_GRADES, WASTE_KINDS, cycleOf, type LogKind } from "@/lib/greenhouse/production";
import { nameKey } from "@/lib/payroll/rules";
import { AREA_LABELS, KNOWN_BLOCKS, compareBlocks, displayName, isWorkArea, periodFor, shiftDay, workTypeLabel } from "@/lib/payroll/work";
import { loadWorkContext, workPeople } from "@/lib/payroll/workData";
import { listNameLinks, listWork } from "@/lib/repo/payrollWork";
import { toIsoDate } from "@/lib/sheetDate";
import { greenhouseTabsFor } from "../tabs";
import { deleteLogRowAction, importCyclesAction, importLogRowsAction, listLogIdsAction, saveLogRowsAction } from "../actions";
import { deleteWorkEntryAction, importWorkRowsAction, linkWorkNameAction, listWorkIdsAction } from "../work/actions";

export const dynamic = "force-dynamic";

/**
 * «Записи» (29.10.2026): всё внесённое в теплице одним местом — срезка, брак, черенкование и выработка, переключателем
 * сверху. Здесь ищут, проверяют и правят; вносят — на «Внести день» (у каждого дня ссылка «открыть день»). Сюда же
 * переехала загрузка книг Excel. В браузер уходит не больше `LIMIT` последних записей журнала.
 */
const LIMIT = 1500;
type RecordType = LogKind | "work";

const TYPES: { key: RecordType; label: string; icon: IconName }[] = [
  { key: "harvest", label: "Срезка", icon: "leaf" },
  { key: "waste", label: "Брак", icon: "alert" },
  { key: "cuttings", label: "Черенкование", icon: "tag" },
  { key: "work", label: "Выработка", icon: "client" },
];

type Params = { farm?: string; type?: string; from?: string; to?: string; month?: string; cycle?: string; block?: string; area?: string };

export default async function GreenhouseRecordsPage({ searchParams }: { searchParams?: Params }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, data } = p;
  const types = TYPES.filter((t) => t.key !== "work" || !!scope?.payroll);
  const type: RecordType = types.some((t) => t.key === searchParams?.type) ? (searchParams!.type as RecordType) : "harvest";
  const keep = { from: searchParams?.from, to: searchParams?.to };

  const header = (
    <PageHeader
      area="greenhouse"
      title="Записи"
      subtitle={`${FARM_LABELS[farm] ?? farm} · всё внесённое — найти, проверить, поправить`}
      icon="list"
      tabs={greenhouseTabsFor(scope, farm)}
      actions={scope && <GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref("/greenhouse/records", f, { type })} />}
    />
  );
  if (!scope)
    return (
      <div className="space-y-5">
        {header}
        <div className="card text-sm text-ink-secondary">{GREENHOUSE_NO_ACCESS}</div>
      </div>
    );

  const segments = <GhSegments active={type} items={types.map((t) => ({ key: t.key, label: t.label, icon: t.icon, href: ghHref("/greenhouse/records", farm, { type: t.key, ...keep }) }))} />;

  if (type === "work") {
    const ctx = await loadWorkContext(searchParams);
    const ws = ctx.scope!;
    const period = periodFor(searchParams, today);
    const area = searchParams?.area && isWorkArea(searchParams.area) ? searchParams.area : "";
    const [entries, links, all] = await Promise.all([listWork({ farm, from: period.from, to: period.to }), listNameLinks(farm), listWork({ farm })]);
    const rows: JournalRow[] = entries.map((e) => ({
      workId: e.workId,
      date: e.date,
      area: e.area,
      areaLabel: AREA_LABELS[e.area],
      employeeId: e.employeeId,
      name: displayName(e, ctx.names),
      block: e.block,
      part: e.part,
      workType: e.workType,
      typeLabel: workTypeLabel(e.area, e.workType),
      qty: e.qty,
      hours: e.hours,
      note: e.note,
      by: e.updatedBy || e.createdBy,
    }));
    // Имена без карточки — по всей истории компании: привязать нужно один раз.
    const unmatched = new Map<string, { name: string; rows: number; last: string }>();
    for (const e of all) {
      if (e.employeeId) continue;
      const key = nameKey(e.name);
      const cur = unmatched.get(key);
      if (cur) {
        cur.rows += 1;
        if (e.date > cur.last) cur.last = e.date;
      } else unmatched.set(key, { name: e.name, rows: 1, last: e.date });
    }
    return (
      <div className="space-y-5">
        {header}
        {segments}
        <WorkJournal
          key={`${farm}-${period.from}-${period.to}-${area}`}
          farm={farm}
          today={today}
          from={period.from}
          to={period.to}
          area={area}
          rows={rows}
          blocks={Array.from(new Set(entries.map((e) => e.block).filter(Boolean))).sort(compareBlocks)}
          people={workPeople(ctx).map((pp) => ({ employeeId: pp.employeeId, fullName: pp.fullName, deptName: pp.deptName }))}
          unmatched={Array.from(unmatched.values()).sort((a, b) => b.rows - a.rows)}
          links={links.map((l) => ({ name: l.name, employeeId: l.employeeId }))}
          canEdit={ws.editsWork}
          remove={deleteWorkEntryAction}
          listIds={listWorkIdsAction}
          importRows={importWorkRowsAction}
          linkName={linkWorkNameAction}
        />
      </div>
    );
  }

  const log = type;
  const cycle = cycleOf(searchParams?.cycle) || null;
  const block = String(searchParams?.block ?? "").trim();
  // По циклу или блоку — за всё время (там вопрос «что было с блоком»), иначе по умолчанию 30 дней.
  const defFrom = cycle || block ? "2000-01-01" : shiftDay(today, -29);
  const from = searchParams?.from && toIsoDate(searchParams.from) === searchParams.from ? searchParams.from : defFrom;
  const to = searchParams?.to && toIsoDate(searchParams.to) === searchParams.to ? searchParams.to : today;

  const allRows: LogRowView[] =
    log === "harvest"
      ? data.harvest.map((h) => ({ id: h.id, date: h.date, cycle: h.cycle, block: h.block, variety: h.variety, kind: h.grade, qty: h.qty, weightKg: h.weightKg, part: "", line: "", note: h.note }))
      : log === "cuttings"
        ? data.cuttings.map((c) => ({ id: c.id, date: c.date, cycle: c.cycle, block: c.block, variety: c.variety, kind: c.kind, qty: c.qty, weightKg: 0, part: c.part, line: c.line, note: c.note }))
        : data.waste.map((w) => ({ id: w.id, date: w.date, cycle: w.cycle, block: w.block, variety: w.variety, kind: w.kind, qty: w.qty, weightKg: 0, part: "", line: "", note: w.note }));
  const matched = allRows
    .filter((r) => r.date >= from && r.date <= to && (!cycle || r.cycle === cycle) && (!block || r.block === block))
    .sort((a, b) => b.date.localeCompare(a.date) || compareBlocks(a.block, b.block) || a.variety.localeCompare(b.variety));

  const blocksSet = new Set<string>(KNOWN_BLOCKS.filter((b) => b !== "Маточник"));
  for (const c of data.cycles) blocksSet.add(c.block);
  for (const r of allRows) if (r.block && r.block !== "—") blocksSet.add(r.block);
  const cycles = Array.from(new Set([...data.cycles.map((c) => c.cycle), ...allRows.map((r) => r.cycle)])).filter(Boolean).sort((a, b) => b - a);
  const varietySet = new Set<string>(GH_VARIETIES);
  for (const list of [data.harvest, data.cuttings, data.waste]) for (const x of list) if (x.variety) varietySet.add(x.variety);
  const kinds = log === "harvest" ? HARVEST_GRADES.map((g) => ({ code: g, label: g })) : log === "cuttings" ? CUTTING_KINDS.map((k) => ({ code: k.code, label: k.label })) : WASTE_KINDS.map((k) => ({ code: k.code, label: k.label }));
  const importPanel = (open: boolean, label?: string) =>
    scope.editsLogs ? <GhImportPanel farm={farm} today={today} only={log} open={open} label={label} listIds={listLogIdsAction} importRows={importLogRowsAction} importCycles={importCyclesAction} /> : null;

  return (
    <div className="space-y-5">
      {header}
      {segments}
      {allRows.length === 0 && importPanel(true)}
      <LogBoard
        key={`${farm}-${log}-${from}-${to}-${cycle ?? ""}-${block}`}
        log={log}
        path="/greenhouse/records"
        params={{ type: log }}
        farm={farm}
        today={today}
        from={from}
        to={to}
        cycle={cycle}
        block={block}
        rows={matched.slice(0, LIMIT)}
        shownLimit={LIMIT}
        totalMatched={matched.length}
        kinds={kinds}
        blocks={Array.from(blocksSet).sort(compareBlocks)}
        cycles={cycles}
        varieties={Array.from(varietySet).sort((a, b) => a.localeCompare(b))}
        canEdit={scope.editsLogs}
        save={saveLogRowsAction}
        remove={deleteLogRowAction}
      />
      {allRows.length > 0 && <div className="pt-2">{importPanel(false, "Догрузить из книги агронома")}</div>}
    </div>
  );
}
