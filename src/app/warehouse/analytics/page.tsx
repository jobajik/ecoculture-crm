import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { listShipments } from "@/lib/repo/shipments";
import { listWriteoffs } from "@/lib/repo/writeoffs";
import { listStaffTakeouts } from "@/lib/repo/staffTakeouts";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { getSettings } from "@/lib/repo/settings";
import { prefetchTables } from "@/lib/sheets";
import {
  FARM_ORDER,
  ROLES,
  SHEET_TABS,
  farmLabel,
  isValidPeriod,
  periodLabel,
  periodOf,
} from "@/lib/constants";
import { buildStockAnalytics, type StockFlow } from "@/lib/stockAnalytics";
import { missingFarm } from "@/lib/access";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import PeriodPicker from "@/components/PeriodPicker";
import Hint from "@/components/Hint";
import Change from "@/components/Change";
import StockBreakdown from "@/components/StockBreakdown";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

/**
 * «Склад → Аналитика»: движение цветка за месяц в сравнении с прошлым.
 * Расчёт — `buildStockAnalytics()` в `src/lib/stockAnalytics.ts`.
 * Зав. складом видит своё производство, администратор — всё с переключателем.
 */
export default async function StockAnalyticsPage({
  searchParams,
}: {
  searchParams?: { period?: string; farm?: string; view?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.WAREHOUSE && role !== ROLES.ADMIN)
    redirect("/?error=forbidden");

  const ownFarm =
    role === ROLES.WAREHOUSE ? (session?.user?.farm ?? null) : null;
  if (role === ROLES.WAREHOUSE && missingFarm(role, ownFarm)) {
    return (
      <div>
        <PageHeader
          area="stock"
          title="Аналитика склада"
          icon="chart"
          tabs={WAREHOUSE_TABS}
        />
        <p className="card text-sm">
          В вашей карточке не указано производство — аналитика склада не
          откроется.
        </p>
      </div>
    );
  }
  const chosen = FARM_ORDER.includes(searchParams?.farm ?? "")
    ? searchParams!.farm!
    : "";
  const farm = ownFarm || chosen || null;
  const period =
    searchParams?.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());

  // Шесть вкладок — одним запросом к Google (грабли 1.17).
  await prefetchTables([
    SHEET_TABS.BATCHES,
    SHEET_TABS.SHIPMENTS,
    SHEET_TABS.WRITEOFFS,
    SHEET_TABS.STAFF_TAKEOUTS,
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.SETTINGS,
  ]);
  const [batches, shipments, writeoffs, takeouts, orders, settings] =
    await Promise.all([
      listBatches(),
      listShipments(),
      listWriteoffs(),
      listStaffTakeouts(),
      listOrdersWithItems(),
      getSettings(),
    ]);

  const a = buildStockAnalytics({
    batches,
    shipments,
    writeoffs,
    takeouts,
    orders,
    settings,
    period,
    today: localDayKey(),
    farm,
  });
  const c = a.current;
  const p = a.previous;
  const hasPrev = p.received + a.prevShipped > 0;
  const prevName = periodLabel(a.prevPeriod).split(" ")[0].toLowerCase();
  const writeoffPct = (f: StockFlow) =>
    f.received > 0 ? (f.writtenOff / f.received) * 100 : 0;
  const farmHref = (f: string) =>
    `/warehouse/analytics?period=${period}${f ? `&farm=${f}` : ""}`;

  const outs = [
    { label: "Клиентам", value: c.toClients, cls: "bg-accent" },
    { label: "В наши магазины", value: c.toShops, cls: "bg-accent/60" },
    { label: "Опт на город", value: c.toRegions, cls: "bg-accent/30" },
    { label: "Списано", value: c.writtenOff, cls: "bg-status-critical/70" },
    {
      label: "Сотрудникам и на нужды",
      value: c.toStaff + c.toCompany,
      cls: "bg-ink-muted/50",
    },
  ];
  const outTotal = outs.reduce((s, o) => s + Math.max(0, o.value), 0);
  const maxWeek = Math.max(
    1,
    ...a.weeks.map((w) => Math.max(w.received, w.shipped + w.writtenOff)),
  );

  // Новый вид (19.10.2026): шесть цифр плитками, а всё остальное — одна карточка с вкладками вместо шести блоков
  // лентой. Вкладка живёт в адресе вместе с месяцем и производством.
  const VIEWS = [
    { key: "move", label: "Движение" },
    { key: "cuts", label: "Разрезы" },
    { key: "weeks", label: "По неделям" },
    { key: "losses", label: "Списания", n: a.losses.length },
  ];
  const view = VIEWS.some((v) => v.key === searchParams?.view) ? searchParams!.view! : "move";
  const viewHref = (v: string) =>
    `/warehouse/analytics?period=${period}${farm && !ownFarm ? `&farm=${farm}` : ""}${v !== "move" ? `&view=${v}` : ""}`;
  const change = (now: number, before: number, invert = false) =>
    hasPrev ? <Change now={now} before={before} invert={invert} /> : null;

  return (
    <div>
      <PageHeader
        area="stock"
        title={`Аналитика склада${ownFarm ? ` · ${farmLabel(ownFarm)}` : ""}`}
        icon="chart"
        tabs={WAREHOUSE_TABS}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <PeriodPicker period={period} />
        {!ownFarm && (
          <div className="flex flex-wrap gap-2">
            {[
              { key: "", label: "Всё" },
              ...FARM_ORDER.map((f) => ({ key: f, label: farmLabel(f) })),
            ].map((f) => (
              <Link
                key={f.key || "all"}
                href={`${farmHref(f.key)}${view !== "move" ? `&view=${view}` : ""}`}
                className={
                  (farm ?? "") === f.key
                    ? "h-8 px-3 rounded-full border text-[13px] grid place-items-center bg-ink-primary text-white border-ink-primary"
                    : "h-8 px-3 rounded-full border text-[13px] grid place-items-center bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary"
                }
              >
                {f.label}
              </Link>
            ))}
          </div>
        )}
        <span className="text-sm text-ink-muted">
          {hasPrev
            ? `сравнение с: ${prevName}`
            : `за ${prevName} движения нет — сравнивать не с чем`}
          <Hint>
            Приход — по дню приёмки партии, отгрузки и списания — по дню записи.
            Остаток на начало и конец месяца собран из движений. «Хватит, дн.» —
            на сколько дней хватит остатка при темпе отгрузок этого месяца.
            «Старше срока» — лежит дольше срока хранения из настроек.
          </Hint>
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-5">
        <KpiTile
          icon="upload"
          label="Приход"
          value={nf(c.received)}
          hint={
            <>
              {change(c.received, p.received)}
              {c.initialLoad > 0 && <span className="block">в т.ч. загрузка {formatDay(c.initialLoadDay)}: {nf(c.initialLoad)}</span>}
            </>
          }
        />
        <KpiTile icon="truck" label="Отгружено" value={nf(a.shipped)} hint={change(a.shipped, a.prevShipped)} />
        <KpiTile
          icon="alert"
          label="Списано"
          value={nf(c.writtenOff)}
          hint={
            <>
              {change(c.writtenOff, p.writtenOff, true)}
              {c.received > 0 && <span className="block">{Math.round(writeoffPct(c))} % от прихода</span>}
            </>
          }
          tone={writeoffPct(c) >= 10 ? "warn" : undefined}
        />
        <KpiTile icon="box" label="Остаток сейчас" value={nf(a.stockNow)} hint="стеблей в партиях" />
        <KpiTile
          icon="calendar"
          label="Хватит на"
          value={a.coverDays !== null ? `${nf(a.coverDays)} дн.` : "—"}
          hint="при темпе отгрузок месяца"
          tone={a.coverDays !== null && a.coverDays > 10 ? "warn" : undefined}
        />
        <KpiTile
          icon="clock"
          label="Старше срока"
          value={nf(a.expiredNow)}
          hint={a.warningNow > 0 ? `скоро выйдет срок: ${nf(a.warningNow)}` : a.expiredNow > 0 ? "стеблей" : "всё в сроке"}
          tone={a.expiredNow > 0 ? "bad" : a.warningNow > 0 ? "warn" : "good"}
        />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={viewHref(v.key)}
              className={
                view === v.key
                  ? "py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-section-stock text-ink-primary font-semibold"
                  : "py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-transparent text-ink-secondary hover:text-ink-primary"
              }
            >
              {v.label}
              {v.n !== undefined && v.n > 0 && <span className="tabular-nums text-status-critical font-semibold"> {v.n}</span>}
            </Link>
          ))}
        </div>

        {view === "move" && (
          <div className="grid lg:grid-cols-2 lg:divide-x divide-line-hairline">
            {/* --- Движение за месяц -------------------------------------------- */}
            <div className="px-4 sm:px-5 py-4 min-w-0 space-y-3">
              <h3 className="font-display text-[15px] font-bold">Движение за месяц</h3>
              <dl className="text-sm divide-y divide-line-hairline/70">
                <Line label={`Остаток на начало (${formatDay(`${period}-01`)})`} value={c.opening} />
                <Line label="+ Приход" value={c.received} strong />
                <Line label="− Клиентам" value={c.toClients} sub />
                <Line label="− В наши магазины" value={c.toShops} sub />
                <Line label="− Опт на город" value={c.toRegions} sub />
                <Line label="− Списано" value={c.writtenOff} sub danger={c.writtenOff > 0} />
                <Line label="− Сотрудникам и на нужды" value={c.toStaff + c.toCompany} sub />
                <Line
                  label={`= Остаток на конец (${formatDay(c.days > 0 ? endLabel(period, c.days) : `${period}-01`)})`}
                  value={c.closing}
                  strong
                />
              </dl>
              {a.unexplained !== 0 && (
                <p className="text-xs text-[#8a5a00]">
                  В партиях сейчас {nf(a.stockNow)} — на {nf(Math.abs(a.unexplained))}{" "}
                  {a.unexplained < 0 ? "меньше" : "больше"}, чем по записям движений. Значит, часть стеблей ушла или
                  пришла без записи — стоит{" "}
                  <Link href="/warehouse/writeoff?mode=recount" className="underline">
                    сделать пересчёт склада
                  </Link>
                  .
                </p>
              )}
            </div>

            {/* --- Куда ушёл цветок --------------------------------------------- */}
            <div className="px-4 sm:px-5 py-4 min-w-0 space-y-3 border-t lg:border-t-0 border-line-hairline">
              <h3 className="font-display text-[15px] font-bold">Куда ушёл цветок</h3>
              {outTotal > 0 ? (
                <>
                  <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Доли расхода">
                    {outs.map((o) =>
                      o.value > 0 ? (
                        <div
                          key={o.label}
                          className={o.cls}
                          style={{ width: `${(o.value / outTotal) * 100}%` }}
                          title={o.label}
                        />
                      ) : null,
                    )}
                  </div>
                  <ul className="space-y-1.5 text-sm">
                    {outs.map((o) => (
                      <li key={o.label} className="flex items-baseline gap-2">
                        <span className={`inline-block w-2.5 h-2.5 rounded-sm ${o.cls}`} />
                        <span className="flex-1 min-w-0">{o.label}</span>
                        <span className="tabular-nums text-ink-secondary">
                          {Math.round((Math.max(0, o.value) / outTotal) * 100)} %
                        </span>
                        <span className="shrink-0 w-24 text-right tabular-nums">{nf(o.value)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-ink-muted">За месяц со склада ничего не уходило.</p>
              )}
            </div>
          </div>
        )}

        {view === "cuts" && (
          <StockBreakdown rows={{ flower: a.byFlower, grade: a.byGrade, variety: a.byVariety }} hasPrev={hasPrev} />
        )}

        {view === "weeks" && (
          <>
            <p className="px-4 sm:px-5 py-2.5 text-xs text-ink-muted border-b border-line-hairline">
              Верхняя полоска — приход, нижняя — отгружено и списано (красным) в одном масштабе.
            </p>
            <ul className="divide-y divide-line-hairline/70">
              {a.weeks.map((w) => (
                <li key={w.label} className="px-4 sm:px-5 py-2.5 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {w.label}
                      {w.hasInitialLoad && (
                        <span className="ml-1.5 text-xs font-normal text-ink-muted">загрузка остатков</span>
                      )}
                    </span>
                    {w.future ? (
                      <span className="text-xs text-ink-muted">ещё впереди</span>
                    ) : (
                      <span className="text-xs text-ink-secondary tabular-nums">
                        +{nf(w.received)} · −{nf(w.shipped)}
                        {w.writtenOff > 0 && <span className="text-status-critical"> · списано {nf(w.writtenOff)}</span>}
                      </span>
                    )}
                  </div>
                  {!w.future && (
                    <div className="mt-1.5 space-y-1">
                      <div className="h-1.5 rounded-full bg-surface-sunk">
                        <div className="h-full rounded-full bg-accent/40" style={{ width: `${(w.received / maxWeek) * 100}%` }} />
                      </div>
                      <div className="flex h-1.5 gap-0.5 rounded-full bg-surface-sunk overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${(Math.max(0, w.shipped) / maxWeek) * 100}%` }} />
                        {w.writtenOff > 0 && (
                          <div className="h-full bg-status-critical/70" style={{ width: `${(w.writtenOff / maxWeek) * 100}%` }} />
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {view === "losses" && (
          <>
            <p className="px-4 sm:px-5 py-2.5 text-xs text-ink-muted border-b border-line-hairline">
              Где больше всего списали: сорт и ростовка за месяц, процент — от прихода этой же позиции.
            </p>
            {a.losses.length === 0 ? (
              <p className="px-4 sm:px-5 py-10 text-center text-sm text-ink-muted">За месяц ничего не списывали.</p>
            ) : (
              <ul className="divide-y divide-line-hairline/70">
                {a.losses.map((l) => (
                  <li key={l.key} className="flex items-baseline gap-3 px-4 sm:px-5 py-2 text-sm">
                    <span className="flex-1 min-w-0 truncate">{l.label}</span>
                    <span className="tabular-nums text-status-critical">{nf(l.writtenOff)}</span>
                    <span className="w-12 text-right text-xs tabular-nums text-ink-muted">
                      {l.writeoffPercent !== null ? `${Math.round(l.writeoffPercent)} %` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function endLabel(period: string, days: number): string {
  return `${period}-${String(days).padStart(2, "0")}`;
}

function Line({
  label,
  value,
  strong,
  sub,
  danger,
}: {
  label: string;
  value: number;
  strong?: boolean;
  sub?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt
        className={
          sub ? "pl-3 text-ink-secondary" : strong ? "font-medium" : ""
        }
      >
        {label}
      </dt>
      <dd
        className={`tabular-nums ${strong ? "font-semibold" : ""} ${danger ? "text-status-critical" : ""}`}
      >
        {nf(value)}
      </dd>
    </div>
  );
}
