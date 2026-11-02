import Link from "next/link";
import { redirect } from "next/navigation";
import clsx from "clsx";
import type { ReactNode } from "react";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import GhFilterBar from "@/components/greenhouse/GhFilterBar";
import PrintButton from "@/components/greenhouse/dash/PrintButton";
import { Insights } from "@/components/greenhouse/rank";
import IntakeDayBoard from "@/components/greenhouse/intake/IntakeDayBoard";
import { DayBars, FLOWER_HEX, FlowerCard, GradeStrip, FlowerChips, GradeRows, ReasonRows, VarietyTable, n0, p1, rejectTone } from "@/components/greenhouse/intake/IntakeParts";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS, type GreenhouseScope } from "@/lib/greenhouse/access";
import { ghHref } from "@/lib/greenhouse/farm";
import {
  INTAKE_FLOWERS,
  INTAKE_FLOWER_LABELS,
  INTAKE_SPECS,
  byBlock,
  byDay,
  byReason,
  byVariety,
  filterIntake,
  flowersIn,
  gradeLabel,
  gradeShort,
  intakeDay,
  intakeGrades,
  intakeInsights,
  intakeStats,
  isIntakeFlower,
  lastIntakeLines,
  reasonLabel,
  recentVarieties,
  type IntakeFlower,
  type IntakeRow,
} from "@/lib/greenhouse/intake";
import { intakeVarietyList } from "@/lib/greenhouse/intakeData";
import { previousRange } from "@/lib/greenhouse/insights";
import { reportRange } from "@/lib/greenhouse/reportPeriod";
import { compareBlocks, shiftDay } from "@/lib/payroll/work";
import { loadIntake } from "@/lib/repo/greenhouse";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { payrollSpreadsheetId } from "@/lib/sheets";
import { toIsoDate } from "@/lib/sheetDate";
import { localDayKey } from "@/lib/timezone";
import { greenhouseTabsFor } from "../tabs";
import { saveIntakeDayAction } from "../intake-actions";

/**
 * Страницы «Теплицы» для Rose Farm (02.11.2026): адреса те же, что у Есентая (Обзор, Приёмка = «Внести день», Записи,
 * Аналитика), а содержимое — приёмка цветка по характеристикам (`src/lib/greenhouse/intake.ts`). Страница Есентая,
 * открытая с компанией Rose Farm, отдаёт рисовку сюда.
 */

export interface IntakeSession {
  scope: GreenhouseScope | null;
  farm: string;
}
type Sp = Record<string, string | undefined>;

function Header({ s, path, title, subtitle, actions }: { s: IntakeSession; path: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <PageHeader
      area="greenhouse"
      title={title === "Обзор" ? `Теплица ${FARM_LABELS[s.farm] ?? s.farm}` : title}
      subtitle={subtitle ?? (title === "Обзор" ? "приёмка цветка по характеристикам" : `${FARM_LABELS[s.farm] ?? s.farm} · приёмка цветка`)}
      icon="leaf"
      tabs={greenhouseTabsFor(s.scope, s.farm)}
      actions={
        s.scope && (
          <>
            {actions}
            <GhFarmSwitch farm={s.farm} locked={!!s.scope.farmLocked} href={(f) => ghHref(path, f)} />
          </>
        )
      }
    />
  );
}

function NoAccess({ s }: { s: IntakeSession }) {
  return (
    <div className="space-y-5">
      <Header s={s} path="/greenhouse" title="Обзор" />
      <div className="card text-sm text-ink-secondary">{GREENHOUSE_NO_ACCESS}</div>
    </div>
  );
}

const ddmm = (iso: string) => iso.split("-").reverse().slice(0, 2).join(".");
const longDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

// --- Обзор ---------------------------------------------------------------------------------------------------------

