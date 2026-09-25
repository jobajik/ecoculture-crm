import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import clsx from "clsx";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { getPlansForPeriod } from "@/lib/repo/plans";
import { listShipmentPlans } from "@/lib/repo/shipmentPlans";
import { getSalesSnapshot } from "@/lib/salesAnalytics";
import { ORDER_STATUSES, ROLES, weeksOfMonth } from "@/lib/constants";
import { buildPlanOverview, type PlanOverview } from "@/lib/planOverview";
import { shortMoney } from "@/lib/formatNumber";
import { localDayKey } from "@/lib/timezone";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import type { IconName } from "@/components/Icon";
import PeriodPicker from "@/components/PeriodPicker";
import PlanProgress, { paceTone, TONE_TEXT } from "@/components/PlanProgress";
import { plansTabsFor } from "./tabs";
import { forecastByWeek, monthFrom, prefetchPlanTabs } from "./data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pctText = (p: number | null) => (p === null ? "—" : `${Math.round(p)} %`);

/**
 * «Планы → Обзор»: как идёт месяц — продажи, отгрузки и срезка против своих
 * планов и против темпа. Устройство и причины — в `src/lib/planOverview.ts`.
 */
export default async function PlansOverviewPage({ searchParams }: { searchParams: { period?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) redirect("/");

  const month = monthFrom(searchParams.period);
  const weeks = weeksOfMonth(month);
  const now = new Date();

  await prefetchPlanTabs();
  const [orders, users, plans, shipmentPlans, forecast] = await Promise.all([
    listOrdersWithItems(),
    listUsers(),
    getPlansForPeriod(month),
    listShipmentPlans(),
    forecastByWeek(month),
  ]);
  const sales = await getSalesSnapshot(month, now, { orders, users, plans });
  const managers = users.filter((u) => u.active && u.role === ROLES.MANAGER);

  const ov = buildPlanOverview({
    month,
    today: localDayKey(now),
    weeks,
    sales,
    orders,
    shipmentPlans,
    forecast,
    activeManagers: managers.length,
    managersWithPlan: managers.filter((m) => (plans.get(m.email)?.targetAmount ?? 0) > 0).length,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });

  const q = `?period=${month}`;
  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader area="plans" title="Планы" tabs={plansTabsFor(role, month)} actions={<MonthPace ov={ov} />} />

      <PeriodPicker period={month} />

      <Checklist ov={ov} />

      <div className="grid gap-4 lg:grid-cols-3">
        <SalesCard ov={ov} href={`/plans/sales${q}`} />
        <ShipmentsCard ov={ov} href={`/plans/shipments${q}`} />
        <HarvestCard ov={ov} href={`/plans/balance${q}`} />
      </div>

      <FlowerMatrix ov={ov} />
    </div>
  );
}

function MonthPace({ ov }: { ov: PlanOverview }) {
  const { daysPassed, daysInMonth, pacePercent } = ov.pace;
  if (daysPassed === 0) return <p className="text-sm text-ink-muted">месяц ещё не начался</p>;
  if (daysPassed >= daysInMonth) return <p className="text-sm text-ink-muted">месяц закрыт</p>;
  return (
    <div className="flex items-center gap-3 text-sm text-ink-secondary">
      <span>
        день {daysPassed} из {daysInMonth}
      </span>
      <div className="w-24 h-1.5 rounded-full bg-surface-sunk overflow-hidden" aria-hidden>
        <div className="h-full bg-ink-muted/60" style={{ width: `${pacePercent}%` }} />
      </div>
      <span className="tabular-nums">{Math.round(pacePercent)} % месяца</span>
    </div>
  );
}

