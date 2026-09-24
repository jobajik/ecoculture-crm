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
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import Hint from "@/components/Hint";
import Change from "@/components/Change";
import FinanceBreakdown from "@/components/FinanceBreakdown";
import { financeTabsFor } from "../tabs";

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
export default async function FinanceAnalyticsPage({ searchParams }: { searchParams?: { period?: string } }) {
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
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const today = localDayKey();
  const a = buildFinanceAnalytics({ orders, payments, nameByEmail, period, today });
  const c = a.current;
  const p = a.previous;
  const hasPrev = p.orders > 0 || p.cashIn > 0;
  const prevName = periodLabel(a.prevPeriod).split(" ")[0].toLowerCase();
  const debtAging = a.debt.aging.filter((b) => b.amount > 0);
  const maxWeek = Math.max(1, ...a.weeks.map((w) => Math.max(w.billed, w.cashIn)));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Оплаты</h1>
      <SectionTabs tabs={financeTabsFor(role)} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PeriodPicker period={period} />
        <span className="text-sm text-ink-muted">
          {hasPrev ? `сравнение с: ${prevName}` : `за ${prevName} денег нет — сравнивать не с чем`}
          <Hint>
            «Выставлено» — счета заявок, оформленных в месяце; «собрано» — сколько по ним уже пришло.
            «Поступило» — деньги, пришедшие в месяце по дню поступления, за любые заявки (как в кассе).
            Поэтому два числа и не обязаны совпадать. Долг — сейчас, по всей базе; просрочка — дольше{" "}
            {DEBT_OVERDUE_DAYS} дней после доставки. Отменённые и наши магазины не считаются.
          </Hint>
        </span>
      </div>

      {/* --- Итоги месяца ------------------------------------------------------ */}
      <section className="card">
        <dl className="grid grid-cols-2 lg:grid-cols-6 gap-x-4 gap-y-5">
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
          />
          <Stat
            title="Долг сейчас"
            value={money(a.debt.total)}
            note={a.debt.orders > 0 ? `${nf(a.debt.clients)} ${clientWord(a.debt.clients)} · ${nf(a.debt.orders)} ${orderWord(a.debt.orders)}` : "никто не должен"}
          />
          <Stat
            title="Просрочено"
            value={money(a.debt.overdue)}
            note={a.debt.total > 0 ? `${Math.round((a.debt.overdue / a.debt.total) * 100)} % долга` : ""}
            danger={a.debt.overdue > 0}
          />
          <Stat
            title="Срок оплаты"
            value={c.daysToPay !== null ? `${nf(c.daysToPay)} ${dayWord(Math.round(c.daysToPay))}` : "—"}
            note={
              c.closedOrders > 0
                ? `после доставки · до неё платят ${Math.round((c.prepaidOrders / c.closedOrders) * 100)} %`
                : "за месяц заявок не закрыли"
            }
          />
        </dl>
        <p className="mt-4 pt-3 border-t border-line-hairline text-xs text-ink-muted">
          {c.orders > 0 && `Отметка «счёт отправлен» у ${nf(a.invoiceMarked)} из ${nf(c.orders)} заявок месяца`}
          {a.debt.shippedUnpaid > 0 && ` · отгружено целиком, но не оплачено: ${money(a.debt.shippedUnpaid)}`}
          {a.debt.brokenPromises > 0 && ` · обещали и не заплатили: ${nf(a.debt.brokenPromises)} на ${money(a.debt.brokenAmount)}`}
          {a.debt.onConsignment > 0 && ` · на реализации (пожарка): ${money(a.debt.onConsignment)}`}
          {a.overpaid > 0 && ` · переплата: ${money(a.overpaid)}`}
        </p>
      </section>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* --- По неделям ------------------------------------------------------ */}
        <section className="card space-y-3 min-w-0">
          <h2 className="font-semibold">
            По неделям
            <Hint>Слева — счета заявок, оформленных за неделю, справа — деньги, пришедшие за неделю.</Hint>
          </h2>
          <div className="flex gap-4 text-xs text-ink-secondary">
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
        </section>

        {/* --- Возраст долга --------------------------------------------------- */}
        <section className="card space-y-3 min-w-0">
          <h2 className="font-semibold">
            Возраст долга
            <Hint>Сколько дней прошло с доставки (нет даты доставки — с оформления) по каждой неоплаченной заявке. Реализация (пожарка) долгом не считается.</Hint>
          </h2>
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
        </section>
      </div>

      <FinanceBreakdown
        rows={{ manager: a.byManager, company: a.byCompany, method: a.byMethod, terms: a.byTerms }}
        prevLabel={prevName}
      />

      {/* --- Кто должен больше всех ------------------------------------------- */}
      <section className="card !p-0 min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-2">
          <h2 className="font-semibold">
            Кто должен · {a.debtors.length}
            <Hint>Сверху — у кого больше просрочено, дальше — по сумме долга. Сорванное обещание — красная метка.</Hint>
          </h2>
          <Link href="/finance/debts" className="text-sm text-accent hover:underline">
            Долги и звонки →
          </Link>
        </div>
        {a.debtors.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-ink-muted">Никто не должен.</p>
        ) : (
          <ul className="divide-y divide-line-hairline/70 border-t border-line-hairline">
            {a.debtors.slice(0, 12).map((d) => (
              <DebtorLine key={d.clientKey} d={d} />
            ))}
            {a.debtors.length > 12 && (
              <li className="px-4 py-2 text-xs text-ink-muted">
                и ещё {a.debtors.length - 12} —{" "}
                <Link href="/finance/debts" className="text-accent hover:underline">
                  весь список
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>
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
}: {
  title: string;
  value: string;
  note?: string;
  now?: number;
  before?: number;
  hasPrev?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-ink-secondary">{title}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${danger ? "text-status-critical" : warn ? "text-[#8a5a00]" : ""}`}>{value}</dd>
      <dd className="text-xs text-ink-muted">
        {hasPrev && now !== undefined && before !== undefined && (
          <>
            <Change now={now} before={before} />
            {note ? " · " : ""}
          </>
        )}
        {note}
      </dd>
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
