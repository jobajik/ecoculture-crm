"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { CHART_COLORS, tooltipStyle } from "@/components/charts/ChartCard";
import KpiTile from "@/components/KpiTile";
import { formatDay } from "@/lib/formatDate";
import { decimal } from "@/lib/formatNumber";
import { ghHref } from "@/lib/greenhouse/farm";
import { AREA_LABELS, WORK_AREAS, WORK_TYPES, deltaPercent, monthRange, shiftDay, type AreaSummary, type WorkArea } from "@/lib/payroll/work";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";

/**
 * Аналитика выработки: четыре плитки участков (главный вид каждого — штук, часов, штук в час, людей), по выбранному
 * участку — график по дням, виды работ, люди (с полосой «доля от лучшего») и блоки. Числа с изменением к такому же
 * периоду перед этим — ради вопроса «лучше или хуже, чем в прошлый раз», а не ради самих чисел.
 */
export default function WorkAnalytics({
  farm,
  today,
  from,
  to,
  prevFrom,
  prevTo,
  area,
  summaries,
  previous,
}: {
  farm: string;
  today: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  area: WorkArea;
  summaries: Record<string, AreaSummary>;
  previous: Record<string, AreaSummary>;
}) {
  const router = useRouter();
  const big = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("ru-RU") : "—");
  const [pFrom, setPFrom] = useState(from);
  const [pTo, setPTo] = useState(to);
  const [peopleSort, setPeopleSort] = useState<"qty" | "perHour" | "hours" | "days">("qty");
  const s = summaries[area];
  const p = previous[area];
  const types = WORK_TYPES[area];

  const go = (next: { from?: string; to?: string; area?: string }) => {
    router.push(ghHref("/greenhouse/work/analytics", farm, { from: next.from ?? pFrom, to: next.to ?? pTo, area: next.area ?? area }));
  };
  const thisMonth = monthRange(today.slice(0, 7));
  const prevMonth = monthRange(shiftDay(thisMonth.from, -1).slice(0, 7));
  const quick = (label: string, f: string, t: string) => (
    <button type="button" className={clsx("text-xs px-2.5 py-1 rounded-full border", f === from && t === to ? "bg-ink-primary text-white border-ink-primary" : "border-line-hairline hover:bg-surface-plane")} onClick={() => go({ from: f, to: t })}>
      {label}
    </button>
  );

  const delta = (now: number, before: number) => {
    const d = deltaPercent(now, before);
    if (d === null) return null;
    return (
      <span className={clsx("tabular-nums", d > 0 ? "text-status-good" : d < 0 ? "text-status-critical" : "text-ink-muted")}>
        {d > 0 ? "+" : ""}
        {decimal(d, 1)} % к прошлому периоду
      </span>
    );
  };

  const chart = useMemo(() => s.days.map((d) => ({ date: d.date, label: formatDay(d.date).slice(0, 5), qty: d.qty, hours: d.hours, people: d.people })), [s.days]);
  const mainLabel = s.main?.label ?? types.find((t) => t.main)?.label ?? "";
  const mainUnit = s.main?.unit ?? "шт";
  const people = useMemo(() => {
    const list = [...s.people];
    list.sort((a, b) => {
      if (peopleSort === "perHour") return (b.perHour ?? -1) - (a.perHour ?? -1);
      if (peopleSort === "hours") return b.hours - a.hours;
      if (peopleSort === "days") return b.days - a.days;
      return b.qty - a.qty;
    });
    return list;
  }, [s.people, peopleSort]);
  const maxQty = Math.max(0, ...s.people.map((x) => x.qty));
  const usedTypes = types.filter((t) => s.types.some((x) => x.workType === t.code));
  const sortBtn = (key: typeof peopleSort, label: string) => (
    <button type="button" className={clsx("hover:underline", peopleSort === key && "font-semibold text-ink-primary")} onClick={() => setPeopleSort(key)}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="card !p-3 sm:!p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">С</label>
            <input type="date" className="input !w-auto !py-1.5" value={pFrom} max={today} onChange={(e) => setPFrom(e.target.value)} onBlur={() => pFrom && pFrom !== from && go({ from: pFrom })} />
          </div>
          <div>
            <label className="label">По</label>
            <input type="date" className="input !w-auto !py-1.5" value={pTo} max={today} onChange={(e) => setPTo(e.target.value)} onBlur={() => pTo && pTo !== to && go({ to: pTo })} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pb-1">
            {quick("7 дней", shiftDay(today, -6), today)}
            {quick("Этот месяц", thisMonth.from, thisMonth.to)}
            {quick("Прошлый месяц", prevMonth.from, prevMonth.to)}
            {quick("90 дней", shiftDay(today, -89), today)}
          </div>
          <div className="text-xs text-ink-muted sm:ml-auto pb-1.5">
            Сравнение с {formatDay(prevFrom)} — {formatDay(prevTo)}
          </div>
        </div>
      </div>

      {/* Участки */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {WORK_AREAS.map((a) => {
          const x = summaries[a];
          const y = previous[a];
          const on = a === area;
          const main = x.main;
          const d = main && y.main ? deltaPercent(main.qty, y.main.qty) : null;
          return (
            <button
              key={a}
              type="button"
              onClick={() => go({ area: a })}
              className={clsx("card !p-4 text-left transition-shadow hover:shadow-card-hover", on && "ring-2 ring-section-greenhouse/40 border-section-greenhouse/40")}
            >
              <div className="text-xs text-ink-muted">{AREA_LABELS[a]}</div>
              <div className="font-display font-extrabold text-[22px] tabular-nums mt-1.5 leading-none">
                {main ? big(main.qty) : "—"} <span className="text-sm font-normal text-ink-secondary">{main ? main.unit : ""}</span>
              </div>
              <div className="text-xs text-ink-secondary mt-2">
                {main ? `${main.label.toLowerCase()} · ${main.people} чел. · ${main.days} дн.` : "записей нет"}
                {d !== null && (
                  <span className={clsx("ml-1 font-semibold", d > 0 ? "text-status-good" : d < 0 ? "text-status-critical" : "text-ink-muted")}>
                    {d > 0 ? "+" : ""}
                    {decimal(d, 0)} %
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Выбранный участок */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon="leaf" label={`${mainLabel || "Выработка"}, ${mainUnit}`} value={s.main ? big(s.main.qty) : "—"} hint={s.main && p.main ? delta(s.main.qty, p.main.qty) : s.main ? `${s.main.days} дн.` : "за период записей нет"} />
        <KpiTile
          icon="clock"
          label={`${mainUnit === "шт" ? "Штук" : "Единиц"} в час`}
          value={s.main?.perHour !== null && s.main?.perHour !== undefined ? decimal(s.main.perHour, 1) : "—"}
          hint={s.main?.perHour != null && p.main?.perHour != null ? delta(s.main.perHour, p.main.perHour) : s.main ? `${decimal(s.main.hours, 0)} ч по виду «${mainLabel.toLowerCase()}»` : undefined}
        />
        <KpiTile icon="client" label="Людей" value={s.people.length || "—"} hint={s.personDays ? `${s.personDays} человеко-дней` : undefined} />
        <KpiTile icon="calendar" label="Дней с записями" value={s.days.length || "—"} hint={s.days.length ? `с ${formatDay(s.days[0].date)} по ${formatDay(s.days[s.days.length - 1].date)}` : undefined} />
      </div>

      {chart.length > 0 && (
        <ChartCard title={`${AREA_LABELS[area]} по дням`} description={`${mainLabel}: ${mainUnit} за день; в подсказке — часы и люди`} height={260}>
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} interval={chart.length > 40 ? Math.floor(chart.length / 20) : chart.length > 16 ? 1 : 0} />
              <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={56} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)} тыс` : String(v))} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(_l, payload) => (payload?.[0]?.payload?.date ? formatDay(payload[0].payload.date) : "")}
                formatter={(v, _n, item) => [`${big(Number(v))} ${mainUnit} · ${decimal(Number(item.payload?.hours ?? 0), 1)} ч · ${item.payload?.people ?? 0} чел.`, mainLabel]}
              />
              <Bar dataKey="qty" fill={CHART_COLORS.series3} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {s.types.length > 0 && (
        <div className="card !p-0">
          <div className="px-4 py-2.5 border-b border-line-hairline font-medium text-sm">Виды работ</div>
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Вид работ</th>
                <th className={clsx(TH, "text-right")}>Всего</th>
                <th className={clsx(TH, "text-right")}>Часов</th>
                <th className={clsx(TH, "text-right")}>В час</th>
                <th className={clsx(TH, "text-right")}>Людей</th>
                <th className={clsx(TH, "text-right")}>Дней</th>
                <th className={clsx(TH, "text-right")}>Блоков</th>
                <th className={clsx(TH, "text-right")}>Прошлый период</th>
              </tr>
            </thead>
            <tbody>
              {s.types.map((t) => {
                const was = p.types.find((x) => x.workType === t.workType);
                const nowV = t.basis === "qty" ? t.qty : t.hours;
                const wasV = was ? (was.basis === "qty" ? was.qty : was.hours) : 0;
                return (
                  <tr key={t.workType} className={TR}>
                    <td data-label="Вид работ" className="px-4 py-2 font-medium">
                      {t.label}
                    </td>
                    <td data-label="Всего" className="px-4 py-2 text-right tabular-nums">
                      {t.basis === "qty" ? `${big(t.qty)} ${t.unit}` : `${decimal(t.hours, 1)} ч`}
                    </td>
                    <td data-label="Часов" className="px-4 py-2 text-right tabular-nums">
                      {t.hours ? decimal(t.hours, 1) : "—"}
                    </td>
                    <td data-label="В час" className="px-4 py-2 text-right tabular-nums">
                      {t.basis === "qty" && t.hours > 0 ? decimal(t.qty / t.hours, 1) : "—"}
                    </td>
                    <td data-label="Людей" className="px-4 py-2 text-right tabular-nums">
                      {t.people}
                    </td>
                    <td data-label="Дней" className="px-4 py-2 text-right tabular-nums">
                      {t.days}
                    </td>
                    <td data-label="Блоков" className="px-4 py-2 text-right tabular-nums">
                      {t.blocks || "—"}
                    </td>
                    <td data-label="Прошлый период" className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                      {was ? `${big(wasV)} ${t.basis === "qty" ? t.unit : "ч"}` : "—"}{" "}
                      {was && deltaPercent(nowV, wasV) !== null && (
                        <span className={clsx("text-xs", nowV >= wasV ? "text-status-good" : "text-status-critical")}>
                          ({nowV >= wasV ? "+" : ""}
                          {decimal(deltaPercent(nowV, wasV)!, 0)} %)
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {people.length > 0 && (
        <div className="card !p-0">
          <div className="px-4 py-2.5 border-b border-line-hairline flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">Сотрудники</span>
            <span className="text-xs text-ink-muted">
              сортировать: {sortBtn("qty", "выработка")} · {sortBtn("perHour", "в час")} · {sortBtn("hours", "часы")} · {sortBtn("days", "дни")}
            </span>
          </div>
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>#</th>
                <th className={TH}>Сотрудник</th>
                <th className={clsx(TH, "text-right")}>{mainLabel || "Всего"}</th>
                {usedTypes
                  .filter((t) => !t.main)
                  .map((t) => (
                    <th key={t.code} className={clsx(TH, "text-right hidden lg:table-cell")}>
                      {t.label}
                    </th>
                  ))}
                <th className={clsx(TH, "text-right")}>Часов</th>
                <th className={clsx(TH, "text-right")}>В час</th>
                <th className={clsx(TH, "text-right")}>Дней</th>
              </tr>
            </thead>
            <tbody>
              {people.map((x, i) => {
                const main = x.byType[s.main?.workType ?? ""];
                return (
                  <tr key={x.key} className={TR}>
                    <td className="px-4 py-2 text-ink-muted tabular-nums">{i + 1}</td>
                    <td data-label="Сотрудник" className="px-4 py-2">
                      <div className="font-medium">
                        {x.employeeId ? (
                          <Link href={`/payroll/employees/${x.employeeId}`} className="hover:underline">
                            {x.name}
                          </Link>
                        ) : (
                          <>
                            {x.name} <span className="text-xs text-[#8a5a00]">без карточки</span>
                          </>
                        )}
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-sunk mt-1 max-w-[16rem]">
                        <div className="h-full rounded-full bg-section-greenhouse/70" style={{ width: `${maxQty ? Math.round((x.qty / maxQty) * 100) : 0}%` }} />
                      </div>
                    </td>
                    <td data-label={mainLabel} className="px-4 py-2 text-right tabular-nums font-medium">
                      {main ? big(main.qty || main.hours) : "—"}
                    </td>
                    {usedTypes
                      .filter((t) => !t.main)
                      .map((t) => {
                        const v = x.byType[t.code];
                        return (
                          <td key={t.code} data-label={t.label} className="px-4 py-2 text-right tabular-nums hidden lg:table-cell text-ink-secondary">
                            {v ? (t.basis === "qty" ? big(v.qty) : `${decimal(v.hours, 1)} ч`) : "—"}
                          </td>
                        );
                      })}
                    <td data-label="Часов" className="px-4 py-2 text-right tabular-nums">
                      {x.hours ? decimal(x.hours, 1) : "—"}
                    </td>
                    <td data-label="В час" className="px-4 py-2 text-right tabular-nums">
                      {x.perHour !== null ? decimal(x.perHour, 1) : "—"}
                    </td>
                    <td data-label="Дней" className="px-4 py-2 text-right tabular-nums">
                      {x.days}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {s.blocks.length > 0 && (
        <div className="card !p-0">
          <div className="px-4 py-2.5 border-b border-line-hairline font-medium text-sm">Блоки</div>
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Блок</th>
                {usedTypes.map((t) => (
                  <th key={t.code} className={clsx(TH, "text-right", !t.main && "hidden md:table-cell")}>
                    {t.label}
                  </th>
                ))}
                <th className={clsx(TH, "text-right")}>Людей</th>
                <th className={clsx(TH, "text-right")}>Дней</th>
              </tr>
            </thead>
            <tbody>
              {s.blocks.map((b) => (
                <tr key={b.block} className={TR}>
                  <td data-label="Блок" className="px-4 py-2 font-medium tabular-nums">
                    {b.block}
                  </td>
                  {usedTypes.map((t) => (
                    <td key={t.code} data-label={t.label} className={clsx("px-4 py-2 text-right tabular-nums", !t.main && "hidden md:table-cell")}>
                      {b.byType[t.code] ? (t.basis === "qty" ? big(b.byType[t.code]) : `${decimal(b.byType[t.code], 1)} ч`) : "—"}
                    </td>
                  ))}
                  <td data-label="Людей" className="px-4 py-2 text-right tabular-nums">
                    {b.people}
                  </td>
                  <td data-label="Дней" className="px-4 py-2 text-right tabular-nums">
                    {b.days}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.entries === 0 && (
        <div className="card text-sm text-ink-secondary">
          По участку «{AREA_LABELS[area]}» за {formatDay(from)} — {formatDay(to)} записей нет. Внесите день на вкладке «Ввод за день» или загрузите историю в «Журнале».
        </div>
      )}
    </div>
  );
}
