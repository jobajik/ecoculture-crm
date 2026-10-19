import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FARM_LABELS, FARM_ORDER, FARMS, FLOWER_TYPES, FLOWER_TYPE_LABELS, SHEET_TABS, flowerTypesForFarm, periodLabel, periodOf, periodShift } from "@/lib/constants";
import { prefetchTables } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import { canSeeFinance } from "@/lib/financeAccess";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listPointDays, listPointWriteoffs } from "@/lib/repo/point";
import { POINT_NAME, canEditPoint, pointOrdersWithMoney, pointReport, pointStemFlow, pointTransfers, transferDay, transferLines } from "@/lib/point";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import Hint from "@/components/Hint";
import PointDayForm, { type PointKnownDay } from "@/components/PointDayForm";
import PointWriteoffForm from "@/components/PointWriteoffForm";
import PointWriteoffRemove from "@/components/PointWriteoffRemove";
import PointOrderMoneyClear from "@/components/PointOrderMoneyClear";
import StatTile from "@/components/StatTile";
import PagedList from "@/components/PagedList";
import FinancePagedTable from "@/components/FinancePagedTable";
import { financeTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const n = (v: number) => Math.round(v).toLocaleString("ru-RU");

/**
 * «Оплаты → Точка на базаре». Товар туда ПЕРЕМЕЩАЕТСЯ обычными заявками с
 * направлением «Пожарка», выручку бухгалтер вносит отчётом за день, списания
 * на точке — здесь же. Правила — `src/lib/point.ts`.
 */
export default async function PointPage({ searchParams }: { searchParams?: { month?: string; day?: string; view?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canSeeFinance(role)) redirect("/?error=forbidden");

  const current = periodOf(new Date());
  const month = searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : current;
  const today = localDayKey();
  // День из «По дням» — форма «Выручка за день» открывается на нём.
  const day = searchParams?.day && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day) && searchParams.day <= today ? searchParams.day : "";

  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.POINT_SALES, SHEET_TABS.POINT_WRITEOFFS]);
  const [orders, days, writeoffs] = await Promise.all([listOrdersWithItems(), listPointDays(), listPointWriteoffs()]);
  const report = pointReport({ orders, days, writeoffs, month, today });
  const stems = pointStemFlow({ orders, days, writeoffs, month, today });
  const stemTotal = stems.flowers.reduce(
    (t, f) => ({
      start: t.start + f.start,
      transferred: t.transferred + f.transferred,
      sold: t.sold + f.sold,
      soldEstimated: t.soldEstimated + f.soldEstimated,
      writeoff: t.writeoff + f.writeoff,
      end: t.end + f.end,
    }),
    { start: 0, transferred: 0, sold: 0, soldEstimated: 0, writeoff: 0, end: 0 }
  );
  const isCurrent = month === current;
  const editable = canEditPoint(role);
  // День → по компаниям и внесённое одной суммой (до разделения).
  const known: Record<string, PointKnownDay> = {};
  for (const d of days) {
    const k = (known[d.date] ??= { farms: {}, unsplit: 0, note: "" });
    if (d.farm && FARM_ORDER.includes(d.farm)) k.farms[d.farm] = { kaspi: d.kaspi, cash: d.cash, soldStems: d.soldStems };
    else k.unsplit += d.kaspi + d.cash;
    if (d.note) k.note = d.note;
  }
  const FARM_HINT: Record<string, string> = { [FARMS.ESENTAI]: "хризантема", [FARMS.ROSE_FARM]: "роза и эустома" };
  // Есентай первым — так просил бухгалтер («Есентай и розы»).
  const farmsOrder = [FARMS.ESENTAI, FARMS.ROSE_FARM] as string[];
  const farmRows = farmsOrder.map((f) => report.farms.find((r) => r.farm === f)!).filter(Boolean);
  const transfers = pointTransfers(orders)
    .filter((o) => transferDay(o).slice(0, 7) === month)
    .sort((a, b) => (transferDay(a) < transferDay(b) ? 1 : -1));
  // Деньги, внесённые прямо в заявки-перемещения (до отчёта за день), — за всё время.
  const withMoney = pointOrdersWithMoney(orders);
  const withMoneyTotal = withMoney.reduce((s, o) => s + o.paidAmount, 0);
  const monthWriteoffs = writeoffs.filter((w) => w.date.slice(0, 7) === month).sort((a, b) => (a.date < b.date ? 1 : -1));

  const months: string[] = [];
  for (let i = 3; i >= 0; i--) months.push(periodShift(current, -i));

  const VIEWS = [
    { key: "days", label: "По дням", count: report.days.length },
    { key: "farms", label: "По компаниям" },
    { key: "stems", label: "В штуках" },
    { key: "flowers", label: "По цветкам" },
    { key: "writeoffs", label: "Списания", count: monthWriteoffs.length },
    { key: "moves", label: "Перемещения", count: transfers.length },
    ...(withMoney.length > 0 ? [{ key: "money", label: "Деньги на перемещениях", count: withMoney.length }] : []),
  ];
  const view = VIEWS.some((v) => v.key === searchParams?.view) ? searchParams!.view! : "days";
  const hrefFor = (params: { month?: string; view?: string; day?: string }) => {
    const q = new URLSearchParams();
    const m = params.month ?? month;
    if (m !== current) q.set("month", m);
    const v = params.view ?? view;
    if (v !== "days") q.set("view", v);
    if (params.day) q.set("day", params.day);
    const str = q.toString();
    return `/finance/point${str ? `?${str}` : ""}`;
  };
  const th = "px-4 py-2.5 font-medium";
  const headRow = "text-left text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline";
  const td = "px-4 py-2.5";

  return (
    <div className="space-y-5">
      <PageHeader
        area="money"
        title={POINT_NAME}
        icon="store"
        tabs={financeTabsFor(role)}
        actions={
          <div className="flex flex-wrap gap-1">
            {months.map((m) => (
              <Link
                key={m}
                href={hrefFor({ month: m })}
                className={
                  m === month
                    ? "px-3 py-1.5 rounded-lg text-sm bg-ink-primary text-white"
                    : "px-3 py-1.5 rounded-lg text-sm border border-line-hairline bg-surface text-ink-secondary hover:text-ink-primary"
                }
              >
                {periodLabel(m)}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatTile label="Отвезли" value={money(report.transferred.amount)} sub={`${n(report.transferred.stems)} шт.`} />
        <StatTile
          label="Выручка"
          value={money(report.revenue.total)}
          sub={`Kaspi ${money(report.revenue.kaspi)} · нал. ${money(report.revenue.cash)} · продано ${report.sellThrough} % от отвезённого`}
          tone={report.revenue.total > 0 ? "good" : "default"}
        />
        <StatTile label="Списано на точке" value={money(report.writeoffs.amount)} sub={`${n(report.writeoffs.stems)} шт.`} />
        <StatTile label="На точке сейчас, примерно" value={money(report.onPoint)} sub="отвезли − выручка − списания" />
      </div>

      <div className={editable ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px] items-start" : ""}>
        <div className="card !p-0 overflow-hidden min-w-0">
          <div className="flex gap-1 px-2 border-b border-line-hairline overflow-x-auto scroll-x-hidden">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={hrefFor({ view: v.key })}
                scroll={false}
                className={
                  "px-4 py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors " +
                  (view === v.key
                    ? "border-section-money text-ink-primary font-semibold"
                    : "border-transparent text-ink-secondary hover:text-ink-primary")
                }
              >
                {v.label}
                {v.count !== undefined && <span className="ml-1 tabular-nums text-ink-muted">{v.count}</span>}
              </Link>
            ))}
          </div>

          {view === "days" &&
            (report.days.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-muted">За этот месяц ничего не было.</p>
            ) : (
              <FinancePagedTable
                what="дней"
                resetKey={month}
                head={
                  <tr className={headRow}>
                    <th className={th}>День</th>
                    <th className={`${th} text-right`}>Отвезли</th>
                    <th className={`${th} text-right`}>Есентай</th>
                    <th className={`${th} text-right`}>Rose Farm</th>
                    <th className={`${th} text-right`}>Выручка</th>
                    <th className={`${th} text-right`}>Списано</th>
                    <th className={th}>Заметка</th>
                  </tr>
                }
                rows={report.days.map((d) => {
                  const rev = d.kaspi + d.cash + d.fromOrders;
                  const st = stems.days[d.date];
                  const stParts = st
                    ? [
                        st.transferred ? `отвезли ${n(st.transferred)}` : "",
                        st.sold ? `продано ${n(st.sold)}` : "",
                        st.soldEstimated ? `продано ≈${n(st.soldEstimated)}` : "",
                        st.writeoff ? `списано ${n(st.writeoff)}` : "",
                      ].filter(Boolean)
                    : [];
                  const split = Object.values(d.byFarm).reduce((s, b) => s + b.kaspi + b.cash, 0);
                  const one = d.kaspi + d.cash - split;
                  return (
                    <tr key={d.date} className="border-b border-line-hairline last:border-0">
                      <td className={td}>
                        {editable ? (
                          <Link
                            href={`${hrefFor({ day: d.date })}#day-form`}
                            className="text-accent hover:underline"
                            title="Открыть этот день в «Выручке за день»"
                          >
                            {formatDay(d.date)}
                          </Link>
                        ) : (
                          formatDay(d.date)
                        )}
                        {stParts.length > 0 && <div className="text-xs text-ink-muted">{stParts.join(" · ")} шт.</div>}
                      </td>
                      <td className={`${td} sm:text-right tabular-nums`} data-label="Отвезли">
                        {d.transferred ? money(d.transferred) : "—"}
                      </td>
                      {farmsOrder.map((f) => {
                        const b = d.byFarm[f];
                        const sum = b ? b.kaspi + b.cash : 0;
                        return (
                          <td key={f} className={`${td} sm:text-right tabular-nums`} data-label={FARM_LABELS[f]}>
                            {sum ? money(sum) : "—"}
                            {sum > 0 && (
                              <div className="text-xs text-ink-muted">
                                Kaspi {money(b!.kaspi)} · нал. {money(b!.cash)}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className={`${td} sm:text-right tabular-nums font-medium`} data-label="Выручка">
                        {rev ? money(rev) : "—"}
                        {d.fromOrders > 0 && <div className="text-xs text-ink-muted">в т.ч. по заявкам {money(d.fromOrders)}</div>}
                        {one > 0.5 && <div className="text-xs text-[#8a5a00]">одной суммой {money(one)}</div>}
                      </td>
                      <td className={`${td} sm:text-right tabular-nums`} data-label="Списано">
                        {d.writeoff ? money(d.writeoff) : "—"}
                      </td>
                      <td className={`${td} text-ink-secondary`} data-label="Заметка">
                        {d.note}
                      </td>
                    </tr>
                  );
                })}
              />
            ))}

          {view === "farms" && (
            <>
              <div className="table-scroll table-cards">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={headRow}>
                      <th className={th}>Компания</th>
                      <th className={`${th} text-right`}>Отвезли</th>
                      <th className={`${th} text-right`}>Kaspi</th>
                      <th className={`${th} text-right`}>Наличные</th>
                      <th className={`${th} text-right`}>Выручка</th>
                      <th className={`${th} text-right`}>Списано</th>
                      <th className={`${th} text-right`}>
                        На точке, примерно
                        <Hint>
                          Есентай — хризантема, Rose Farm — роза и эустома. Отвезли и списано — по цветку, выручка — как
                          внесена по компаниям. «На точке» — за всё время; деньги, внесённые одной суммой, делятся по доле
                          отвезённого.
                        </Hint>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {farmRows.map((f) => (
                      <tr key={f.farm} className="border-b border-line-hairline last:border-0">
                        <td className={`${td} font-medium`}>
                          {f.label}
                          <div className="text-xs text-ink-muted font-normal">{FARM_HINT[f.farm]}</div>
                        </td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="Отвезли">{money(f.transferred)}</td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="Kaspi">{f.kaspi ? money(f.kaspi) : "—"}</td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="Наличные">{f.cash ? money(f.cash) : "—"}</td>
                        <td className={`${td} sm:text-right tabular-nums font-medium`} data-label="Выручка">
                          {money(f.revenue)}
                          {f.fromOrders > 0 && <div className="text-xs text-ink-muted font-normal">в т.ч. по заявкам {money(f.fromOrders)}</div>}
                        </td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="Списано">{f.writeoffs ? money(f.writeoffs) : "—"}</td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="На точке">{money(f.onPoint)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.unsplit > 0 && (
                <p className="px-4 py-2.5 text-xs text-[#8a5a00] border-t border-line-hairline">
                  Ещё {money(report.unsplit)} за месяц внесено одной суммой. Откройте такой день во вкладке «По дням» и
                  разнесите по компаниям.
                </p>
              )}
            </>
          )}

          {view === "stems" &&
            (stems.flowers.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-muted">На точку пока ничего не возили.</p>
            ) : (
              <>
                <div className="table-scroll table-cards">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={headRow}>
                        <th className={th}>
                          Цветок
                          <Hint>
                            На начало месяца + отвезли − продано − списано = {isCurrent ? "на точке сейчас" : "на конец месяца"}.
                            Продано — штуки из отчёта за день; где их не вносили, «≈» — оценка по деньгам и средней цене
                            перемещения. На базаре продают дороже, поэтому оценка скорее завышает проданное.
                          </Hint>
                        </th>
                        <th className={`${th} text-right`}>На начало, шт.</th>
                        <th className={`${th} text-right`}>Отвезли</th>
                        <th className={`${th} text-right`}>Продано</th>
                        <th className={`${th} text-right`}>Списано</th>
                        <th className={`${th} text-right`}>{isCurrent ? "На точке сейчас" : "На конец месяца"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...stems.flowers, ...(stems.flowers.length > 1 ? [{ ...stemTotal, flowerType: "total", label: "Всего" }] : [])].map((f) => (
                        <tr key={f.flowerType} className={"border-b border-line-hairline last:border-0" + (f.flowerType === "total" ? " font-medium bg-surface-plane/40" : "")}>
                          <td className={td}>{f.label}</td>
                          <td className={`${td} sm:text-right tabular-nums`} data-label="На начало, шт.">{n(f.start)}</td>
                          <td className={`${td} sm:text-right tabular-nums`} data-label="Отвезли">{f.transferred ? `+${n(f.transferred)}` : "—"}</td>
                          <td className={`${td} sm:text-right tabular-nums`} data-label="Продано">
                            {f.sold + f.soldEstimated ? `−${n(f.sold + f.soldEstimated)}` : "—"}
                            {f.soldEstimated > 0 && (
                              <div className="text-xs text-[#8a5a00] font-normal">
                                {f.sold > 0 ? `внесено ${n(f.sold)} · ` : ""}≈ {n(f.soldEstimated)} по деньгам
                              </div>
                            )}
                          </td>
                          <td className={`${td} sm:text-right tabular-nums`} data-label="Списано">{f.writeoff ? `−${n(f.writeoff)}` : "—"}</td>
                          <td className={`${td} sm:text-right tabular-nums font-medium` + (f.end < 0 ? " text-status-critical" : "")} data-label="На точке">
                            {n(f.end)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {stems.flowers.some((f) => f.end < 0) && (
                  <p className="px-4 py-2.5 text-xs text-status-critical border-t border-line-hairline">
                    Остаток меньше нуля — по оценке продано больше, чем отвезли. Внесите проданные штуки за дни, и остаток
                    станет точным.
                  </p>
                )}
              </>
            ))}

          {view === "flowers" &&
            (report.flowers.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-muted">В этом месяце на точку не возили.</p>
            ) : (
              <div className="table-scroll table-cards">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={headRow}>
                      <th className={th}>Цветок</th>
                      <th className={`${th} text-right`}>Отвезли, шт.</th>
                      <th className={`${th} text-right`}>На сумму</th>
                      <th className={`${th} text-right`}>Списано, шт.</th>
                      <th className={`${th} text-right`}>На сумму</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.flowers.map((f) => (
                      <tr key={f.flowerType} className="border-b border-line-hairline last:border-0">
                        <td className={td}>{f.label}</td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="Отвезли, шт.">{n(f.stems)}</td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="На сумму">{money(f.amount)}</td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="Списано, шт.">{f.writeoffStems ? n(f.writeoffStems) : "—"}</td>
                        <td className={`${td} sm:text-right tabular-nums`} data-label="На сумму">{f.writeoffAmount ? money(f.writeoffAmount) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {view === "writeoffs" && (
            <>
              {editable && (
                <div className="px-4 py-3 border-b border-line-hairline bg-surface-plane/40">
                  <div className="text-xs text-ink-muted mb-2">
                    Завяло, сломалось, не продалось. Сумма — по средней цене, по которой цветок возили на точку.
                  </div>
                  <PointWriteoffForm
                    today={today}
                    flowers={[FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.ROSE, FLOWER_TYPES.EUSTOMA].map((f) => ({ value: f, label: FLOWER_TYPE_LABELS[f] }))}
                  />
                </div>
              )}
              <PagedList
                what="списаний"
                resetKey={month}
                className="divide-y divide-line-hairline text-sm"
                empty={<p className="px-4 py-6 text-sm text-ink-muted">В этом месяце списаний нет.</p>}
                items={monthWriteoffs.map((w) => (
                  <li key={w.writeoffId} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
                    <span className="w-24 text-ink-secondary">{formatDay(w.date)}</span>
                    <span className="flex-1 min-w-0">
                      {FLOWER_TYPE_LABELS[w.flowerType] ?? w.flowerType} · {n(w.quantity)} шт. · {money(w.amount)}
                      <span className="text-ink-muted"> · {w.reason}</span>
                    </span>
                    {editable && <PointWriteoffRemove writeoffId={w.writeoffId} />}
                  </li>
                ))}
              />
            </>
          )}

          {view === "moves" && (
            <PagedList
              what="перемещений"
              resetKey={month}
              className="divide-y divide-line-hairline text-sm"
              empty={
                <p className="px-4 py-6 text-sm text-ink-muted">
                  Заявок на точку не было. Менеджер оформляет обычную заявку с направлением «Пожарка».
                </p>
              }
              items={transfers.map((o) => {
                const lines = transferLines(o);
                const amount = lines.reduce((s, l) => s + l.amount, 0);
                const ordered = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
                return (
                  <li key={o.orderId} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                    <Link href={`/orders/${o.orderId}`} className="text-series-1 hover:underline">
                      {formatDay(transferDay(o))} · {o.clientName}
                    </Link>
                    <span className="tabular-nums text-ink-secondary">
                      {amount > 0 ? `отвезено на ${money(amount)}` : `ещё не отгружено (заявка на ${money(ordered)})`}
                    </span>
                  </li>
                );
              })}
            />
          )}

          {view === "money" && withMoney.length > 0 && (
            <>
              <div className="px-4 py-3 border-b border-line-hairline flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Внесено прямо в заявки-перемещения: <b className="tabular-nums">{money(withMoneyTotal)}</b>
                  <Hint>
                    Раньше оплату точки вносили прямо в заявку-перемещение. Такие суммы считаются выручкой точки «по
                    заявкам» в день оплаты. Если вы вносите выручку по дням, снимите их здесь — иначе деньги посчитаются
                    дважды. Снятие пишется в журнал.
                  </Hint>
                </span>
                {editable && withMoney.length > 1 && (
                  <span className="ml-auto">
                    <PointOrderMoneyClear
                      orderIds={withMoney.map((o) => o.orderId)}
                      label={`снять все (${withMoney.length})`}
                      confirmText={`Снять ${money(withMoneyTotal)} со всех ${withMoney.length} заявок?`}
                    />
                  </span>
                )}
              </div>
              <PagedList
                what="заявок"
                className="divide-y divide-line-hairline text-sm"
                items={withMoney.map((o) => (
                  <li key={o.orderId} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                    <Link href={`/orders/${o.orderId}`} className="text-series-1 hover:underline">
                      {formatDay(transferDay(o))} · {o.clientName}
                    </Link>
                    <span className="flex flex-wrap items-baseline gap-3">
                      <span className="tabular-nums">
                        {money(o.paidAmount)}
                        <span className="ml-1 text-xs text-ink-muted">оплата {formatDay(o.paidAt.slice(0, 10))}</span>
                      </span>
                      {editable && (
                        <PointOrderMoneyClear orderIds={[o.orderId]} label="снять" confirmText={`Снять ${money(o.paidAmount)}?`} />
                      )}
                    </span>
                  </li>
                ))}
              />
            </>
          )}
        </div>

        {/* Бухгалтер приходит сюда внести выручку за день — форма всегда на виду справа. */}
        {editable && (
          <div id="day-form" className="scroll-mt-20 min-w-0">
            <Section
              tone="money"
              icon="wallet"
              className="!mb-0"
              title={
                <>
                  Выручка за день{" "}
                  <Hint>
                    Сколько точка приняла за день: на Kaspi (счета они выставляют сами) и наличными. Это и есть продажа —
                    сама заявка «Пожарка» только перемещает товар. Один день — одна запись: внесёте день ещё раз, запись
                    заменится.
                  </Hint>
                </>
              }
            >
              <PointDayForm
                key={day || today}
                today={today}
                initialDay={day || undefined}
                known={known}
                farms={farmsOrder.map((f) => ({
                  farm: f,
                  label: FARM_LABELS[f],
                  hint: FARM_HINT[f],
                  flowers: flowerTypesForFarm(f).map((fl) => ({ key: fl, label: FLOWER_TYPE_LABELS[fl] ?? fl })),
                }))}
              />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
