import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import GhFilterBar from "@/components/greenhouse/GhFilterBar";
import GhImportPanel from "@/components/greenhouse/GhImportPanel";
import DayCard from "@/components/greenhouse/records/DayCard";
import WorkTools from "@/components/greenhouse/work/WorkTools";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import { loadGreenhousePage } from "@/lib/greenhouse/pageData";
import { cycleOf } from "@/lib/greenhouse/production";
import { RECORD_KINDS, recordDays, recordIssues, recordTotals, type RecordKind, type WorkLine } from "@/lib/greenhouse/records";
import { reportRange } from "@/lib/greenhouse/reportPeriod";
import { nameKey } from "@/lib/payroll/rules";
import { AREA_LABELS, compareBlocks, displayName, shiftDay, workTypeLabel } from "@/lib/payroll/work";
import { loadWorkContext, workPeople } from "@/lib/payroll/workData";
import { listNameLinks, listWork } from "@/lib/repo/payrollWork";
import { greenhouseTabsFor } from "../tabs";
import { importCyclesAction, importLogRowsAction, listLogIdsAction } from "../actions";
import { importWorkRowsAction, linkWorkNameAction, listWorkIdsAction } from "../work/actions";

export const dynamic = "force-dynamic";

/**
 * «Записи» (30.10.2026, владелец: «вкладку Записи прям переделай, не очень»). Было — журнал строкой на категорию:
 * за месяц шесть с половиной тысяч пикселей одинаковых строк. Стало — день карточкой: сверху итоги дня по журналам,
 * внутри лист дня, как в книге (строка «блок · сорт», категории в ряд). Отбор — период со стрелками, блок, сорт и что
 * показывать. Сверху — «Проверьте»: похожее на ошибку ввода. Правят на «Внести день» — ссылки ведут на тот же день и
 * блок. Расчёт — `src/lib/greenhouse/records.ts`.
 */
type Params = { farm?: string; type?: string; period?: string; date?: string; from?: string; to?: string; block?: string; variety?: string; cycle?: string };

const MAX_DAYS = 93;
const TONE: Record<RecordKind, string> = { harvest: "#2f8a55", waste: "#c9584e", cuttings: "#e2a13b", work: "#4f7fb8" };

