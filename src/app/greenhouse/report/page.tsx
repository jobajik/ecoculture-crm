import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import PrintButton from "@/components/greenhouse/dash/PrintButton";
import { Delta } from "@/components/greenhouse/rank";
import { num } from "@/components/greenhouse/parts";
import { FARM_LABELS } from "@/lib/constants";
import { GREENHOUSE_NO_ACCESS } from "@/lib/greenhouse/access";
import { buildReport, changePct, changePoints, dayLabel, type ReportRow } from "@/lib/greenhouse/dashboard";
import { loadGreenhousePlan } from "@/lib/greenhouse/dashboardData";
import { ghHref } from "@/lib/greenhouse/farm";
import { CUTTING_KINDS } from "@/lib/greenhouse/production";
import { REPORT_PERIODS, longDate, reportRange } from "@/lib/greenhouse/reportPeriod";
import { greenhouseSession } from "@/lib/greenhouse/session";
import { loadGreenhouse } from "@/lib/repo/greenhouse";
import { localDayKey } from "@/lib/timezone";
import { greenhouseTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * «Отчёты» теплицы (30.10.2026, ТЗ владельца: «ежедневный, недельный, месячный отчёт; по теплицам, сортам, потерям,
 * выполнению плана; сводный для руководителя; экспорт в Excel и PDF»). Один отчёт с выбором периода: сводка с
 * сравнением к такому же отрезку перед ним, блоки, сорта с планом агронома, потери и срезка по дням. Excel —
 * `/api/greenhouse/report` (те же цифры), PDF — печать браузера (меню и кнопки `no-print`).
 */
type Params = { farm?: string; period?: string; date?: string; from?: string; to?: string };

const fmt1 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`);
const STAGE = { block: "на блоке", harvest: "при срезке", planting: "при посадке" } as const;

export default async function GreenhouseReportPage({ searchParams }: { searchParams?: Params }) {
  const sp = searchParams ?? {};
  const { scope, farm } = await greenhouseSession(sp);
  const today = localDayKey();
  const range = reportRange(sp, today);
  const link = (patch: Params) => ghHref("/greenhouse/report", farm, { period: range.period, date: range.period === "custom" ? undefined : range.anchor, from: range.period === "custom" ? range.from : undefined, to: range.period === "custom" ? range.to : undefined, ...patch } as Record<string, string | undefined>);

  const header = (
    <div className="no-print">
      <PageHeader
        area="greenhouse"
        title="Отчёты"
        subtitle={FARM_LABELS[farm] ?? farm}
        icon="list"
        tabs={greenhouseTabsFor(scope, farm)}
        actions={scope && <GhFarmSwitch farm={farm} locked={!!scope.farmLocked} href={(f) => ghHref("/greenhouse/report", f, { period: range.period })} />}
      />
    </div>
  );
  if (!scope)
    return (
      <div className="space-y-5">
        {header}
        <div className="card text-sm text-ink-secondary">{GREENHOUSE_NO_ACCESS}</div>
      </div>
    );

  const [data, plan] = await Promise.all([loadGreenhouse(farm), loadGreenhousePlan(farm)]);
  const rep = buildReport(data, plan, range.from, range.to);
  const t = rep.totals;
  const p = rep.prev;
  const excelHref = `/api/greenhouse/report?${new URLSearchParams(Object.entries({ farm, period: range.period, date: range.anchor, from: range.from, to: range.to })).toString()}`;
  // Длинный период по дням не читается — дольше двух месяцев сводим по месяцам.
  const byMonth = rep.days > 62;
  const dayRows = byMonth ? groupByMonth(rep.byDay) : rep.byDay.map((d) => ({ ...d, label: dayLabel(d.date) }));

  return (
    <div className="space-y-5">
      {header}

      <div className="no-print card !p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_PERIODS.map((x) => (
            <Link
              key={x.key}
              href={ghHref("/greenhouse/report", farm, x.key === "custom" ? { period: "custom", from: range.from, to: range.to } : { period: x.key, date: range.anchor })}
              className={clsx("text-xs px-3 py-1.5 rounded-full border whitespace-nowrap", x.key === range.period ? "bg-ink-primary text-white border-ink-primary" : "border-line-hairline bg-surface hover:bg-surface-plane")}
            >
              {x.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {range.period === "custom" ? (
            <form className="flex flex-wrap items-center gap-2" action="/greenhouse/report">
              <input type="hidden" name="farm" value={farm} />
              <input type="hidden" name="period" value="custom" />
              <input type="date" name="from" defaultValue={range.from} max={today} className="input !w-auto" />
              <span className="text-ink-muted">—</span>
              <input type="date" name="to" defaultValue={range.to} max={today} className="input !w-auto" />
              <button type="submit" className="btn-secondary !py-1.5">
                Показать
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              {range.prevAnchor && (
                <Link href={link({ date: range.prevAnchor })} className="btn-secondary !px-2.5 !py-1.5" aria-label="Раньше">
                  ‹
                </Link>
              )}
              <span className="font-display font-bold text-[15px]">{range.title}</span>
              {range.nextAnchor ? (
                <Link href={link({ date: range.nextAnchor })} className="btn-secondary !px-2.5 !py-1.5" aria-label="Позже">
                  ›
                </Link>
              ) : (
                <span className="btn-secondary !px-2.5 !py-1.5 opacity-40">›</span>
              )}
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <a href={excelHref} className="btn-secondary !py-1.5 text-sm">
              Excel
            </a>
            <PrintButton />
          </div>
        </div>
      </div>

      <div className="report-doc space-y-5">
        <div>
          <h1 className="font-display font-extrabold text-[22px]">Отчёт теплицы — {FARM_LABELS[farm] ?? farm}</h1>
          <div className="text-sm text-ink-secondary">
            {range.title}
            {range.period !== "day" && range.period !== "custom" ? ` · ${longDate(range.from)} — ${longDate(range.to)}` : ""} · сравнение с таким же отрезком перед ним
          </div>
        </div>

        {t.qty === 0 && rep.loss.onBlocks === 0 ? (
          <div className="card text-sm text-ink-secondary">За этот период записей срезки и брака нет.</div>
        ) : (
          <>
            <section className="card !p-5">
              <h2 className="font-display font-bold text-[16px] mb-3">Сводка</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-4">
                <Fig label="Срезано" value={num(t.qty)} delta={<Delta value={changePct(t.qty, p.qty)} unit="%" />} sub={`было ${num(p.qty)}`} />
                <Fig label="Товарность" value={fmt1(t.saleablePct)} delta={<Delta value={changePoints(t.saleablePct, p.saleablePct)} />} sub={`${num(t.saleable)} товарных`} />
                <Fig label="Брак при срезке" value={fmt1(t.rejectPct)} delta={<Delta value={changePoints(t.rejectPct, p.rejectPct)} invert />} sub={`${num(t.reject)} шт.; некондиция ${num(t.substandard)}`} />
                <Fig label="Высшая и 1-я" value={fmt1(t.topPct)} delta={<Delta value={changePoints(t.topPct, p.topPct)} />} sub={t.avgWeight ? `вес стебля ${t.avgWeight} г` : undefined} />
                <Fig label="В день срезки" value={num(t.perDay)} sub={`${t.days} дн. срезки, ${t.blocks} блоков`} />
                <Fig label="Потери" value={fmt1(rep.loss.lossPct)} sub={`брак на блоках ${num(rep.loss.onBlocks)}`} />
                <Fig label="Отход при посадке" value={fmt1(rep.loss.cullPct)} sub={rep.loss.arrived ? `${num(rep.loss.culls)} из ${num(rep.loss.arrived)}` : "посадки не было"} />
                <Fig label="План агронома" value={rep.plan ? `${rep.planPct} %` : "—"} sub={rep.plan ? `${num(t.qty)} из ${num(rep.plan)}` : "плана на период нет"} />
              </div>
            </section>

            <section className="card !p-0 overflow-hidden">
              <h2 className="font-display font-bold text-[16px] px-5 pt-4 pb-2">По блокам</h2>
              <ReportTable rows={rep.byBlock} first="Блок" />
            </section>

            <section className="card !p-0 overflow-hidden">
              <h2 className="font-display font-bold text-[16px] px-5 pt-4 pb-2">По сортам</h2>
              <ReportTable rows={rep.byVariety} first="Сорт" withPlan={rep.plan > 0} />
            </section>

            <section className="card !p-5 space-y-2">
              <h2 className="font-display font-bold text-[16px]">Потери</h2>
              {rep.loss.reasons.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b border-line-hairline">
                      <th className="py-1.5 font-medium">Причина</th>
                      <th className="py-1.5 font-medium">Где</th>
                      <th className="py-1.5 font-medium text-right">Шт.</th>
                      <th className="py-1.5 font-medium text-right">Доля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rep.loss.reasons.map((r) => (
                      <tr key={`${r.stage}-${r.code}`} className="border-b border-line-hairline last:border-0">
                        <td className="py-1.5">{r.label}</td>
                        <td className="py-1.5 text-ink-secondary">{STAGE[r.stage]}</td>
                        <td className="py-1.5 text-right tabular-nums">{num(r.qty)}</td>
                        <td className="py-1.5 text-right tabular-nums">{Math.round(r.share)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-ink-secondary">Брака за период не записано.</div>
              )}
              {rep.cuttings.length > 0 && (
                <div className="text-xs text-ink-muted pt-1">
                  Черенкование за период: {rep.cuttings.map((c) => `${(CUTTING_KINDS.find((k) => k.code === c.kind)?.label ?? c.kind).toLowerCase()} ${num(c.qty)}`).join(", ")}.
                </div>
              )}
            </section>

            <section className="card !p-0 overflow-hidden">
              <h2 className="font-display font-bold text-[16px] px-5 pt-4 pb-2">{byMonth ? "По месяцам" : "По дням"}</h2>
              <table className="w-full text-sm table-cards">
                <thead>
                  <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                    <th className="px-4 py-2 font-medium">{byMonth ? "Месяц" : "День"}</th>
                    <th className="px-4 py-2 font-medium text-right">Срезано</th>
                    <th className="px-4 py-2 font-medium text-right">Товарность</th>
                    <th className="px-4 py-2 font-medium text-right">Брак при срезке</th>
                    <th className="px-4 py-2 font-medium text-right">Высшая и 1-я</th>
                    <th className="px-4 py-2 font-medium text-right">Брак на блоках</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((d) => (
                    <tr key={d.label} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-1.5">{d.label}</td>
                      <td data-label="Срезано" className="px-4 py-1.5 text-right tabular-nums font-medium">
                        {num(d.qty)}
                      </td>
                      <td data-label="Товарность" className="px-4 py-1.5 text-right tabular-nums">
                        {fmt1(d.qty ? Math.round((d.saleable * 1000) / d.qty) / 10 : null)}
                      </td>
                      <td data-label="Брак при срезке" className="px-4 py-1.5 text-right tabular-nums">
                        {d.reject ? num(d.reject) : "—"}
                      </td>
                      <td data-label="Высшая и 1-я" className="px-4 py-1.5 text-right tabular-nums">
                        {fmt1(d.qty ? Math.round((d.top * 1000) / d.qty) / 10 : null)}
                      </td>
                      <td data-label="Брак на блоках" className="px-4 py-1.5 text-right tabular-nums">
                        {d.waste ? num(d.waste) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Fig({ label, value, delta, sub }: { label: string; value: string; delta?: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-display font-extrabold text-[22px] tabular-nums">{value}</span>
        {delta}
      </div>
      {sub && <div className="text-[11px] text-ink-secondary truncate">{sub}</div>}
    </div>
  );
}

function ReportTable({ rows, first, withPlan }: { rows: ReportRow[]; first: string; withPlan?: boolean }) {
  if (!rows.length) return <div className="px-5 pb-4 text-sm text-ink-secondary">Нет записей.</div>;
  return (
    <table className="w-full text-sm table-cards">
      <thead>
        <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
          <th className="px-4 py-2 font-medium">{first}</th>
          <th className="px-4 py-2 font-medium text-right">Срезано</th>
          <th className="px-4 py-2 font-medium text-right">Товарность</th>
          <th className="px-4 py-2 font-medium text-right">Высшая и 1-я</th>
          <th className="px-4 py-2 font-medium text-right">Вес</th>
          <th className="px-4 py-2 font-medium text-right">Потери</th>
          {withPlan && <th className="px-4 py-2 font-medium text-right">План</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-line-hairline last:border-0">
            <td className="px-4 py-1.5 font-medium">{r.label}</td>
            <td data-label="Срезано" className="px-4 py-1.5 text-right tabular-nums">
              {num(r.qty)}
            </td>
            <td data-label="Товарность" className="px-4 py-1.5 text-right tabular-nums">
              {fmt1(r.saleablePct)}
            </td>
            <td data-label="Высшая и 1-я" className="px-4 py-1.5 text-right tabular-nums">
              {fmt1(r.topPct)}
            </td>
            <td data-label="Вес" className="px-4 py-1.5 text-right tabular-nums">
              {r.avgWeight ? `${r.avgWeight} г` : "—"}
            </td>
            <td data-label="Потери" className="px-4 py-1.5 text-right tabular-nums">
              {fmt1(r.lossPct)}
            </td>
            {withPlan && (
              <td data-label="План" className="px-4 py-1.5 text-right tabular-nums">
                {r.plan ? (
                  <span className={clsx((r.planPct ?? 0) < 90 && "text-[#a12b2b]")}>
                    {r.planPct} % <span className="text-ink-muted text-xs">из {num(r.plan)}</span>
                  </span>
                ) : (
                  <span className="text-ink-muted text-xs">вне плана</span>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
function groupByMonth(days: { date: string; qty: number; saleable: number; reject: number; top: number; waste: number }[]) {
  const map = new Map<string, { label: string; qty: number; saleable: number; reject: number; top: number; waste: number }>();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    const x = map.get(k) ?? { label: `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`, qty: 0, saleable: 0, reject: 0, top: 0, waste: 0 };
    x.qty += d.qty;
    x.saleable += d.saleable;
    x.reject += d.reject;
    x.top += d.top;
    x.waste += d.waste;
    map.set(k, x);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}