export async function IntakeOverviewPage({ s }: { s: IntakeSession }) {
  if (!s.scope) return <NoAccess s={s} />;
  const today = localDayKey();
  const rows = await loadIntake(s.farm);
  const canEdit = s.scope.editsLogs;
  const newBtn = canEdit ? (
    <Link href={ghHref("/greenhouse/day", s.farm)} className="btn-primary !py-1.5 text-sm whitespace-nowrap">
      + Приёмка
    </Link>
  ) : null;

  if (!rows.length)
    return (
      <div className="space-y-5">
        <Header s={s} path="/greenhouse" title="Обзор" actions={newBtn} />
        <div className="card space-y-3 max-w-2xl">
          <div className="font-display font-extrabold text-[17px]">Приёмки Rose Farm пока нет</div>
          <p className="text-sm text-ink-secondary">
            Здесь ведётся, что пришло из теплицы: роза, эустома и своя хризантема — по сортам, длинам и категориям, с весом стебля, бутоном и браком по причинам. Внесите первый день — и здесь появятся итоги, структура по длинам и
            сравнение с прошлыми днями.
          </p>
          {canEdit && (
            <Link href={ghHref("/greenhouse/day", s.farm)} className="btn-primary inline-flex">
              Внести приёмку за сегодня
            </Link>
          )}
        </div>
      </div>
    );

  // Последний день приёмки: сегодня, иначе последний внесённый.
  const lastDate = rows.reduce((m, r) => (r.kind !== "measure" && r.date > m ? r.date : m), "");
  const shown = rows.some((r) => r.date === today && r.kind !== "measure") ? today : lastDate;
  const dayRows = rows.filter((r) => r.date === shown);
  const prevDayDate = rows.reduce((m, r) => (r.kind !== "measure" && r.date < shown && r.date > m ? r.date : m), "");
  const prevDayRows = rows.filter((r) => r.date === prevDayDate);
  const week = { from: shiftDay(today, -6), to: today };
  const weekPrev = previousRange(week.from, week.to);
  const wNow = filterIntake(rows, week);
  const wPrev = filterIntake(rows, weekPrev);
  const days14 = byDay(rows, shiftDay(today, -13), today);
  const month = { from: shiftDay(today, -29), to: today };
  const insights = intakeInsights(filterIntake(rows, month), filterIntake(rows, previousRange(month.from, month.to)));
  const weekFlowers = flowersIn(wNow);

  return (
    <div className="space-y-5">
      <Header s={s} path="/greenhouse" title="Обзор" actions={newBtn} />

      {/* День */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display font-extrabold text-[18px] first-letter:uppercase">{shown === today ? "Сегодня" : longDay(shown)}</h2>
          {shown !== today && <span className="text-sm text-[#8a5a00]">сегодня приёмку ещё не вносили</span>}
          {prevDayDate && <span className="text-xs text-ink-muted">▲▼ — к {ddmm(prevDayDate)}</span>}
          <Link href={ghHref("/greenhouse/records", s.farm, { period: "day", date: shown })} className="ml-auto text-sm text-ink-secondary hover:underline">
            Подробно →
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {flowersIn(dayRows).map((f) => (
            <FlowerCard key={f} flower={f} now={intakeStats(dayRows, f)} prev={prevDayRows.length ? intakeStats(prevDayRows, f) : null} href={ghHref("/greenhouse/records", s.farm, { period: "day", date: shown, flower: f })} />
          ))}
        </div>
      </div>

      {/* Неделя */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display font-extrabold text-[17px]">За 7 дней</h2>
          <span className="text-xs text-ink-muted">к 7 дням до этого</span>
          <Link href={ghHref("/greenhouse/analytics", s.farm, { period: "week" })} className="ml-auto text-sm text-ink-secondary hover:underline">
            Аналитика →
          </Link>
        </div>
        {weekFlowers.length ? <WeekTable now={wNow} prev={wPrev} flowers={weekFlowers} /> : <div className="text-sm text-ink-muted">За неделю приёмки не было.</div>}
        <div>
          <div className="text-xs text-ink-muted mb-2">Принято по дням — 14 дней</div>
          <DayBars days={days14} hrefFor={(d) => ghHref("/greenhouse/records", s.farm, { period: "day", date: d })} />
        </div>
      </div>

      {insights.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-display font-extrabold text-[17px]">На что обратить внимание · 30 дней</h2>
          <Insights lines={insights} />
        </div>
      )}
    </div>
  );
}

function WeekTable({ now, prev, flowers }: { now: IntakeRow[]; prev: IntakeRow[]; flowers: IntakeFlower[] }) {
  const ch = (a: number, b: number) => (b ? Math.round(((a - b) * 100) / b) : null);
  return (
    <div className="divide-y divide-line-hairline/70">
      {flowers.map((f) => {
        const a = intakeStats(now, f);
        const b = intakeStats(prev, f);
        const c = ch(a.accepted, b.accepted);
        const quality = f === "rose" ? (a.avgLength ? `${Math.round(a.avgLength)} см в среднем` : "") : a.topPct !== null ? `${f === "chrysanthemum" ? "высшая" : "стандарт"} ${Math.round(a.topPct)} %` : "";
        return (
          <div key={f} className="py-2 grid grid-cols-[1fr_auto] sm:grid-cols-[9rem_8rem_1fr_7rem_8rem] gap-x-3 gap-y-1 items-center text-sm">
            <span className="inline-flex items-center gap-2 font-medium">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: FLOWER_HEX[f] }} />
              {INTAKE_FLOWER_LABELS[f]}
            </span>
            <span className="text-right sm:text-left tabular-nums">
              <b>{n0(a.accepted)}</b>
              {c !== null && Math.abs(c) <= 200 && <span className={clsx("ml-1.5 text-[11px]", c >= 0 ? "text-[#1f6b3a]" : "text-[#a12b2b]")}>{c >= 0 ? "▲" : "▼"} {Math.abs(c)} %</span>}
            </span>
            <GradeStrip grades={a.byGrade} height="h-2" className="col-span-2 sm:col-span-1" />
            <span className={clsx("tabular-nums text-xs sm:text-sm", rejectTone(a.rejectPct))}>брак {p1(a.rejectPct)}</span>
            <span className="text-xs text-ink-secondary text-right sm:text-left">{quality}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- Приёмка за день -----------------------------------------------------------------------------------------------

export async function IntakeDayPage({ s, sp }: { s: IntakeSession; sp: Sp }) {
  if (!s.scope) return <NoAccess s={s} />;
  if (!s.scope.editsLogs) redirect(ghHref("/greenhouse/records", s.farm));
  const today = localDayKey();
  const asked = sp.date ?? "";
  const date = asked && toIsoDate(asked) === asked && asked <= today ? asked : today;
  const [rows, byType] = await Promise.all([loadIntake(s.farm), listVarietiesByType()]);
  const day = intakeDay(rows, date);
  const varieties = intakeVarietyList(rows, byType).byFlower;
  const recent = Object.fromEntries(INTAKE_FLOWERS.map((f) => [f, recentVarieties(rows, f, date)])) as Record<IntakeFlower, { variety: string; block: string }[]>;
  const last = Object.fromEntries(INTAKE_FLOWERS.map((f) => [f, lastIntakeLines(rows, f, date)])) as Record<IntakeFlower, ReturnType<typeof lastIntakeLines>>;
  const askedFlower = isIntakeFlower(sp.flower) ? sp.flower : null;
  const initial = askedFlower ?? INTAKE_FLOWERS.find((f) => day.lines.some((l) => l.flower === f)) ?? "rose";
  return (
    <div className="space-y-5">
      <Header s={s} path="/greenhouse/day" title="Приёмка" subtitle={`${FARM_LABELS[s.farm] ?? s.farm} · что пришло из теплицы — по сортам, длинам и характеристикам`} />
      {!payrollSpreadsheetId() && (
        <div className="card border-[#8a5a00]/30 bg-[#fdf6e7] text-sm">Таблица теплицы ещё не подключена — записи не сохранятся. Попросите администратора открыть /api/payroll/setup.</div>
      )}
      <IntakeDayBoard key={`${s.farm}-${date}`} farm={s.farm} date={date} today={today} day={day} initialFlower={initial} varieties={varieties} recent={recent} last={last} canEdit={s.scope.editsLogs} save={saveIntakeDayAction} />
    </div>
  );
}

// --- Записи --------------------------------------------------------------------------------------------------------

const MAX_DAYS = 93;

export async function IntakeRecordsPage({ s, sp }: { s: IntakeSession; sp: Sp }) {
  if (!s.scope) return <NoAccess s={s} />;
  const today = localDayKey();
  const rows = await loadIntake(s.farm);
  // Без отбора — последние 7 дней, а не календарная неделя: в понедельник та была бы из одного дня.
  const range = sp.period ? reportRange({ period: sp.period, date: sp.date, from: sp.from, to: sp.to }, today) : reportRange({ period: "custom", from: shiftDay(today, -6), to: today }, today);
  const from = range.period === "custom" && Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) >= MAX_DAYS ? shiftDay(range.to, -(MAX_DAYS - 1)) : range.from;
  const to = range.to;
  const flower = isIntakeFlower(sp.flower) ? sp.flower : "";
  const block = String(sp.block ?? "").trim();
  const variety = String(sp.variety ?? "").trim();
  const shown = filterIntake(rows, { from, to, flower, block, variety });
  const dates = Array.from(new Set(shown.map((r) => r.date))).sort().reverse();
  const params: Record<string, string> = flower ? { flower } : {};
  const blocks = Array.from(new Set(rows.map((r) => r.block).filter(Boolean))).sort(compareBlocks);
  const varieties = Array.from(new Set(rows.filter((r) => !flower || r.flower === flower).map((r) => r.variety))).sort((a, b) => a.localeCompare(b));
  const flowersAll = flowersIn(rows).length ? flowersIn(rows) : [...INTAKE_FLOWERS];
  const filterHref = (f: IntakeFlower | "") => ghHref("/greenhouse/records", s.farm, { period: range.period, date: range.period === "custom" ? undefined : range.anchor, from: range.period === "custom" ? from : undefined, to: range.period === "custom" ? to : undefined, flower: f || undefined, block: block || undefined });
  const total = { acc: shown.filter((r) => r.kind === "accept").reduce((t, r) => t + r.qty, 0), rej: shown.filter((r) => r.kind === "reject").reduce((t, r) => t + r.qty, 0) };

  return (
    <div className="space-y-4">
      <Header s={s} path="/greenhouse/records" title="Записи" subtitle={`${FARM_LABELS[s.farm] ?? s.farm} · приёмка по дням`} />
      <GhFilterBar
        path="/greenhouse/records"
        farm={s.farm}
        params={params}
        period={range.period}
        from={from}
        to={to}
        anchor={range.anchor}
        title={range.title}
        prevAnchor={range.prevAnchor}
        nextAnchor={range.nextAnchor}
        periods={["day", "week", "month", "custom"]}
        today={today}
        blocks={blocks}
        block={block}
        varieties={varieties}
        variety={variety}
      >
        <FlowerChips value={flower} hrefFor={filterHref} flowers={flowersAll} />
      </GhFilterBar>
      {dates.length > 0 && (
        <div className="text-sm text-ink-secondary">
          {dates.length} {dates.length === 1 ? "день" : dates.length < 5 ? "дня" : "дней"} · принято <b className="text-ink-primary tabular-nums">{n0(total.acc)}</b> шт.
          {total.rej > 0 && (
            <>
              {" "}
              · брак <span className={rejectTone((total.rej * 100) / (total.acc + total.rej))}>{n0(total.rej)} шт. ({p1((total.rej * 100) / (total.acc + total.rej))})</span>
            </>
          )}
        </div>
      )}
      {dates.length === 0 ? (
        <div className="card text-sm text-ink-secondary">
          За этот период приёмки нет.
          {s.scope.editsLogs && (
            <>
              {" "}
              <Link href={ghHref("/greenhouse/day", s.farm, { date: to })} className="underline">
                Внести →
              </Link>
            </>
          )}
        </div>
      ) : (
        dates.map((d, i) => <IntakeDayCard key={d} date={d} rows={shown.filter((r) => r.date === d)} open={i === 0} farm={s.farm} canEdit={s.scope!.editsLogs} />)
      )}
    </div>
  );
}

function IntakeDayCard({ date, rows, open, farm, canEdit }: { date: string; rows: IntakeRow[]; open: boolean; farm: string; canEdit: boolean }) {
  const flowers = INTAKE_FLOWERS.filter((f) => rows.some((r) => r.flower === f));
  const stats = Object.fromEntries(flowers.map((f) => [f, intakeStats(rows, f)])) as Record<IntakeFlower, ReturnType<typeof intakeStats>>;
  return (
    <details className="card !p-0 overflow-hidden group" open={open}>
      <summary className="list-none cursor-pointer px-3 sm:px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 hover:bg-surface-plane/50">
        <span className="font-display font-extrabold text-[16px] first-letter:uppercase min-w-[11rem]">{longDay(date)}</span>
        {flowers.map((f) => (
          <span key={f} className="inline-flex items-center gap-1.5 text-sm">
            <span className="w-2 h-2 rounded-full" style={{ background: FLOWER_HEX[f] }} />
            {INTAKE_FLOWER_LABELS[f]} <b className="tabular-nums">{n0(stats[f].accepted)}</b>
            {stats[f].rejected > 0 && <span className={clsx("text-xs", rejectTone(stats[f].rejectPct))}>брак {p1(stats[f].rejectPct)}</span>}
          </span>
        ))}
        <span className="ml-auto text-ink-muted text-xs group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="border-t border-line-hairline divide-y divide-line-hairline">
        {flowers.map((f) => (
          <FlowerDaySheet key={f} flower={f} rows={rows.filter((r) => r.flower === f)} edit={canEdit ? ghHref("/greenhouse/day", farm, { date, flower: f }) : ""} />
        ))}
      </div>
    </details>
  );
}

/** Лист дня по цветку — как тетрадь приёмки: строка — сорт (и блок), колонки — длины, в конце характеристики. */
function FlowerDaySheet({ flower, rows, edit }: { flower: IntakeFlower; rows: IntakeRow[]; edit: string }) {
  const day = intakeDay(rows, rows[0]?.date ?? "");
  const used = intakeGrades(flower).filter((g) => day.lines.some((l) => l.cells[g]));
  const spec = INTAKE_SPECS[flower];
  const total = (g: string) => day.lines.reduce((s, l) => s + (l.cells[g]?.qty ?? 0), 0);
  const lineTotal = (l: (typeof day.lines)[number]) => Object.values(l.cells).reduce((s, c) => s + c.qty, 0);
  const all = day.lines.reduce((s, l) => s + lineTotal(l), 0);
  const hasBlocks = day.lines.some((l) => l.block);
  const lines = [...day.lines].sort((a, b) => a.variety.localeCompare(b.variety, "ru") || (a.block ? 0 : 1) - (b.block ? 0 : 1) || a.block.localeCompare(b.block, "ru", { numeric: true }));
  return (
    <div className="px-3 sm:px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: FLOWER_HEX[flower] }} />
        <span className="font-medium">{INTAKE_FLOWER_LABELS[flower]}</span>
        {edit && (
          <Link href={edit} className="ml-auto text-xs text-ink-secondary hover:underline">
            править →
          </Link>
        )}
      </div>
      {day.lines.length > 0 && (
        <>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-ink-muted border-b border-line-hairline">
                  <th className="text-left font-medium py-1.5 pr-2">Сорт</th>
                  {used.map((g) => (
                    <th key={g} className="text-right font-medium py-1.5 px-1.5" title={gradeLabel(flower, g)}>
                      {gradeShort(g)}
                    </th>
                  ))}
                  <th className="text-right font-medium py-1.5 px-2">Всего</th>
                  {spec.measures.map((m) => (
                    <th key={m.key} className="text-right font-medium py-1.5 px-1.5">
                      {m.short}, {m.unit}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={`${l.block}|${l.variety}`} className="border-b border-line-hairline/50">
                    <td className="py-1 pr-2">
                      <span className="font-medium">{l.variety}</span>
                      {hasBlocks && l.block && <span className="text-xs text-ink-muted"> · {/^\d+$/.test(l.block) ? `блок ${l.block}` : l.block}</span>}
                    </td>
                    {used.map((g) => (
                      <td key={g} className="py-1 px-1.5 text-right tabular-nums">
                        {l.cells[g] ? n0(l.cells[g].qty) : <span className="text-ink-muted/40">·</span>}
                      </td>
                    ))}
                    <td className="py-1 px-2 text-right tabular-nums font-semibold">{lineTotal(l) ? n0(lineTotal(l)) : "—"}</td>
                    {spec.measures.map((m) => (
                      <td key={m.key} className="py-1 px-1.5 text-right tabular-nums text-ink-secondary">
                        {l.measure && l.measure[m.key] ? l.measure[m.key].toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {lines.length > 1 && (
                <tfoot>
                  <tr className="text-xs">
                    <td className="py-1.5 pr-2 text-ink-secondary">Итого</td>
                    {used.map((g) => (
                      <td key={g} className="py-1.5 px-1.5 text-right tabular-nums font-medium">
                        {n0(total(g))}
                      </td>
                    ))}
                    <td className="py-1.5 px-2 text-right tabular-nums font-bold">{n0(all)}</td>
                    <td colSpan={spec.measures.length} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="sm:hidden space-y-2">
            {lines.map((l) => (
              <div key={`${l.block}|${l.variety}`} className="text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium truncate">{l.variety}</span>
                  {l.block && <span className="text-xs text-ink-muted">{l.block}</span>}
                  <span className="ml-auto tabular-nums font-semibold">{lineTotal(l) ? n0(lineTotal(l)) : ""}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {used
                    .filter((g) => l.cells[g])
                    .map((g) => (
                      <span key={g} className="text-[11px] rounded-md bg-surface-plane px-1.5 py-0.5 tabular-nums">
                        {gradeShort(g)}: <b>{n0(l.cells[g].qty)}</b>
                      </span>
                    ))}
                  {l.measure &&
                    spec.measures
                      .filter((m) => l.measure![m.key])
                      .map((m) => (
                        <span key={m.key} className="text-[11px] rounded-md border border-line-hairline px-1.5 py-0.5 tabular-nums text-ink-secondary">
                          {m.short} {l.measure![m.key].toLocaleString("ru-RU")} {m.unit}
                        </span>
                      ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {day.rejects.length > 0 && (
        <div className="text-sm">
          <div className="text-xs text-ink-muted mb-1">Брак</div>
          <div className="flex flex-wrap gap-1.5">
            {day.rejects.map((r) => (
              <span key={r.id} className="text-[12px] rounded-md bg-[#fbeceb] text-[#7d2a22] px-2 py-0.5" title={r.note || undefined}>
                {r.variety}: {reasonLabel(r.reason).toLowerCase()} — <b className="tabular-nums">{n0(r.qty)}</b>
                {r.note ? " · " + r.note : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Аналитика -----------------------------------------------------------------------------------------------------

export async function IntakeAnalyticsPage({ s, sp }: { s: IntakeSession; sp: Sp }) {
  if (!s.scope) return <NoAccess s={s} />;
  const today = localDayKey();
  const rows = await loadIntake(s.farm);
  // Без отбора — последние 30 дней: календарный месяц второго числа — это два дня, и сравнение с ними обманчиво.
  const range = sp.period ? reportRange({ period: sp.period, date: sp.date, from: sp.from, to: sp.to }, today) : reportRange({ period: "custom", from: shiftDay(today, -29), to: today }, today);
  const flower = isIntakeFlower(sp.flower) ? sp.flower : "";
  const block = String(sp.block ?? "").trim();
  const variety = String(sp.variety ?? "").trim();
  const prevR = previousRange(range.from, range.to);
  const now = filterIntake(rows, { from: range.from, to: range.to, flower, block, variety });
  const prev = filterIntake(rows, { ...prevR, flower, block, variety });
  const flowers = flowersIn(now);
  const flowersAll = flowersIn(rows).length ? flowersIn(rows) : [...INTAKE_FLOWERS];
  const blocks = Array.from(new Set(rows.map((r) => r.block).filter(Boolean))).sort(compareBlocks);
  const varieties = Array.from(new Set(rows.filter((r) => !flower || r.flower === flower).map((r) => r.variety))).sort((a, b) => a.localeCompare(b));
  const keep = { period: range.period, date: range.period === "custom" ? undefined : range.anchor, from: range.period === "custom" ? range.from : undefined, to: range.period === "custom" ? range.to : undefined };
  const filterHref = (f: IntakeFlower | "") => ghHref("/greenhouse/analytics", s.farm, { ...keep, flower: f || undefined, block: block || undefined });
  const excel = ghHref("/api/greenhouse/intake", s.farm, { ...keep, flower: flower || undefined, block: block || undefined, variety: variety || undefined });
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
  const vs = byVariety(now);
  const bl = byBlock(now).filter((b) => b.block);
  const reasons = byReason(now);
  const insights = intakeInsights(now, prev);

  return (
    <div className="space-y-4">
      <Header
        s={s}
        path="/greenhouse/analytics"
        title="Аналитика"
        subtitle={`${FARM_LABELS[s.farm] ?? s.farm} · приёмка цветка`}
        actions={
          <span className="no-print flex gap-2">
            <a href={excel} className="btn-secondary !py-1.5 text-sm whitespace-nowrap">
              Excel
            </a>
            <PrintButton />
          </span>
        }
      />
      <div className="no-print">
        <GhFilterBar
          path="/greenhouse/analytics"
          farm={s.farm}
          params={flower ? { flower } : {}}
          period={range.period}
          from={range.from}
          to={range.to}
          anchor={range.anchor}
          title={range.title}
          prevAnchor={range.prevAnchor}
          nextAnchor={range.nextAnchor}
          periods={["day", "week", "month", "quarter", "year", "custom"]}
          today={today}
          blocks={blocks}
          block={block}
          varieties={varieties}
          variety={variety}
        >
          <FlowerChips value={flower} hrefFor={filterHref} flowers={flowersAll} />
        </GhFilterBar>
      </div>
      <div className="hidden print:block font-display font-extrabold text-[18px]">
        Приёмка {FARM_LABELS[s.farm] ?? s.farm} — {range.title}
        {flower ? ` · ${INTAKE_FLOWER_LABELS[flower]}` : ""}
        {variety ? ` · ${variety}` : ""}
      </div>

      {!flowers.length ? (
        <div className="card text-sm text-ink-secondary">За этот период приёмки нет.</div>
      ) : (
        <>
          <div className={clsx("grid gap-3", flowers.length === 1 ? "md:grid-cols-[minmax(0,22rem)_1fr]" : flowers.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
            {flowers.map((f) => (
              <FlowerCard key={f} flower={f} now={intakeStats(now, f)} prev={prev.length ? intakeStats(prev, f) : null} prevLabel={`${ddmm(prevR.from)}–${ddmm(prevR.to)}`} />
            ))}
            {flowers.length === 1 && (
              <div className="card space-y-3">
                <h2 className="font-display font-extrabold text-[16px]">{INTAKE_SPECS[flowers[0]].gradeNoun === "Длина" ? "По длинам" : "По категориям"}</h2>
                <GradeRows flower={flowers[0]} grades={intakeStats(now, flowers[0]).byGrade} />
              </div>
            )}
          </div>

          {insights.length > 0 && (
            <div className="card space-y-2">
              <h2 className="font-display font-extrabold text-[16px]">Выводы</h2>
              <Insights lines={insights} />
            </div>
          )}

          {days > 1 && (
            <div className="card space-y-2">
              <h2 className="font-display font-extrabold text-[16px]">Принято по дням</h2>
              <DayBars days={byDay(now, range.from, range.to)} height={140} hrefFor={(d) => ghHref("/greenhouse/records", s.farm, { period: "day", date: d, flower: flower || undefined })} />
            </div>
          )}

          {flowers.length > 1 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {flowers.map((f) => (
                <div key={f} className="card space-y-3">
                  <h2 className="font-display font-extrabold text-[16px] inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: FLOWER_HEX[f] }} />
                    {INTAKE_FLOWER_LABELS[f]} · {INTAKE_SPECS[f].gradeNoun === "Длина" ? "по длинам" : "по категориям"}
                  </h2>
                  <GradeRows flower={f} grades={intakeStats(now, f).byGrade} />
                </div>
              ))}
            </div>
          )}

          <div className="card space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="font-display font-extrabold text-[16px]">Сорта</h2>
              <span className="text-xs text-ink-muted">нажмите на сорт — аналитика только по нему</span>
            </div>
            <VarietyTable rows={vs} hrefFor={(v) => ghHref("/greenhouse/analytics", s.farm, { ...keep, flower: v.flower, variety: v.variety, block: block || undefined })} />
          </div>

          <div className={clsx("grid gap-3", bl.length ? "lg:grid-cols-2" : "")}>
            <div className="card space-y-3">
              <h2 className="font-display font-extrabold text-[16px]">Брак по причинам</h2>
              <ReasonRows reasons={reasons} />
            </div>
            {bl.length > 0 && (
              <div className="card space-y-2">
                <h2 className="font-display font-extrabold text-[16px]">По блокам</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-ink-muted border-b border-line-hairline">
                      <th className="text-left font-medium py-1.5">Блок</th>
                      <th className="text-right font-medium py-1.5">Принято</th>
                      <th className="text-right font-medium py-1.5">Брак</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bl.map((b) => (
                      <tr key={b.block} className="border-b border-line-hairline/60">
                        <td className="py-1.5">
                          <Link href={ghHref("/greenhouse/analytics", s.farm, { ...keep, flower: flower || undefined, block: b.block })} className="hover:underline">
                            {/^\d+$/.test(b.block) ? `Блок ${b.block}` : b.block}
                          </Link>
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{n0(b.accepted)}</td>
                        <td className={clsx("py-1.5 text-right tabular-nums", rejectTone(b.rejectPct))}>{b.rejected ? p1(b.rejectPct) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
