import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import { ghHref } from "@/lib/greenhouse/farm";
import WorkTabs from "@/components/greenhouse/work/WorkTabs";
import WorkJournal, { type JournalRow } from "@/components/greenhouse/work/WorkJournal";
import { FARM_LABELS } from "@/lib/constants";
import { nameKey } from "@/lib/payroll/rules";
import { AREA_LABELS, compareBlocks, displayName, isWorkArea, periodFor, workTypeLabel } from "@/lib/payroll/work";
import { loadWorkContext, workPeople } from "@/lib/payroll/workData";
import { listNameLinks, listWork } from "@/lib/repo/payrollWork";
import { localDayKey } from "@/lib/timezone";
import { greenhouseTabsFor } from "../../tabs";
import { deleteWorkEntryAction, importWorkRowsAction, linkWorkNameAction, listWorkIdsAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Журнал выработки: все записи компании за период с отбором по участку, сотруднику, блоку и виду работ; отсюда же
 * грузится история из книги Excel и привязываются имена старого учёта к карточкам сотрудников.
 */
export default async function WorkJournalPage({ searchParams }: { searchParams?: { farm?: string; from?: string; to?: string; month?: string; area?: string } }) {
  const ctx = await loadWorkContext(searchParams);
  if (!ctx.scope) redirect(ghHref("/greenhouse", ctx.farm));
  const { scope, farm } = ctx;
  const today = localDayKey();
  const period = periodFor(searchParams, today);
  const area = searchParams?.area && isWorkArea(searchParams.area) ? searchParams.area : "";
  const [entries, links] = await Promise.all([listWork({ farm, from: period.from, to: period.to }), listNameLinks(farm)]);
  const people = workPeople(ctx);

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

  // Имена без карточки — по всей истории компании, не только за период: привязать нужно один раз.
  const all = await listWork({ farm });
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
  const unmatchedList = Array.from(unmatched.values()).sort((a, b) => b.rows - a.rows);
  const blocks = Array.from(new Set(entries.map((e) => e.block).filter(Boolean))).sort(compareBlocks);
  const href = (f: string) => ghHref("/greenhouse/work/journal", f, { from: period.from, to: period.to, area: area || undefined });

  return (
    <div className="space-y-5">
      <PageHeader area="greenhouse" title="Выработка — журнал" subtitle={FARM_LABELS[farm] ?? farm} icon="list" tabs={greenhouseTabsFor(ctx.gh, farm)} actions={<GhFarmSwitch farm={farm} href={href} locked={!!ctx.gh?.farmLocked} />}>
        <WorkTabs active="journal" farm={farm} seesMoney={scope.seesMoney} />
      </PageHeader>
      <WorkJournal
        key={`${farm}-${period.from}-${period.to}-${area}`}
        farm={farm}
        today={today}
        from={period.from}
        to={period.to}
        area={area}
        rows={rows}
        blocks={blocks}
        people={people.map((p) => ({ employeeId: p.employeeId, fullName: p.fullName, deptName: p.deptName }))}
        unmatched={unmatchedList}
        links={links.map((l) => ({ name: l.name, employeeId: l.employeeId }))}
        canEdit={scope.editsWork}
        remove={deleteWorkEntryAction}
        listIds={listWorkIdsAction}
        importRows={importWorkRowsAction}
        linkName={linkWorkNameAction}
      />
    </div>
  );
}
