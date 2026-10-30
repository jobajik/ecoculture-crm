import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import Hint from "@/components/Hint";
import GradeStackChart from "@/components/greenhouse/GradeStackChart";
import { Delta } from "@/components/greenhouse/rank";
import { num } from "@/components/greenhouse/parts";
import { changePct, changePoints, dayLabel, type Dashboard, type GhAlert } from "@/lib/greenhouse/dashboard";
import type { Forecast, ForecastAccuracy } from "@/lib/greenhouse/forecast";
import { ghHref } from "@/lib/greenhouse/farm";
import { QUALITY_COLORS, QUALITY_GROUPS } from "@/lib/greenhouse/views";
import { shiftDay } from "@/lib/payroll/work";

/**
 * Панель руководителя на «Обзоре» теплицы (30.10.2026, ТЗ владельца: «понять за 10–15 секунд, что происходит на
 * производстве»). Шесть цифр с изменением к такому же отрезку перед ним, «требует внимания», срезка за 30 дней тремя
 * группами качества и прогноз на три недели с честной подписью, как он ошибался раньше. Без "use client".
 */

const fmt1 = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`);

function Kpi({ label, value, delta, sub, hint, href }: { label: string; value: ReactNode; delta?: ReactNode; sub?: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-[11px] text-ink-muted">
        <span className="truncate">{label}</span>
        {hint && <Hint>{hint}</Hint>}
      </div>
      <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
        <span className="font-display font-extrabold text-[24px] leading-tight tabular-nums">{value}</span>
        {delta}
      </div>
      {sub && <div className="text-[11px] text-ink-secondary mt-0.5 line-clamp-2">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card !p-3.5 min-w-0 hover:border-section-greenhouse/40 transition-colors">
      {body}
    </Link>
  ) : (
    <div className="card !p-3.5 min-w-0">{body}</div>
  );
}

export function DashboardKpis({ dash, forecast, accuracy, farm }: { dash: Dashboard; forecast: Forecast | null; accuracy: ForecastAccuracy | null; farm: string }) {
  const weekChange = changePct(dash.week.qty, dash.prevWeek.qty);
  const plan = dash.plan;
  const lastDayNote =
    dash.todayTotals.qty > 0
      ? `сегодня ${num(dash.todayTotals.qty)}`
      : dash.lastDay
        ? `последний день — ${dayLabel(dash.lastDay)}: ${num(dash.lastDayTotals.qty)}`
        : "срезки ещё не было";
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <Kpi
        label="Срезано за 7 дней"
        value={num(dash.week.qty)}
        delta={weekChange !== null && Math.abs(weekChange) <= 200 && <Delta value={weekChange} unit="%" />}
        sub={weekChange !== null && Math.abs(weekChange) > 200 ? `неделей раньше ${num(dash.prevWeek.qty)}; ${lastDayNote}` : lastDayNote}
        hint="Стрелка — к 7 дням перед этим."
        href={ghHref("/greenhouse/report", farm, { period: "custom", from: shiftDay(dash.today, -6), to: dash.today })}
      />
      <Kpi
        label="С начала месяца"
        value={num(dash.month.qty)}
        delta={plan.hasPlan && plan.pacePct !== null && <span className={clsx("text-xs font-semibold", plan.pacePct >= 95 ? "text-status-good" : plan.pacePct >= 80 ? "text-[#9a6b00]" : "text-[#a12b2b]")}>{plan.pacePct} % плана</span>}
        sub={plan.hasPlan ? `план месяца ${num(plan.plan)}, к сегодня ${num(plan.planToDate)}` : "план агронома не загружен"}
        hint="План — «Прогноз срезки» агронома по неделям. Процент — от того, что по плану должно было быть срезано к сегодня."
        href={ghHref("/greenhouse/analytics", farm, { view: "plan" })}
      />
      <Kpi
        label="Товарные, 30 дней"
        value={fmt1(dash.last30.saleablePct)}
        delta={<Delta value={changePoints(dash.last30.saleablePct, dash.prev30.saleablePct)} />}
        sub={`высшая и 1-я — ${fmt1(dash.last30.topPct)}`}
        hint="Товарные — всё срезанное, кроме брака, нераскрывшегося и уценки. Стрелка — в пунктах к 30 дням перед этим."
        href={ghHref("/greenhouse/analytics", farm, { view: "harvest" })}
      />
      <Kpi
        label="Потери, 30 дней"
        value={fmt1(dash.loss30.lossPct)}
        delta={<Delta value={changePoints(dash.loss30.lossPct, dash.lossPrev30.lossPct)} invert />}
        sub={`${num(dash.loss30.lost)} шт.: брак на блоках и при срезке`}
        hint="Брак на блоках (повилика, клещ, тех брак…) и категория «Брак» при срезке — от всего, что дали блоки. Отход при посадке — отдельно, в «Потерях»."
        href={ghHref("/greenhouse/analytics", farm, { view: "losses" })}
      />
      <Kpi
        label="На блоках сейчас"
        value={`≈ ${num(dash.inField.onBeds)}`}
        sub={`${dash.inField.blocks} блоков растут или режутся`}
        hint="Посажено на растущих и режущихся блоках минус уже срезанное и брак на блоках."
      />
      <Kpi
        label="Прогноз на 3 недели"
        value={forecast ? `≈ ${num(forecast.total)}` : "—"}
        sub={forecast ? (accuracy?.medianError != null ? `обычно ошибается на ±${accuracy.medianError} %` : "по истории теплицы") : "мало завершённых блоков"}
        hint="По истории теплицы: выход и кривая срезки завершённых блоков, плюс темп последних трёх недель. Подробно — ниже."
      />
    </div>
  );
}

const ALERT_TONE: Record<GhAlert["level"], { dot: string; text: string }> = {
  bad: { dot: "bg-[#c0392b]", text: "text-ink-primary" },
  warn: { dot: "bg-[#e0a526]", text: "text-ink-primary" },
  info: { dot: "bg-[#7a8b99]", text: "text-ink-secondary" },
};

export function AlertsCard({ alerts, farm }: { alerts: GhAlert[]; farm: string }) {
  return (
    <section className="card !p-4 space-y-2.5">
      <h3 className="font-display font-bold text-[15px]">Требует внимания</h3>
      {alerts.length ? (
        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className={clsx("mt-1.5 w-2 h-2 rounded-full flex-none", ALERT_TONE[a.level].dot)} />
              <span className={ALERT_TONE[a.level].text}>
                {a.text}
                {a.href && (
                  <>
                    {" "}
                    <Link href={ghHref(a.href.path, farm, a.href.params)} className="text-xs underline text-ink-muted whitespace-nowrap">
                      смотреть
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-ink-secondary">Отклонений не видно: срезка идёт, брак и качество — как обычно.</div>
      )}
    </section>
  );
}

export function DailyHarvestCard({ dash }: { dash: Dashboard }) {
  const grades = QUALITY_GROUPS.map((g) => g.label);
  const any = dash.daily.some((d) => d.total > 0);
  return (
    <section className="card !p-4 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-display font-bold text-[15px]">Срезка за 30 дней</h3>
        <span className="text-xs text-ink-muted">
          {num(dash.last30.qty)} шт. · в день срезки ≈ {num(dash.last30.perDay)}
        </span>
      </div>
      {any ? (
        <>
          <GradeStackChart data={dash.daily} grades={grades} colors={QUALITY_COLORS} height={220} />
          <div className="flex flex-wrap gap-x-3 text-[11px] text-ink-muted">
            {QUALITY_GROUPS.map((g) => (
              <span key={g.key}>
                <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: g.color }} />
                {g.label}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="text-sm text-ink-secondary py-6">За 30 дней срезки не было.</div>
      )}
    </section>
  );
}

export function ForecastCard({ forecast, accuracy, farm, blockHref }: { forecast: Forecast | null; accuracy: ForecastAccuracy | null; farm: string; blockHref: (cycle: number, block: string) => string }) {
  if (!forecast)
    return (
      <section className="card !p-4 text-sm text-ink-secondary">
        <h3 className="font-display font-bold text-[15px] text-ink-primary mb-1">Прогноз срезки</h3>
        Для прогноза нужны завершённые блоки с записями срезки — после загрузки книги агронома он появится сам.
      </section>
    );
  const max = Math.max(...forecast.weeks.map((w) => w.qty), 1);
  const blocks = forecast.blocks.filter((b) => b.inHorizon > 0).slice(0, 6);
  return (
    <section className="card !p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-display font-bold text-[15px]">Прогноз срезки на 3 недели</h3>
        <span className="text-xs text-ink-muted">≈ {num(forecast.total)} шт.</span>
        <Link href={ghHref("/greenhouse/analytics", farm, { view: "plan" })} className="ml-auto text-xs underline text-ink-muted">
          план и факт →
        </Link>
      </div>
      <ul className="space-y-1.5">
        {forecast.weeks.map((w) => (
          <li key={w.from} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-3 text-sm">
            <span className="text-ink-secondary">{w.label}</span>
            <span className="h-2.5 rounded-full bg-surface-sunk overflow-hidden">
              <span className="block h-full rounded-full bg-section-greenhouse/70" style={{ width: `${(w.qty * 100) / max}%` }} />
            </span>
            <span className="text-right tabular-nums font-medium">≈ {num(w.qty)}</span>
          </li>
        ))}
      </ul>
      {blocks.length > 0 && (
        <div>
          <div className="text-[11px] text-ink-muted mb-1">Откуда возьмётся</div>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {blocks.map((b) => (
              <li key={`${b.cycle}-${b.block}`} className="flex items-baseline gap-2 min-w-0">
                <Link href={blockHref(b.cycle, b.block)} className="hover:underline truncate">
                  Блок {b.block} <span className="text-ink-muted text-xs">ц. {b.cycle}</span>
                </Link>
                <span className="text-xs text-ink-muted whitespace-nowrap">{b.startIsActual ? "режется" : `с ≈ ${dayLabel(b.start)}`}</span>
                <span className="ml-auto tabular-nums">≈ {num(b.inHorizon)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer">На чём основан прогноз</summary>
        <div className="mt-1.5 space-y-1 leading-relaxed">
          <p>
            Каждый растущий и режущийся блок: посажено × его обычный выход
            {forecast.curve.medianYield !== null ? ` (по теплице в среднем ${Math.round(forecast.curve.medianYield)} %)` : ""}, разложено по дням так, как блоки обычно режутся
            {forecast.curve.spanDays ? ` (≈ ${forecast.curve.spanDays} дн. от первой срезки)` : ""}. Начало — по первой срезке, иначе по плану срезки из дат цикла
            {forecast.curve.planDelay ? ` с поправкой на обычное опоздание (${Math.round(forecast.curve.planDelay)} дн.)` : ""}. Построено по {forecast.curve.blocks} завершённым блокам.
          </p>
          <p>
            Это смешано пополам с темпом последних трёх недель{forecast.paceTotal !== null ? ` (по темпу было бы ≈ ${num(forecast.paceTotal)}, по блокам ≈ ${num(forecast.modelTotal)})` : ""}.
            {accuracy?.medianError != null ? ` Проверено на прошлом: такой прогноз на 3 недели ошибался в среднем на ${accuracy.medianError} % (${accuracy.runs} проверок за год).` : ""}
          </p>
        </div>
      </details>
    </section>
  );
}