export default async function GreenhouseRecordsPage({ searchParams }: { searchParams?: Params }) {
  const sp = searchParams ?? {};
  const p = await loadGreenhousePage(sp);
  const { scope, farm, today, data } = p;
  const kindsAllowed = RECORD_KINDS.filter((k) => k.key !== "work" || !!scope?.payroll);
  const type = kindsAllowed.some((k) => k.key === sp.type) ? (sp.type as RecordKind) : "all";
  const kinds: RecordKind[] = type === "all" ? kindsAllowed.map((k) => k.key) : [type];

  const block = String(sp.block ?? "").trim();
  const variety = String(sp.variety ?? "").trim();
  // Из карточки блока приходят «записи цикла»: период тогда — от первой до последней записи цикла на блоке.
  const cycle = cycleOf(sp.cycle) || 0;
  const cycleDates = cycle
    ? [...data.harvest, ...data.waste, ...data.cuttings].filter((r) => r.cycle === cycle && (!block || r.block === block)).map((r) => r.date).sort()
    : [];
  const range = cycleDates.length
    ? reportRange({ period: "custom", from: cycleDates[0], to: cycleDates[cycleDates.length - 1] }, today)
    : reportRange({ period: sp.period ?? "month", date: sp.date, from: sp.from, to: sp.to }, today);
  // Записи смотрят по дням — не больше квартала, иначе страница снова станет полотном (цикл — целиком).
  const from = !cycle && range.period === "custom" && Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) >= MAX_DAYS ? shiftDay(range.to, -(MAX_DAYS - 1)) : range.from;
  const to = range.to;

  const header = (
    <PageHeader
      area="greenhouse"
      title="Записи"
      subtitle={FARM_LABELS[farm] ?? farm}
      icon="list"
      tabs={greenhouseTabsFor(scope, farm)}
      actions={
        scope && (
          <>
            {(scope.editsLogs || (scope.payroll && scope.editsWork)) && (
              <Link href={ghHref("/greenhouse/day", farm)} className="btn-primary !py-2 whitespace-nowrap">
                + Внести день
              </Link>
            )}
            <GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref("/greenhouse/records", f)} />
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

  // Выработка — из таблицы зарплаты, только тем, у кого есть роль модуля.
  let work: WorkLine[] | undefined;
  let tools: React.ReactNode = null;
  if (scope.payroll && kinds.includes("work")) {
    const ctx = await loadWorkContext(sp);
    const [all, links] = await Promise.all([listWork({ farm }), listNameLinks(farm)]);
    work = all
      .filter((e) => e.date >= from && e.date <= to)
      .map((e) => ({
        date: e.date,
        area: e.area,
        areaLabel: AREA_LABELS[e.area],
        name: displayName(e, ctx.names),
        hasCard: !!e.employeeId,
        block: e.block,
        typeLabel: workTypeLabel(e.area, e.workType),
        qty: e.qty,
        hours: e.hours,
      }));
    if (scope.payroll.editsWork) {
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
      tools = (
        <WorkTools
          farm={farm}
          today={today}
          people={workPeople(ctx).map((pp) => ({ employeeId: pp.employeeId, fullName: pp.fullName, deptName: pp.deptName }))}
          unmatched={Array.from(unmatched.values()).sort((a, b) => b.rows - a.rows)}
          links={links.map((l) => ({ name: l.name, employeeId: l.employeeId }))}
          listIds={listWorkIdsAction}
          importRows={importWorkRowsAction}
          linkName={linkWorkNameAction}
        />
      );
    }
  }

  const filter = { from, to, block, variety, kinds, cycle: cycle || undefined };
  const days = recordDays({ ...data, work }, filter);
  const issues = recordIssues({ ...data, work }, filter);
  const totals = recordTotals(days);

  const blocks = new Set<string>();
  for (const c of data.cycles) blocks.add(c.block);
  for (const list of [data.harvest, data.waste, data.cuttings]) for (const r of list) if (r.block && r.block !== "—") blocks.add(r.block);
  const varieties = new Set<string>();
  for (const list of [data.harvest, data.waste, data.cuttings]) for (const r of list) if (r.variety) varieties.add(r.variety);

  const keep = { type: type === "all" ? undefined : type, cycle: cycle || undefined, period: range.period, date: range.period === "custom" ? undefined : range.anchor, from: range.period === "custom" ? from : undefined, to: range.period === "custom" ? to : undefined, block: block || undefined, variety: variety || undefined };
  const typeChip = (key: string, label: string) => (
    <Link
      key={key}
      href={ghHref("/greenhouse/records", farm, { ...keep, type: key === "all" ? undefined : key })}
      className={clsx("text-xs px-3 py-1.5 rounded-full border whitespace-nowrap inline-flex items-center gap-1.5", key === type ? "bg-section-greenhouse text-white border-section-greenhouse" : "border-line-hairline bg-surface hover:bg-surface-plane")}
    >
      {key !== "all" && <span className="w-1.5 h-1.5 rounded-full" style={{ background: key === type ? "#fff" : TONE[key as RecordKind] }} />}
      {label}
    </Link>
  );
  const issuesByDay = new Map<string, typeof issues>();
  for (const x of issues) issuesByDay.set(x.date, [...(issuesByDay.get(x.date) ?? []), x]);
  const canEdit = scope.editsLogs || (!!scope.payroll && scope.editsWork);
  const empty = !data.harvest.length && !data.cuttings.length && !data.waste.length;

  return (
    <div className="space-y-4">
      {header}

      <GhFilterBar
        path="/greenhouse/records"
        farm={farm}
        params={type === "all" ? {} : { type }}
        cycleNote={cycle ? { label: `Цикл ${cycle}`, clearHref: ghHref("/greenhouse/records", farm, { ...keep, cycle: undefined, period: "month", from: undefined, to: undefined, date: undefined }) } : undefined}
        period={range.period}
        from={from}
        to={to}
        anchor={range.anchor}
        title={range.period === "custom" ? "" : range.title}
        prevAnchor={range.prevAnchor}
        nextAnchor={range.nextAnchor}
        periods={["day", "week", "month", "custom"]}
        today={today}
        blocks={Array.from(blocks).sort(compareBlocks)}
        block={block}
        varieties={Array.from(varieties).sort((a, b) => a.localeCompare(b))}
        variety={variety}
      >
        {typeChip("all", "Всё")}
        {kindsAllowed.map((k) => typeChip(k.key, k.label))}
      </GhFilterBar>

      {empty && scope.editsLogs ? (
        <div className="card space-y-3">
          <div className="text-sm text-ink-secondary">Записей пока нет — загрузите книгу агронома, и срезка, брак и черенкование лягут сюда сами.</div>
          <GhImportPanel farm={farm} today={today} open listIds={listLogIdsAction} importRows={importLogRowsAction} importCycles={importCyclesAction} />
        </div>
      ) : (
        <>
          {/* Итог отобранного одной строкой */}
          {days.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm px-1">
              <span className="text-ink-muted">
                {days.length} {days.length === 1 ? "день" : days.length < 5 ? "дня" : "дней"} с записями
              </span>
              {totals.harvest > 0 && (
                <span>
                  срезано <b className="tabular-nums">{totals.harvest.toLocaleString("ru-RU")}</b>
                </span>
              )}
              {totals.waste > 0 && (
                <span>
                  брак <b className="tabular-nums">{totals.waste.toLocaleString("ru-RU")}</b>
                </span>
              )}
              {totals.cuttings > 0 && (
                <span>
                  черенкование <b className="tabular-nums">{totals.cuttings}</b> зап.
                </span>
              )}
              {totals.workRows > 0 && (
                <span>
                  выработка <b className="tabular-nums">{totals.workRows}</b> строк
                </span>
              )}
            </div>
          )}

          {issues.length > 0 && (
            <section className="card !p-4 border-[#e0a526]/40 bg-[#fffaf0] space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="font-display font-bold text-[15px]">Проверьте</h3>
                <span className="text-xs text-ink-muted">похоже на ошибку ввода · {issues.length}</span>
              </div>
              <ul className="space-y-1.5">
                {issues.slice(0, 6).map((x, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="text-xs text-ink-muted w-12 flex-none pt-0.5 tabular-nums">{x.date.slice(8, 10)}.{x.date.slice(5, 7)}</span>
                    <span className="flex-1 min-w-0">{x.text}</span>
                    {canEdit && x.kind !== "work" && (
                      <Link href={ghHref("/greenhouse/day", farm, { date: x.date, section: x.kind, block: x.block || undefined })} className="text-xs text-section-greenhouse hover:underline whitespace-nowrap pt-0.5">
                        исправить →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              {issues.length > 6 && <div className="text-xs text-ink-muted">Ещё {issues.length - 6} — в карточках дней ниже, помечены ⚠.</div>}
            </section>
          )}

          {days.length === 0 ? (
            <div className="card text-sm text-ink-secondary">
              {type !== "all" || block || variety ? "За этот период под отбор ничего не попало." : "За этот период записей нет."}{" "}
              {range.prevAnchor && (
                <Link href={ghHref("/greenhouse/records", farm, { ...keep, date: range.prevAnchor })} className="underline">
                  Посмотреть раньше
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {days.map((d, i) => (
                <DayCard key={d.date} day={d} farm={farm} today={today} canEdit={canEdit} open={i === 0} issues={issuesByDay.get(d.date) ?? []} maxHarvest={Math.max(0, ...days.map((x) => x.harvestTotal))} />
              ))}
            </div>
          )}

          {(scope.editsLogs || tools) && (
            <details className="card !p-4">
              <summary className="cursor-pointer text-sm font-medium">Загрузка из Excel</summary>
              <div className="mt-3 space-y-4">
                {scope.editsLogs && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-ink-muted">Книга агронома: срезка, черенкование, брак и даты циклов. Повторная загрузка не задваивает.</div>
                    <GhImportPanel farm={farm} today={today} label="Загрузить книгу агронома" listIds={listLogIdsAction} importRows={importLogRowsAction} importCycles={importCyclesAction} />
                  </div>
                )}
                {tools && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-ink-muted">Книга учёта работ цветоводов и имена без карточки сотрудника.</div>
                    {tools}
                  </div>
                )}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
