import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listPayments } from "@/lib/repo/payments";
import { listUsers } from "@/lib/repo/users";
import { prefetchTables } from "@/lib/sheets";
import { DEBT_OVERDUE_DAYS, SHEET_TABS, isValidPeriod, periodLabel, periodOf } from "@/lib/constants";
import { canSeeFinance } from "@/lib/financeAccess";
import { buildFinanceAnalytics, type DebtorRow } from "@/lib/financeAnalytics";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import PagedList from "@/components/PagedList";
import PeriodPicker from "@/components/PeriodPicker";
import Hint from "@/components/Hint";
import Change from "@/components/Change";
import FinanceBreakdown from "@/components/FinanceBreakdown";
import { financeTabsFor } from "../tabs";
import { withBotName } from "@/lib/botIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${nf(n)} ₸`;

const AGING_TONE: Record<string, string> = {
  ahead: "bg-ink-muted/30",
  "0-3": "bg-status-good",
  "4-7": "bg-status-warning",
  "8-14": "bg-[#e0892b]",
  "15-30": "bg-status-critical/70",
  "30+": "bg-status-critical",
};

/**
 * «Оплаты → Аналитика»: деньги месяца в сравнении с прошлым и долг сейчас.
 * Расчёт — `buildFinanceAnalytics()` в `src/lib/financeAnalytics.ts`.
 */
