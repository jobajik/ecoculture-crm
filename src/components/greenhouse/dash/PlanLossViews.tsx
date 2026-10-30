import Link from "next/link";
import clsx from "clsx";
import Hint from "@/components/Hint";
import { Delta } from "@/components/greenhouse/rank";
import { num } from "@/components/greenhouse/parts";
import { changePoints, dayLabel } from "@/lib/greenhouse/dashboard";
import type { Forecast, PlanFact } from "@/lib/greenhouse/forecast";
import type { LossReport, LossRow } from "@/lib/greenhouse/insights";

/**
 * «Аналитика → План» и «Аналитика → Потери» теплицы (30.10.2026, ТЗ владельца: «план… процент выполнения,
 * отклонения, выделять проблемные участки»; «потери по теплицам и сортам, динамика, причины, сравнение периодов»).
 * Без "use client": рисуют серверные страницы.
 */

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const fmt1 = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`);

function pctTone(p: number | null): string {
  if (p === null) return "text-ink-muted";
  return p >= 95 ? "text-status-good" : p >= 80 ? "text-[#9a6b00]" : "text-[#a12b2b]";
}

function Bar({ value, max, color = "bg-section-greenhouse/70", marker }: { value: number; max: number; color?: string; marker?: number | null }) {
  return (
    <span className="relative block h-2.5 rounded-full bg-surface-sunk overflow-hidden">
      <span className={clsx("block h-full rounded-full", color)} style={{ width: `${Math.min(100, max > 0 ? (value * 100) / max : 0)}%` }} />
      {marker !== null && marker !== undefined && max > 0 && <span className="absolute top-0 bottom-0 w-0.5 bg-ink-primary/60" style={{ left: `${Math.min(100, (marker * 100) / max)}%` }} />}
    </span>
  );
}

// --- План ----------------------------------------------------------------------------------------------------------

export function PlanView({
  pf,
  isCurrent,
  forecast,
  monthEnd,
  prevHref,
  nextHref,
  forecastHref,
}: {
  pf: PlanFact;
  isCurrent: boolean;
  forecast: Forecast | null;
  monthEnd: string;
  prevHref: string;
  nextHref: string | null;
  forecastHref: string | null;
}) {
  const stepper = (
    <div className="flex items-center gap-2">
      <Link href={prevHref} className="btn-secondary !px-2.5 !py-1.5" aria-label="Прошлый месяц">
        ‹
      </Link>
      <span className="font-display font-bold text-[15px] min-w-[9rem] text-center first-letter:uppercase">{monthName(pf.month)}</span>
      {nextHref ? (
        <Link href={nextHref} className="btn-secondary !px-2.5 !py-1.5" aria-label="Следующий месяц">
          ›
        </Link>
      ) : (
        <span className="btn-secondary !px-2.5 !py-1.5 opacity-40">›</span>
      )}
    </div>
  );
  // До конца месяца по прогнозу — только у текущего месяца.
  const ahead = isCurrent && forecast ? forecast.days.filter((d) => d.date <= monthEnd).reduce((s, d) => s + d.qty, 0) : null;
  const coversMonth = isCurrent && forecast ? forecast.to >= monthEnd : false;
  const expected = ahead !== null && coversMonth ? pf.fact + ahead : null;

  if (!pf.hasPlan)
    return (
      <section className="card !p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          {stepper}
          <span className="text-sm">
            Срезано за месяц: <b className="tabular-nums">{num(pf.fact)}</b>
          </span>
        </div>
        <div className="text-sm text-ink-secondary">
          План срезки на {monthName(pf.month)} не загружен. План ведёт агроном файлом в «Прогнозе срезки» — по неделям и сортам; как только он появится, здесь будет план против факта.
          {forecastHref && (
            <>
              {" "}
              <Link href={forecastHref} className="underline">
                Открыть «Прогноз срезки» →
              </Link>
            </>
          )}
        </div>
        {expected !== null && (
          <div className="text-sm">
            По прогнозу к концу месяца срежем ≈ <b className="tabular-nums">{num(expected)}</b>.
          </div>
        )}
      </section>
    );

  const maxWeek = Math.max(...pf.weeks.map((w) => Math.max(w.plan, w.fact)), 1);
  const behind = pf.weeks.filter((w) => w.when === "past" && w.pct !== null && w.pct < 90);
  const maxVar = Math.max(...pf.varieties.map((v) => Math.max(v.plan, v.fact)), 1);
  return (
    <>
      <section className="card !p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          {stepper}
          {forecastHref && (
            <Link href={forecastHref} className="text-xs underline text-ink-muted">
              план ведёт агроном в «Прогнозе срезки» →
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-[11px] text-ink-muted">План месяца</div>
            <div className="font-display font-extrabold text-[24px] tabular-nums">{num(pf.plan)}</div>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted">Срезано</div>
            <div className="font-display font-extrabold text-[24px] tabular-nums">{num(pf.fact)}</div>
            <div className={clsx("text-xs font-semibold", pctTone(pf.pct))}>{pf.pct ?? "—"} % плана месяца</div>
          </div>
          {isCurrent && (
            <div>
              <div className="flex items-center gap-1 text-[11px] text-ink-muted">
                К сегодня по плану <Hint>Прошедшие недели целиком, текущая — по прошедшим дням.</Hint>
              </div>
              <div className="font-display font-extrabold text-[24px] tabular-nums">{num(pf.planToDate)}</div>
              <div className={clsx("text-xs font-semibold", pctTone(pf.pacePct))}>{pf.pacePct !== null ? `идём на ${pf.pacePct} %` : "—"}</div>
            </div>
          )}
          {expected !== null && (
            <div>
              <div className="flex items-center gap-1 text-[11px] text-ink-muted">
                К концу месяца ≈ <Hint>Срезано + прогноз на оставшиеся дни месяца.</Hint>
              </div>
              <div className="font-display font-extrabold text-[24px] tabular-nums">≈ {num(expected)}</div>
              <div className={clsx("text-xs font-semibold", pctTone(pf.plan ? Math.round((expected * 100) / pf.plan) : null))}>{pf.plan ? `≈ ${Math.round((expected * 100) / pf.plan)} % плана` : ""}</div>
            </div>
          )}
        </div>
        {behind.length > 0 && (
          <div className="text-sm rounded-xl bg-[#fff6e5] border border-[#e0a526]/30 px-3 py-2">
            Отставание: {behind.map((w) => `${w.label} — ${w.pct} %`).join(", ")}.
          </div>
        )}
      </section>

      <section className="card !p-5 space-y-3">
        <h3 className="font-display font-bold text-[15px]">По неделям</h3>
        <ul className="space-y-2.5">
          {pf.weeks.map((w) => (
            <li key={w.code} className={clsx("grid grid-cols-[6.5rem_1fr_auto] sm:grid-cols-[8rem_1fr_7rem_7rem_4rem] items-center gap-x-3 gap-y-1 text-sm", w.when === "future" && "opacity-60")}>
              <span className="text-ink-secondary">
                {w.label}
                {w.when === "current" && <span className="ml-1 text-[10px] rounded-full bg-section-greenhouse-soft px-1.5">идёт</span>}
              </span>
              <Bar value={w.fact} max={maxWeek} marker={w.plan} color={w.when === "past" && w.pct !== null && w.pct < 90 ? "bg-[#e0a526]" : "bg-section-greenhouse/70"} />
              <span className="hidden sm:block text-right tabular-nums">{num(w.fact)}</span>
              <span className="hidden sm:block text-right tabular-nums text-ink-muted">из {num(w.plan)}</span>
              <span className={clsx("text-right tabular-nums font-semibold", w.when === "future" ? "text-ink-muted" : pctTone(w.pct))}>{w.pct !== null && w.when !== "future" ? `${w.pct} %` : "—"}</span>
            </li>
          ))}
        </ul>
        <div className="text-[11px] text-ink-muted">Полоса — срезано, чёрная риска — план недели.</div>
      </section>

      {pf.varieties.length > 0 && (
        <section className="card !p-5 space-y-3">
          <h3 className="font-display font-bold text-[15px]">По сортам</h3>
          <ul className="space-y-2">
            {pf.varieties.slice(0, 20).map((v) => (
              <li key={v.variety} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] sm:grid-cols-[11rem_1fr_7rem_7rem_4rem] items-center gap-x-3 text-sm">
                <span className="truncate">{v.variety}</span>
                <Bar value={v.fact} max={maxVar} marker={v.plan || null} color={v.plan && v.pct !== null && v.pct < 80 ? "bg-[#e0a526]" : "bg-section-greenhouse/70"} />
                <span className="hidden sm:block text-right tabular-nums">{num(v.fact)}</span>
                <span className="hidden sm:block text-right tabular-nums text-ink-muted">{v.plan ? `из ${num(v.plan)}` : "вне плана"}</span>
                <span className={clsx("text-right tabular-nums font-semibold", pctTone(v.pct))}>{v.pct !== null ? `${v.pct} %` : "—"}</span>
              </li>
            ))}
          </ul>
          <div className="text-[11px] text-ink-muted">План по сортам — за весь месяц, поэтому в середине месяца проценты ещё растут.</div>
        </section>
      )}
    </>
  );
}

// --- Потери ----------------------------------------------------------------------------------------------------------

const STAGE_LABEL = { block: "на блоке", harvest: "при срезке", planting: "при посадке" } as const;

export function LossView({
  loss,
  prev,
  months,
  periodChips,
  periodLabel,
}: {
  loss: LossReport;
  prev: LossReport;
  months: { month: string; harvested: number; lost: number; pct: number | null }[];
  periodChips: React.ReactNode;
  periodLabel: string;
}) {
  const growReasons = loss.reasons.filter((r) => r.stage !== "planting");
  const plantReasons = loss.reasons.filter((r) => r.stage === "planting");
  const maxReason = Math.max(...growReasons.map((r) => r.qty), 1);
  const maxMonth = Math.max(...months.map((m) => m.pct ?? 0), 1);
  const insight: string[] = [];
  const d = changePoints(loss.lossPct, prev.lossPct);
  if (loss.lossPct !== null && d !== null && Math.abs(d) >= 0.5) insight.push(`Потери ${d > 0 ? "выросли" : "снизились"}: ${fmt1(loss.lossPct)} против ${fmt1(prev.lossPct)} за такой же срок до этого.`);
  if (growReasons[0]) insight.push(`Главная причина — ${growReasons[0].label.toLowerCase()} (${num(growReasons[0].qty)} шт., ${Math.round(growReasons[0].share)} % потерь).`);
  const worst = loss.byBlock.filter((b) => b.harvested + b.lost >= 2000)[0];
  if (worst && worst.pct !== null) insight.push(`Больше всего теряет ${worst.label.toLowerCase()} — ${fmt1(worst.pct)}.`);
  return (
    <>
      <section className="card !p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          {periodChips}
          <span className="text-xs text-ink-muted">{periodLabel}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <div className="flex items-center gap-1 text-[11px] text-ink-muted">
              Потери <Hint>Брак на блоках и категория «Брак» при срезке — от всего, что дали блоки (срезано + брак на блоках).</Hint>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display font-extrabold text-[24px] tabular-nums">{fmt1(loss.lossPct)}</span>
              <Delta value={d} invert />
            </div>
            <div className="text-[11px] text-ink-secondary">{num(loss.lost)} шт.</div>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted">Брак на блоках</div>
            <div className="font-display font-extrabold text-[20px] tabular-nums">{num(loss.onBlocks)}</div>
          </div>
          <div>
            <div className="text-[11px] text-ink-muted">Брак при срезке</div>
            <div className="font-display font-extrabold text-[20px] tabular-nums">{num(loss.atHarvest)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-[11px] text-ink-muted">
              Некондиция <Hint>Нераскрывшийся и уценка: продаётся, но дешевле. В потери не входит.</Hint>
            </div>
            <div className="font-display font-extrabold text-[20px] tabular-nums">{num(loss.substandard)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-[11px] text-ink-muted">
              Отход при посадке <Hint>Брак отделения, рассадника и выбраковка — от пришедших черенков за период.</Hint>
            </div>
            <div className="font-display font-extrabold text-[20px] tabular-nums">{fmt1(loss.cullPct)}</div>
            <div className="text-[11px] text-ink-secondary">{num(loss.culls)} из {num(loss.arrived)}</div>
          </div>
        </div>
        {insight.length > 0 && (
          <ul className="space-y-1">
            {insight.map((l) => (
              <li key={l} className="flex gap-2 text-sm">
                <span className="text-section-greenhouse">●</span>
                {l}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <section className="card !p-5 space-y-3">
          <h3 className="font-display font-bold text-[15px]">Причины</h3>
          {growReasons.length ? (
            <ul className="space-y-2">
              {growReasons.map((r) => (
                <li key={`${r.stage}-${r.code}`} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] sm:grid-cols-[11rem_1fr_5.5rem_3.5rem] items-center gap-x-3 text-sm">
                  <span className="truncate">
                    {r.label} <span className="text-[11px] text-ink-muted">{STAGE_LABEL[r.stage]}</span>
                  </span>
                  <Bar value={r.qty} max={maxReason} color="bg-[#d9826b]" />
                  <span className="hidden sm:block text-right tabular-nums">{num(r.qty)}</span>
                  <span className="text-right tabular-nums text-ink-muted">{Math.round(r.share)} %</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-ink-secondary">За период брака не записано.</div>
          )}
          {plantReasons.length > 0 && (
            <div className="text-xs text-ink-muted pt-1 border-t border-line-hairline">
              При посадке: {plantReasons.map((r) => `${r.label.toLowerCase()} ${num(r.qty)}`).join(", ")}.
            </div>
          )}
        </section>

        <section className="card !p-5 space-y-3">
          <h3 className="font-display font-bold text-[15px]">Динамика по месяцам</h3>
          <div className="flex items-end gap-1.5 h-36">
            {months.map((m) => (
              <div key={m.month} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1" title={`${m.month}: ${fmt1(m.pct)}, ${num(m.lost)} из ${num(m.harvested)}`}>
                <span className="text-[10px] tabular-nums text-ink-muted">{m.pct !== null ? Math.round(m.pct) : ""}</span>
                <span className="w-full rounded-t bg-[#d9826b]/80" style={{ height: `${m.pct !== null ? Math.max(2, (m.pct * 100) / maxMonth) : 0}%` }} />
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            {months.map((m) => (
              <span key={m.month} className="flex-1 min-w-0 text-center text-[10px] text-ink-muted truncate">
                {MONTHS_SHORT[Number(m.month.slice(5, 7)) - 1]}
              </span>
            ))}
          </div>
          <div className="text-[11px] text-ink-muted">Потери, % — по месяцам за год.</div>
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <LossTable title="По блокам" rows={loss.byBlock} />
        <LossTable title="По сортам" rows={loss.byVariety} />
      </div>
    </>
  );
}

function LossTable({ title, rows }: { title: string; rows: LossRow[] }) {
  const list = rows.filter((r) => r.harvested + r.lost >= 200).slice(0, 15);
  const max = Math.max(...list.map((r) => r.pct ?? 0), 1);
  return (
    <section className="card !p-5 space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="font-display font-bold text-[15px]">{title}</h3>
        <span className="text-xs text-ink-muted">сверху — где теряем больше</span>
      </div>
      {list.length ? (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] sm:grid-cols-[9rem_1fr_6rem_4rem] items-center gap-x-3 text-sm">
              <span className="truncate">{r.label}</span>
              <Bar value={r.pct ?? 0} max={max} color="bg-[#d9826b]" />
              <span className="hidden sm:block text-right tabular-nums text-ink-muted">{num(r.lost)} шт.</span>
              <span className="text-right tabular-nums font-semibold">{fmt1(r.pct)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-ink-secondary">Нет данных за период.</div>
      )}
    </section>
  );
}