function Checklist({ ov }: { ov: PlanOverview }) {
  if (ov.checklist.every((c) => c.done)) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {ov.checklist.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          className={clsx(
            "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors hover:bg-surface-plane",
            c.done ? "border-line-hairline" : "border-status-warning/50 bg-status-warning/5"
          )}
        >
          <span
            aria-hidden
            className={clsx(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              c.done ? "bg-status-good/15 text-status-good" : "bg-status-warning/20 text-[#8a5a00]"
            )}
          >
            {c.done ? "✓" : "!"}
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{c.label}</span>
            <span className="block text-xs text-ink-secondary">{c.done ? `заполнен · ${c.detail}` : c.detail}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function CardShell({
  title,
  icon,
  href,
  action,
  children,
}: {
  title: string;
  icon: IconName;
  href: string;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <Section
      tone="plans"
      icon={icon}
      title={title}
      className="!mb-0"
      aside={
        <Link href={href} className="text-sm text-series-1 whitespace-nowrap hover:underline">
          {action} →
        </Link>
      }
    >
      <div className="flex flex-col gap-4">{children}</div>
    </Section>
  );
}

function Headline({ percent, pace, caption }: { percent: number | null; pace: number; caption: string }) {
  const tone = paceTone(percent, pace);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <span className={clsx("font-display text-3xl font-extrabold tabular-nums", TONE_TEXT[tone])}>{pctText(percent)}</span>
        <span className="text-sm text-ink-secondary">{caption}</span>
      </div>
      <PlanProgress percent={percent} pace={pace} />
      <p className={clsx("text-xs", TONE_TEXT[tone])}>{paceWords(percent, pace)}</p>
    </div>
  );
}

function paceWords(percent: number | null, pace: number): string {
  if (percent === null) return "плана нет — не с чем сравнивать";
  if (pace <= 0) return "месяц ещё не начался";
  const gap = Math.round(percent - pace);
  if (gap >= -5) return pace >= 100 ? "план месяца выполнен" : "идёт по темпу";
  return `отстаёт от темпа на ${Math.abs(gap)} п.п.`;
}

function MiniRow({ label, value, percent, pace }: { label: string; value: string; percent: number | null; pace: number }) {
  return (
    <li className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-1">
      <span className="text-sm">{label}</span>
      <span className="text-right text-xs text-ink-secondary tabular-nums">{value}</span>
      <span className="col-span-2">
        <PlanProgress percent={percent} pace={pace} size="sm" />
      </span>
    </li>
  );
}

function SalesCard({ ov, href }: { ov: PlanOverview; href: string }) {
  const s = ov.sales;
  const pace = ov.pace.pacePercent;
  return (
    <CardShell title="Продажи менеджеров" icon="chart" href={href} action="План продаж">
      <Headline
        percent={s.percent}
        pace={pace}
        caption={s.target > 0 ? `${shortMoney(s.fact)} из ${shortMoney(s.target)}` : `продано ${shortMoney(s.fact)}`}
      />
      {s.target > 0 && ov.pace.daysPassed > 0 && ov.pace.daysPassed < ov.pace.daysInMonth && (
        <p className="text-sm text-ink-secondary">
          Прогноз на конец месяца — <b className="tabular-nums">{shortMoney(s.forecast)}</b>
          {s.requiredPerDay > 0 && (
            <>
              ; чтобы успеть, нужно <b className="tabular-nums">{shortMoney(s.requiredPerDay)}</b> в день
            </>
          )}
          .
        </p>
      )}
      <ul className="space-y-3 border-t border-line-hairline pt-3">
        {s.byFlower.map((f) => (
          <MiniRow
            key={f.flowerType}
            label={f.label}
            value={f.target > 0 ? `${shortMoney(f.fact)} / ${shortMoney(f.target)}` : `${shortMoney(f.fact)} · плана нет`}
            percent={f.percent}
            pace={pace}
          />
        ))}
      </ul>
      {(s.behind.length > 0 || s.noPlan.length > 0) && (
        <div className="space-y-1 border-t border-line-hairline pt-3 text-sm">
          {s.behind.length > 0 && (
            <>
              <div className="text-xs text-ink-secondary">Отстают от темпа</div>
              <ul className="space-y-0.5">
                {s.behind.slice(0, 4).map((m) => (
                  <li key={m.name} className="flex justify-between gap-3">
                    <span className="truncate">{m.name}</span>
                    <span className="shrink-0 tabular-nums text-status-critical">{Math.round(m.percent)} %</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.noPlan.length > 0 && (
            <p className="text-xs text-[#8a5a00]">Продают без плана: {s.noPlan.join(", ")}</p>
          )}
        </div>
      )}
    </CardShell>
  );
}

function ShipmentsCard({ ov, href }: { ov: PlanOverview; href: string }) {
  const s = ov.shipments;
  const pace = ov.pace.pacePercent;
  return (
    <CardShell title="Отгрузки по направлениям" icon="truck" href={href} action="План отгрузок">
      <Headline
        percent={s.orderedPercent}
        pace={pace}
        caption={s.planStems > 0 ? `заказано ${nf(s.orderedStems)} из ${nf(s.planStems)} шт.` : `заказано ${nf(s.orderedStems)} шт.`}
      />
      <p className="text-sm text-ink-secondary">
        Уже отгружено <b className="tabular-nums">{nf(s.shippedToDate)} шт.</b>
        {s.expectedToDate > 0 && (
          <>
            {" "}
            · по плану к сегодня <span className="tabular-nums">{nf(s.expectedToDate)}</span>
          </>
        )}
      </p>
      <ul className="space-y-3 border-t border-line-hairline pt-3">
        {s.byFlower.map((f) => (
          <MiniRow
            key={f.flowerType}
            label={f.label}
            value={f.plan > 0 ? `${nf(f.ordered)} / ${nf(f.plan)} шт.` : `${nf(f.ordered)} шт. · плана нет`}
            percent={f.plan > 0 ? (f.ordered / f.plan) * 100 : null}
            pace={pace}
          />
        ))}
      </ul>
      {(s.behind.length > 0 || s.unplanned.length > 0) && (
        <div className="space-y-1 border-t border-line-hairline pt-3 text-sm">
          {s.behind.length > 0 && (
            <>
              <div className="text-xs text-ink-secondary">Заказано меньше темпа</div>
              <ul className="space-y-0.5">
                {s.behind.slice(0, 4).map((d) => (
                  <li key={d.direction} className="flex justify-between gap-3">
                    <span>{d.direction}</span>
                    <span className="shrink-0 tabular-nums text-status-critical">
                      {nf(d.ordered)} / {nf(d.plan)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.unplanned.length > 0 && (
            <p className="text-xs text-[#8a5a00]">
              Везут без плана: {s.unplanned.map((u) => `${u.direction} ${nf(u.ordered)}`).join(", ")}
            </p>
          )}
        </div>
      )}
    </CardShell>
  );
}

function HarvestCard({ ov, href }: { ov: PlanOverview; href: string }) {
  const h = ov.harvest;
  return (
    <CardShell title="Срезка против плана отгрузок" icon="leaf" href={href} action="По неделям">
      {!h.hasForecast && !h.hasPlan ? (
        <p className="text-sm text-ink-secondary">Нет ни прогноза срезки, ни плана отгрузок на этот месяц.</p>
      ) : (
        <ul className="space-y-4">
          {h.byFlower.map((f) => (
            <li key={f.flowerType} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{f.label}</span>
                <span
                  className={clsx(
                    "text-xs tabular-nums",
                    f.forecast <= 0 ? "text-ink-muted" : f.diff < 0 ? "text-status-critical" : f.diff > 0 ? "text-[#8a5a00]" : "text-status-good"
                  )}
                >
                  {f.forecast <= 0
                    ? "прогноза нет"
                    : f.diff < 0
                      ? `не хватит ${nf(-f.diff)} шт.`
                      : f.diff > 0
                        ? `лишних ${nf(f.diff)} шт.`
                        : "сходится"}
                </span>
              </div>
              <div className="text-xs text-ink-secondary tabular-nums">
                срезка {nf(f.forecast)} · в плане {nf(f.planned)}
              </div>
              {/* Недели месяца полосой: красная — плана больше, чем срежем; жёлтая —
                  срежем больше, чем распланировано; зелёная — сходится. */}
              <div className="flex gap-1" aria-label={`${f.label} по неделям`}>
                {f.weeks.map((w) => (
                  <span
                    key={w.code}
                    title={`Неделя ${w.index} (${w.label}): срезка ${nf(w.forecast)}, план ${nf(w.planned)}`}
                    className={clsx(
                      "flex-1 rounded-md py-1 text-center text-[11px] tabular-nums",
                      w.forecast <= 0 && w.planned <= 0
                        ? "bg-surface-sunk text-ink-muted"
                        : f.forecast <= 0
                          ? "bg-surface-sunk text-ink-secondary"
                          : w.diff < 0
                            ? "bg-status-critical/10 text-status-critical"
                            : w.diff > 0
                              ? "bg-status-warning/15 text-[#8a5a00]"
                              : "bg-status-good/10 text-status-good"
                    )}
                  >
                    {w.forecast <= 0 && w.planned <= 0 ? `н${w.index}` : f.forecast <= 0 ? `н${w.index}` : w.diff === 0 ? "0" : `${w.diff > 0 ? "+" : "−"}${compact(Math.abs(w.diff))}`}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {h.shortWeeks.length > 0 && (
        <p className="border-t border-line-hairline pt-3 text-xs text-status-critical">
          Не хватит цветка: {h.shortWeeks.slice(0, 3).map((w) => `${w.label.toLowerCase()}, ${w.week} — ${nf(w.missing)} шт.`).join("; ")}
        </p>
      )}
    </CardShell>
  );
}

function compact(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}к` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")}к` : String(n);
}

/** Сводка по цветку: все три плана в одной строке — где проседает именно этот цветок. */
function FlowerMatrix({ ov }: { ov: PlanOverview }) {
  const pace = ov.pace.pacePercent;
  return (
    <section className="card !p-0 table-scroll table-cards">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-secondary border-b border-line-hairline">
            <th className="px-4 py-2.5 font-medium">Цветок</th>
            <th className="px-4 py-2.5 font-medium">Продажи: факт / план</th>
            <th className="px-4 py-2.5 font-medium">Отгрузки: заказано / план</th>
            <th className="px-4 py-2.5 font-medium">Срезка / план отгрузок</th>
          </tr>
        </thead>
        <tbody>
          {ov.sales.byFlower.map((s, i) => {
            const sh = ov.shipments.byFlower.find((x) => x.flowerType === s.flowerType);
            const hv = ov.harvest.byFlower[i];
            const shPct = sh && sh.plan > 0 ? (sh.ordered / sh.plan) * 100 : null;
            return (
              <tr key={s.flowerType} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-3 font-medium">{s.label}</td>
                <td className="px-4 py-3 tabular-nums" data-label="Продажи">
                  {shortMoney(s.fact)} / {s.target > 0 ? shortMoney(s.target) : "—"}{" "}
                  <span className={TONE_TEXT[paceTone(s.percent, pace)]}>{pctText(s.percent)}</span>
                </td>
                <td className="px-4 py-3 tabular-nums" data-label="Отгрузки">
                  {nf(sh?.ordered ?? 0)} / {sh && sh.plan > 0 ? nf(sh.plan) : "—"}{" "}
                  <span className={TONE_TEXT[paceTone(shPct, pace)]}>{pctText(shPct)}</span>
                </td>
                <td className="px-4 py-3 tabular-nums" data-label="Срезка">
                  {hv.forecast > 0 ? nf(hv.forecast) : "—"} / {hv.planned > 0 ? nf(hv.planned) : "—"}
                  {hv.forecast > 0 && hv.planned > 0 && (
                    <span className={clsx("ml-1", hv.diff < 0 ? "text-status-critical" : "text-[#8a5a00]")}>
                      {hv.diff < 0 ? `−${nf(-hv.diff)}` : hv.diff > 0 ? `+${nf(hv.diff)}` : ""}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