export default async function FinanceAnalyticsPage({ searchParams }: { searchParams?: { period?: string; view?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (!canSeeFinance(role)) redirect("/?error=forbidden");

  const period = searchParams?.period && isValidPeriod(searchParams.period) ? searchParams.period : periodOf(new Date());

  // Пять вкладок — одним запросом к Google (грабли 1.17).
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.USERS,
    SHEET_TABS.PAYMENTS,
  ]);
  const [orders, payments, users] = await Promise.all([listOrdersWithItems(), listPayments(), listUsers()]);
  const nameByEmail = withBotName(new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email])));
  const today = localDayKey();
  const a = buildFinanceAnalytics({ orders, payments, nameByEmail, period, today });
  const c = a.current;
  const p = a.previous;
  const hasPrev = p.orders > 0 || p.cashIn > 0;
  const prevName = periodLabel(a.prevPeriod).split(" ")[0].toLowerCase();
  const debtAging = a.debt.aging.filter((b) => b.amount > 0);
  const maxWeek = Math.max(1, ...a.weeks.map((w) => Math.max(w.billed, w.cashIn)));

  const VIEWS = [
    { key: "breakdown", label: "Разрезы месяца" },
    { key: "weeks", label: "По неделям и возраст долга" },
    { key: "debtors", label: `Кто должен (${a.debtors.length})` },
  ];
  const view = VIEWS.some((v) => v.key === searchParams?.view) ? searchParams!.view! : "breakdown";
  const viewHref = (v: string) => {
    const q = new URLSearchParams();
    if (searchParams?.period) q.set("period", period);
    if (v !== "breakdown") q.set("view", v);
    const str = q.toString();
    return `/finance/analytics${str ? `?${str}` : ""}`;
  };
  const facts = [
    c.daysToPay !== null
      ? `срок оплаты ${nf(c.daysToPay)} ${dayWord(Math.round(c.daysToPay))} после доставки${c.closedOrders > 0 ? `, до неё платят ${Math.round((c.prepaidOrders / c.closedOrders) * 100)} %` : ""}`
      : "",
    c.orders > 0 ? `отметка «счёт отправлен» у ${nf(a.invoiceMarked)} из ${nf(c.orders)} заявок` : "",
    a.debt.shippedUnpaid > 0 ? `отгружено, но не оплачено: ${money(a.debt.shippedUnpaid)}` : "",
    a.debt.brokenPromises > 0 ? `обещали и не заплатили: ${nf(a.debt.brokenPromises)} на ${money(a.debt.brokenAmount)}` : "",
    a.debt.onConsignment > 0 ? `на реализации (пожарка): ${money(a.debt.onConsignment)}` : "",
    a.overpaid > 0 ? `переплата: ${money(a.overpaid)}` : "",
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <PageHeader
        area="money"
        title="Аналитика"
        icon="chart"
        tabs={financeTabsFor(role)}
        actions={
          <div className="flex items-center gap-2">
            <PeriodPicker period={period} />
            <Hint>
              {hasPrev ? `Сравнение с: ${prevName}. ` : `За ${prevName} денег нет — сравнивать не с чем. `}
              «Выставлено» — счета заявок, оформленных в месяце; «собрано» — сколько по ним уже пришло. «Поступило» —
              деньги, пришедшие в месяце по дню поступления, за любые заявки (как в кассе). Поэтому два числа и не обязаны
              совпадать. Долг — сейчас, по всей базе; просрочка — дольше {DEBT_OVERDUE_DAYS} дней после доставки.
              Отменённые и наши магазины не считаются.
            </Hint>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat
          title="Выставлено"
          value={money(c.billed)}
          note={`${nf(c.orders)} ${orderWord(c.orders)}`}
          now={c.billed}
          before={p.billed}
          hasPrev={hasPrev}
        />
        <Stat
          title="Поступило"
          value={money(c.cashIn)}
          note={c.cashInRegions > 0 ? `в т.ч. опт на город ${money(c.cashInRegions)}` : `${nf(c.paymentLines)} ${payWord(c.paymentLines)}`}
          now={c.cashIn}
          before={p.cashIn}
          hasPrev={hasPrev}
        />
        <Stat
          title="Собрано по счетам"
          value={c.billed > 0 ? `${Math.round((c.collected / c.billed) * 100)} %` : "—"}
          note={c.billed > 0 ? `${money(c.collected)} из ${money(c.billed)}` : ""}
          warn={c.billed > 0 && c.collected / c.billed < 0.5}
          bar={c.billed > 0 ? (c.collected / c.billed) * 100 : undefined}
        />
        <Stat
          title="Долг сейчас"
          value={money(a.debt.total)}
          note={
            a.debt.orders > 0
              ? `просрочено ${money(a.debt.overdue)} · ${nf(a.debt.clients)} ${clientWord(a.debt.clients)}`
              : "никто не должен"
          }
          danger={a.debt.overdue > 0}
        />
      </div>

      {facts.length > 0 && (
        <p className="text-xs text-ink-muted -mt-1">{facts.join(" · ")}</p>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="flex gap-1 px-2 border-b border-line-hairline overflow-x-auto scroll-x-hidden">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={viewHref(v.key)}
              scroll={false}
              className={
                "px-4 py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors " +
                (view === v.key
                  ? "border-section-money text-ink-primary font-semibold"
                  : "border-transparent text-ink-secondary hover:text-ink-primary")
              }
            >
              {v.label}
            </Link>
          ))}
          {view === "debtors" && (
            <Link href="/finance/debts" className="ml-auto self-center px-3 text-sm text-accent hover:underline whitespace-nowrap">
              Долги и звонки →
            </Link>
          )}
        </div>

        {view === "breakdown" && (
          <FinanceBreakdown
            bare
            rows={{ manager: a.byManager, company: a.byCompany, method: a.byMethod, terms: a.byTerms }}
            prevLabel={prevName}
          />
        )}

        {view === "weeks" && (
          <div className="grid lg:grid-cols-2 lg:divide-x divide-line-hairline">
            <div className="p-4 sm:p-5 space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-secondary">
                <span className="font-semibold text-ink-primary text-sm mr-2">
                  По неделям
                  <Hint>Слева — счета заявок, оформленных за неделю, справа — деньги, пришедшие за неделю.</Hint>
                </span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent/35" />выставлено</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent" />поступило</span>
              </div>
              <ul className="space-y-2.5">
                {a.weeks.map((w) => (
                  <li key={w.label} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={w.future ? "text-ink-muted" : ""}>{w.label}</span>
                      <span className="tabular-nums text-xs text-ink-secondary whitespace-nowrap">
                        {w.future && w.billed === 0 && w.cashIn === 0 ? "ещё впереди" : `${money(w.billed)} / ${money(w.cashIn)}`}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <div className="h-1.5 rounded-full bg-accent/35" style={{ width: `${(w.billed / maxWeek) * 100}%` }} />
                      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(w.cashIn / maxWeek) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-4 sm:p-5 space-y-3 min-w-0 border-t lg:border-t-0 border-line-hairline">
              <div className="font-semibold text-sm">
                Возраст долга
                <Hint>
                  Сколько дней прошло с доставки (нет даты доставки — с оформления) по каждой неоплаченной заявке.
                  Реализация (пожарка) долгом не считается.
                </Hint>
              </div>
              {debtAging.length === 0 ? (
                <p className="text-sm text-ink-muted">Долгов нет.</p>
              ) : (
                <>
                  <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Долг по возрасту">
                    {debtAging.map((b) => (
                      <div key={b.key} className={AGING_TONE[b.key]} style={{ width: `${(b.amount / a.debt.total) * 100}%` }} title={`${b.label}: ${money(b.amount)}`} />
                    ))}
                  </div>
                  <ul className="space-y-1.5 text-sm">
                    {debtAging.map((b) => (
                      <li key={b.key} className="flex items-baseline gap-2">
                        <span className={`inline-block w-2.5 h-2.5 rounded-sm ${AGING_TONE[b.key]}`} />
                        <span className="flex-1 min-w-0">
                          {b.label} <span className="text-ink-muted">· {nf(b.orders)} {orderWord(b.orders)}</span>
                        </span>
                        <span className="tabular-nums text-ink-secondary">{Math.round((b.amount / a.debt.total) * 100)} %</span>
                        <span className="shrink-0 text-right tabular-nums sm:w-32">{money(b.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {view === "debtors" && (
          <PagedList
            what="должников"
            className="divide-y divide-line-hairline/70"
            empty={<p className="px-4 py-6 text-sm text-ink-muted">Никто не должен.</p>}
            items={a.debtors.map((d) => (
              <DebtorLine key={d.clientKey} d={d} />
            ))}
          />
        )}
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return many;
  if (o > 1 && o < 5) return few;
  if (o === 1) return one;
  return many;
}
const orderWord = (n: number) => plural(n, "заявка", "заявки", "заявок");
const clientWord = (n: number) => plural(n, "клиент", "клиента", "клиентов");
const payWord = (n: number) => plural(n, "поступление", "поступления", "поступлений");
const dayWord = (n: number) => plural(n, "день", "дня", "дней");

function Stat({
  title,
  value,
  note,
  now,
  before,
  hasPrev,
  warn,
  danger,
  bar,
}: {
  title: string;
  value: string;
  note?: string;
  now?: number;
  before?: number;
  hasPrev?: boolean;
  warn?: boolean;
  danger?: boolean;
  /** Полоска под числом, 0–100. */
  bar?: number;
}) {
  return (
    <div className="card !p-4 sm:!p-5 min-w-0">
      <div className="text-xs text-ink-muted mb-1.5">{title}</div>
      <div
        className={`font-display text-[22px] sm:text-[26px] leading-none font-extrabold tabular-nums ${danger ? "text-status-critical" : warn ? "text-[#8a5a00]" : ""}`}
      >
        {value}
      </div>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-surface-sunk overflow-hidden">
          <div className="h-full rounded-full bg-section-money" style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
      <div className="text-xs text-ink-secondary mt-2">
        {hasPrev && now !== undefined && before !== undefined && (
          <>
            <Change now={now} before={before} />
            {note ? " · " : ""}
          </>
        )}
        {note}
      </div>
    </div>
  );
}

function DebtorLine({ d }: { d: DebtorRow }) {
  const name = d.clientId ? (
    <Link href={`/clients/${d.clientId}`} className="block truncate font-medium hover:underline">
      {d.name}
    </Link>
  ) : (
    <span className="block truncate font-medium">{d.name}</span>
  );
  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className="flex-1 min-w-0">
        {name}
        <span className="block truncate text-xs text-ink-muted">
          {[d.managerName, d.terms, `${d.orders} ${orderWord(d.orders)}`].filter(Boolean).join(" · ")}
          {d.promisedAt && (
            <span className={d.brokenPromise ? "text-status-critical" : ""}>
              {" "}
              · {d.brokenPromise ? "обещал до" : "обещает до"} {formatDay(d.promisedAt)}
            </span>
          )}
        </span>
      </div>
      <div className="text-right shrink-0">
        <div className="tabular-nums font-medium">{money(d.debt)}</div>
        <div className={`text-xs tabular-nums ${d.overdue > 0 ? "text-status-critical" : "text-ink-muted"}`}>
          {d.overdue > 0 ? `просрочено ${money(d.overdue)}` : d.oldestDays < 0 ? "доставка впереди" : "в сроке"}
        </div>
      </div>
      <div className="hidden sm:block w-20 text-right shrink-0 tabular-nums text-ink-secondary" title="Самой старой заявке, дней после доставки">
        {d.oldestDays > 0 ? `${d.oldestDays} дн.` : ""}
      </div>
    </li>
  );
}
