import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import DayBoard, { type DayWorkData } from "@/components/greenhouse/day/DayBoard";
import { FARM_LABELS } from "@/lib/constants";
import { defaultDayBlock, isDaySection, type DayBlock } from "@/lib/greenhouse/day";
import { dayLogs, dayWork } from "@/lib/greenhouse/dayData";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { CUTTING_KINDS, GH_VARIETIES, HARVEST_GRADES, WASTE_KINDS, currentCycleFor, type LogKind } from "@/lib/greenhouse/production";
import { nowByBlock } from "@/lib/greenhouse/views";
import { employedOn } from "@/lib/payroll/timesheet";
import { AREA_LABELS, KNOWN_BLOCKS, WORK_AREAS, compareBlocks, lastCrew, recentPeople, shiftDay, type WorkArea } from "@/lib/payroll/work";
import { loadWorkContext, workPeople } from "@/lib/payroll/workData";
import { listWork } from "@/lib/repo/payrollWork";
import { payrollSpreadsheetId } from "@/lib/sheets";
import { toIsoDate } from "@/lib/sheetDate";
import { greenhouseTabsFor } from "../tabs";
import { saveDayAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * «Внести день» — главный экран ответственного (29.10.2026). Дата → что вносим (срезка, брак, черенкование,
 * выработка) → блок → строки; сохраняется всё одной кнопкой. Подробнее — в `DayBoard`.
 */
export default async function GreenhouseDayPage({ searchParams }: { searchParams?: { farm?: string; date?: string; section?: string; block?: string } }) {
  const p = await loadGreenhousePage(searchParams);
  const { scope, farm, today, data, rows, cycles } = p;
  if (!scope) redirect(ghHref("/greenhouse", farm));
  const canLogs = scope.editsLogs;
  const canWork = !!scope.payroll && scope.editsWork;
  if (!canLogs && !canWork) redirect(ghHref("/greenhouse/records", farm));

  const asked = searchParams?.date ?? "";
  const date = asked && toIsoDate(asked) === asked && asked <= today ? asked : today;

  // Журналы дня.
  const logs = dayLogs(data, date);

  // Блоки: цикл на этот день, состояние (если день — сегодня) и сорта цикла — первыми в выборе сорта.
  const blockSet = new Set<string>(KNOWN_BLOCKS);
  for (const c of data.cycles) blockSet.add(c.block);
  for (const list of Object.values(logs)) for (const r of list) if (r.block) blockSet.add(r.block);
  const now = date === today ? new Map(nowByBlock(cycles).map((b) => [b.block, b])) : new Map();
  const blocks: DayBlock[] = Array.from(blockSet)
    .filter((b) => b !== "—")
    .sort(compareBlocks)
    .map((b) => {
      const cycle = currentCycleFor(b, date, data);
      const summary = rows.find((r) => r.cycle === cycle)?.blocks.find((x) => x.block === b);
      const card = now.get(b);
      return {
        block: b,
        cycle,
        status: card?.status ?? "",
        statusLabel: card ? card.statusLabel : "",
        varieties: (summary?.varieties ?? [])
          .filter((v) => v.planted > 0 || v.harvested > 0)
          .sort((a, c) => c.planted + c.harvested - (a.planted + a.harvested))
          .map((v) => v.variety),
      };
    });
  if ([...logs.cuttings, ...logs.waste, ...logs.harvest].some((r) => r.block === "—")) blocks.push({ block: "—", cycle: 0, status: "", statusLabel: "весь цикл", varieties: [] });

  const varietySet = new Set<string>(GH_VARIETIES);
  for (const list of [data.harvest, data.cuttings, data.waste]) for (const x of list) if (x.variety) varietySet.add(x.variety);
  const varieties = Array.from(varietySet).sort((a, b) => a.localeCompare(b));
  const kinds: Record<LogKind, { code: string; label: string }[]> = {
    harvest: HARVEST_GRADES.map((g) => ({ code: g, label: g })),
    cuttings: CUTTING_KINDS.map((k) => ({ code: k.code, label: k.label })),
    waste: WASTE_KINDS.map((k) => ({ code: k.code, label: k.label })),
  };

  // Выработка участков за день.
  let work: DayWorkData | null = null;
  if (canWork) {
    const ctx = await loadWorkContext(searchParams);
    const entries = await listWork({ farm, from: shiftDay(date, -60), to: date });
    const day = entries.filter((e) => e.date === date);
    const rowsByArea = dayWork(entries, date);
    const people = workPeople(ctx).filter((pp) => employedOn(date, pp.hiredAt, pp.firedAt) || day.some((r) => r.employeeId === pp.employeeId));
    const areas = Object.fromEntries(
      WORK_AREAS.map((a: WorkArea) => [
        a,
        {
          rows: rowsByArea[a],
          crew: lastCrew(a, entries, date),
          recent: recentPeople(a, entries, date),
        },
      ]),
    ) as DayWorkData["areas"];
    work = { areaLabels: AREA_LABELS, people, blocks: Array.from(new Set([...KNOWN_BLOCKS, ...entries.map((e) => e.block).filter(Boolean)])).sort(compareBlocks), areas };
  }

  const all = [...logs.harvest, ...logs.waste, ...logs.cuttings];
  const section = isDaySection(searchParams?.section) ? searchParams!.section : "harvest";
  const block = defaultDayBlock(blocks, section === "people" ? all : logs[section as LogKind] ?? all, searchParams?.block) || defaultDayBlock(blocks, all);

  return (
    <div className="space-y-5">
      <PageHeader
        area="greenhouse"
        title="Внести день"
        subtitle={`${FARM_LABELS[farm] ?? farm} · срезка, брак, черенкование и выработка — одной записью`}
        icon="note"
        tabs={greenhouseTabsFor(scope, farm)}
        actions={<GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref("/greenhouse/day", f, { date })} />}
      />
      {!payrollSpreadsheetId() && (
        <div className="card border-[#8a5a00]/30 bg-[#fdf6e7] text-sm">Таблица теплицы ещё не подключена — записи не сохранятся. Попросите администратора открыть /api/payroll/setup.</div>
      )}
      <DayBoard
        key={`${farm}-${date}`}
        farm={farm}
        date={date}
        today={today}
        initialSection={section}
        initialBlock={block}
        canLogs={canLogs}
        canWork={canWork}
        blocks={blocks}
        varieties={varieties}
        kinds={kinds}
        logs={logs}
        work={work}
        save={saveDayAction}
      />
    </div>
  );
}
