import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import FarmSwitch from "@/components/payroll/FarmSwitch";
import WorkTabs from "@/components/payroll/work/WorkTabs";
import DayEntryBoard from "@/components/payroll/work/DayEntryBoard";
import { FARM_LABELS } from "@/lib/constants";
import { PAYROLL_NO_ACCESS } from "@/lib/payroll/access";
import { payrollHref } from "@/lib/payroll/farmScope";
import { employedOn } from "@/lib/payroll/timesheet";
import { AREA_LABELS, KNOWN_BLOCKS, WORK_AREAS, compareBlocks, isWorkArea, lastCrew, recentPeople, shiftDay, type WorkArea } from "@/lib/payroll/work";
import { loadWorkContext, workPeople } from "@/lib/payroll/workData";
import { listWork } from "@/lib/repo/payrollWork";
import { payrollSpreadsheetId } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { toIsoDate } from "@/lib/sheetDate";
import { payrollTabsFor } from "../tabs";
import { saveWorkDayAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Выработка — ввод за день (этап 7, 29.10.2026). Ответственный за участок открывает дату и участок и одной сеткой
 * записывает, кто сколько сделал: сотрудник, блок, вид работ, количество, часы. Замена четырём листам книги
 * «Учёт работ цветоводов» (срезка; сортировка и упаковка; посадка; подготовка), которые вели руками в Excel.
 */
export default async function WorkDayPage({ searchParams }: { searchParams?: { farm?: string; date?: string; area?: string } }) {
  const ctx = await loadWorkContext(searchParams);
  if (!ctx.scope) redirect("/payroll");
  const { scope, farm } = ctx;
  const today = localDayKey();
  const date = searchParams?.date && toIsoDate(searchParams.date) === searchParams.date && searchParams.date <= today ? searchParams.date : today;
  const area: WorkArea = searchParams?.area && isWorkArea(searchParams.area) ? searchParams.area : "cut";

  // Последние два месяца участка — для «повторить состав» и списка «работали недавно»; сам день — по всем участкам,
  // чтобы на плитках участков было видно, где записи уже есть.
  const entries = await listWork({ farm, from: shiftDay(date, -60), to: date });
  const day = entries.filter((e) => e.date === date);
  const dayRows = day.filter((e) => e.area === area);
  const counts = Object.fromEntries(WORK_AREAS.map((a) => [a, day.filter((e) => e.area === a).length])) as Record<WorkArea, number>;
  const crew = lastCrew(area, entries, date);
  const recent = recentPeople(area, entries, date);
  const people = workPeople(ctx).filter((p) => employedOn(date, p.hiredAt, p.firedAt) || dayRows.some((r) => r.employeeId === p.employeeId));
  const blocks = Array.from(new Set([...KNOWN_BLOCKS, ...entries.map((e) => e.block).filter(Boolean)])).sort(compareBlocks);
  const href = (f: string) => payrollHref("/payroll/work", f, { date, area });

  return (
    <div className="space-y-5">
      <PageHeader
        area="payroll"
        title="Выработка"
        subtitle={FARM_LABELS[farm] ?? farm}
        icon="leaf"
        tabs={payrollTabsFor(scope, farm)}
        actions={<FarmSwitch farm={farm} href={href} />}
      >
        <WorkTabs active="day" farm={farm} seesMoney={scope.seesMoney} />
      </PageHeader>
      {!payrollSpreadsheetId() && (
        <div className="card border-[#8a5a00]/30 bg-[#fdf6e7] text-sm">
          Таблица зарплаты ещё не подключена — выработка не сохранится.{" "}
          {scope.kind === "admin" ? (
            <a href="/api/payroll/setup" className="underline font-medium">
              Создать и подключить
            </a>
          ) : (
            "Попросите администратора её подключить."
          )}
        </div>
      )}
      {!scope.editsWork && <div className="card text-sm text-ink-secondary">{PAYROLL_NO_ACCESS.replace("Раздел «Зарплата»", "Ввод выработки")} Вы видите записи, но не меняете их.</div>}
      {people.length === 0 && (
        <div className="card text-sm text-ink-secondary">
          В штате компании {FARM_LABELS[farm] ?? farm} пока никого нет — сотрудников заводят в «Сотрудниках» или грузят штатной расстановкой. Без карточек
          выработку записать некому.
        </div>
      )}
      <DayEntryBoard
        key={`${farm}-${date}-${area}`}
        farm={farm}
        date={date}
        today={today}
        area={area}
        areaLabels={AREA_LABELS}
        counts={counts}
        people={people}
        recent={recent}
        blocks={blocks}
        initial={dayRows.map((e) => ({ workId: e.workId, employeeId: e.employeeId, name: e.name, block: e.block, part: e.part, workType: e.workType, qty: e.qty, hours: e.hours, note: e.note }))}
        crew={crew}
        canEdit={scope.editsWork}
        save={saveWorkDayAction}
      />
    </div>
  );
}
