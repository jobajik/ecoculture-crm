import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { prefetchTables } from "@/lib/sheets";
import { ROLES, SHEET_TABS, isValidPeriod, periodLabel, periodOf } from "@/lib/constants";
import { ATTENTION_DAYS, buildClientAnalytics, isLongSilent, type ClientLine } from "@/lib/clientAnalytics";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import { isRetailRole } from "@/lib/retail";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import PeriodPicker from "@/components/PeriodPicker";
import Hint from "@/components/Hint";
import Change from "@/components/Change";
import KpiTile from "@/components/KpiTile";
import PagedList from "@/components/PagedList";
import ClientBreakdown from "@/components/ClientBreakdown";
import { clientsTabsFor } from "../tabs";
import { withBotName } from "@/lib/botIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${nf(n)} ₸`;
const dec = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/**
 * «Клиенты → Аналитика»: месяц по клиентам в сравнении с прошлым.
 * Расчёт — `buildClientAnalytics()` в `src/lib/clientAnalytics.ts`.
 */
export default async function ClientAnalyticsPage({ searchParams }: { searchParams?: { period?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (isRetailRole(role)) redirect("/retail");
  if (role !== ROLES.MANAGER && role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) redirect("/?error=forbidden");

  const period = searchParams?.period && isValidPeriod(searchParams.period) ? searchParams.period : periodOf(new Date());

  // Три вкладки — одним запросом к Google (грабли 1.17).
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS]);
  const [clients, orders, users] = await Promise.all([listClients(), listOrdersWithItems(), listUsers()]);
  const nameByEmail = withBotName(new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email])));

  const a = buildClientAnalytics({ clients, orders, nameByEmail, period, today: localDayKey() });
  const c = a.current;
  const p = a.previous;
  const hasPrev = p.orders > 0;
  const prevName = periodLabel(a.prevPeriod).split(" ")[0].toLowerCase();

  const paidPct = c.revenue > 0 ? Math.round((c.paid / c.revenue) * 100) : null;
  const vs = (now: number, before: number) => (hasPrev ? <Change now={now} before={before} /> : null);

  return (
    <div>
      <PageHeader area="clients" title="Аналитика клиентов" icon="chart" tabs={clientsTabsFor(period, role)} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
        <PeriodPicker period={period} />
        <span className="text-sm text-ink-muted">
          {hasPrev ? `сравнение с: ${prevName}` : `за ${prevName} заявок нет — сравнивать не с чем`}
          <Hint>
            Месяц заявки — по дню оформления, как в продажах менеджеров. Отменённые, заявки в наши магазины
            и опт на город не считаются: это не продажа клиенту. «Получено» — сколько денег уже пришло по
            заявкам месяца. «Новый» — клиент, у которого первая заявка за всё время пришлась на этот месяц.
          </Hint>
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile
          icon="chart"
          label="Выручка"
          value={money(c.revenue)}
          hint={
            <>
              {vs(c.revenue, p.revenue)}
              {paidPct !== null && <span className={paidPct < 50 ? "text-[#8a5a00] font-semibold" : ""}>{hasPrev ? " · " : ""}получено {paidPct} %</span>}
            </>
          }
        />
        <KpiTile
          icon="client"
          label="Покупали клиентов"
          value={nf(c.buyers)}
          hint={
            <>
              {vs(c.buyers, p.buyers)}
              {hasPrev ? " · " : ""}из {nf(a.baseClients)} в базе
            </>
          }
        />
        <KpiTile
          icon="arrow"
          label="Новых клиентов"
          value={c.newBuyers > 0 ? `+${nf(c.newBuyers)}` : "0"}
          hint={
            <>
              {vs(c.newBuyers, p.newBuyers)}
              {c.buyers > 0 ? `${hasPrev ? " · " : ""}вернулись: ${nf(c.returning)}` : ""}
            </>
          }
        />
        <KpiTile
          icon="order"
          label="Средний чек"
          value={money(c.avgCheck)}
          hint={
            <>
              {vs(c.avgCheck, p.avgCheck)}
              {c.buyers > 0 ? `${hasPrev ? " · " : ""}${dec(c.ordersPerBuyer)} заявки на клиента` : ""}
            </>
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <ClientBreakdown
          rows={{ manager: a.byManager, city: a.byCity, type: a.byType, flower: a.byFlower }}
          prevLabel="прошлому"
          extraTabs={[
            {
              key: "top",
              label: "Крупнейшие",
              count: a.top.length,
              content:
                a.top.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-ink-muted">За месяц продаж нет.</p>
                ) : (
                    <div className="table-cards">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-ink-secondary border-b border-line-hairline">
                            <th className="px-4 py-2.5 font-medium">Клиент</th>
                            <th className="px-3 py-2.5 font-medium">Менеджер</th>
                            <th className="px-3 py-2.5 font-medium text-right">Заявок</th>
                            <th className="px-3 py-2.5 font-medium text-right">Выручка</th>
                            <th className="px-3 py-2.5 font-medium text-right">Доля</th>
                            {hasPrev && <th className="px-4 py-2.5 font-medium text-right">к прошлому</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {a.top.map((l) => (
                            <tr key={l.clientId} className="border-b border-line-hairline/70 last:border-0">
                              <td className="px-4 py-2.5">
                                <Link href={`/clients/${l.clientId}`} className="font-medium hover:underline">
                                  {l.name}
                                </Link>
                                {l.city && <span className="text-xs text-ink-muted"> · {l.city}</span>}
                              </td>
                              <td data-label="Менеджер" className="px-3 py-2.5 text-ink-secondary">{l.managerName}</td>
                              <td data-label="Заявок" className="px-3 py-2.5 text-right tabular-nums">{l.orders}</td>
                              <td data-label="Выручка" className="px-3 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                                {money(l.revenue)}
                              </td>
                              <td data-label="Доля" className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                                {Math.round(l.share)} %
                              </td>
                              {hasPrev && (
                                <td data-label="к прошлому" className="px-4 py-2.5 text-right tabular-nums">
                                  <Change now={l.revenue} before={l.prevRevenue} />
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                ),
            },
            {
              key: "quiet",
              label: "Давно не заказывали",
              count: a.quiet.length,
              content: (
                <>
                  <p className="px-4 py-2.5 text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline flex items-center">
                    Молчат {ATTENTION_DAYS}+ дней и в полтора раза дольше обычного; сверху — самые ценные
                    <Hint>
                      Покупали раньше, но молчат {ATTENTION_DAYS} дней и дольше — и в полтора раза дольше, чем обычно у этого
                      клиента между заказами. Сверху — самые ценные за всё время. Красным — больше месяца.
                    </Hint>
                  </p>
                  <PagedList
                    what="клиентов"
                    className="divide-y divide-line-hairline/70"
                    items={a.quiet.map((l) => <QuietRow key={l.clientId} l={l} />)}
                    empty={<p className="px-4 py-6 text-sm text-ink-muted">Таких нет — все, кто покупал, заказывают в своём ритме.</p>}
                  />
                </>
              ),
            },
          ]}
        />

        <div className="space-y-5 min-w-0">
          <Section
            tone="client"
            icon="chart"
            className="min-w-0 !mb-0"
            title={
              <>
                На ком держится выручка
                <span className="normal-case tracking-normal">
                  <Hint>
                    Клиенты месяца по убыванию выручки. «Основные» дают первые 80 % выручки, «средние» —
                    следующие 15 %, «мелкие» — остальное. Если основных два-три, потеря одного — это заметная
                    дыра в месяце.
                  </Hint>
                </span>
              </>
            }
          >
              <div className="space-y-3">
                {a.abc[0].clients > 0 ? (
                  <>
                    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Доли выручки по группам клиентов">
                      {a.abc.map((b, i) =>
                        b.share > 0 ? (
                          <div
                            key={b.key}
                            className={["bg-accent", "bg-accent/55", "bg-accent/25"][i]}
                            style={{ width: `${b.share}%` }}
                            title={`${ABC_NAMES[i]}: ${Math.round(b.share)} %`}
                          />
                        ) : null
                      )}
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      {a.abc.map((b, i) => (
                        <li key={b.key} className="flex items-baseline gap-2">
                          <span className={`inline-block w-2.5 h-2.5 rounded-sm ${["bg-accent", "bg-accent/55", "bg-accent/25"][i]}`} />
                          <span className="flex-1 min-w-0">
                            {ABC_NAMES[i]} — <b>{nf(b.clients)}</b> {clientWord(b.clients)}
                          </span>
                          <span className="tabular-nums text-ink-secondary">{Math.round(b.share)} %</span>
                          <span className="shrink-0 text-right tabular-nums w-28">{money(b.revenue)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">За месяц продаж нет.</p>
                )}
              </div>
          </Section>

          <Section tone="client" icon="note" title="Ещё цифры месяца" className="!mb-0">
            <dl className="text-sm divide-y divide-line-hairline/70 -my-1">
              <Line label="Заявок" value={nf(c.orders)} />
              <Line label="Стеблей" value={nf(c.stems)} />
              <Line label="Цена стебля" value={money(c.pricePerStem)} />
              {c.repeatBuyers > 0 && <Line label="Брали 2+ раза" value={nf(c.repeatBuyers)} />}
              {paidPct !== null && <Line label="Получено" value={`${money(c.paid)} из ${money(c.revenue)}`} />}
              {a.debt > 0 && <Line label="Долг клиентов сейчас" value={money(a.debt)} />}
              {a.neverOrdered > 0 && <Line label="Карточек без заявок" value={nf(a.neverOrdered)} />}
              {a.ordersWithoutClient > 0 && <Line label="Заявок без карточки" value={nf(a.ordersWithoutClient)} />}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="tabular-nums font-medium text-right">{value}</dd>
    </div>
  );
}

const ABC_NAMES = ["Основные", "Средние", "Мелкие"];

function clientWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "клиент";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "клиента";
  return "клиентов";
}

function QuietRow({ l }: { l: ClientLine }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <Link href={`/clients/${l.clientId}`} className="block truncate font-medium hover:underline">
          {l.name}
        </Link>
        <span className="block truncate text-xs text-ink-muted">
          {[l.city, l.managerName].filter(Boolean).join(" · ")}
          {l.usualGap !== null && ` · обычно раз в ${l.usualGap} дн.`}
        </span>
      </div>
      <div className="text-right shrink-0">
        <div className={`tabular-nums ${isLongSilent(l.daysSinceLast) ? "text-status-critical" : "text-[#8a5a00]"}`}>
          {l.daysSinceLast} дн.
        </div>
        <div className="text-xs text-ink-muted tabular-nums">с {formatDay(l.lastOrderDate)}</div>
      </div>
      <div className="hidden sm:block w-28 text-right shrink-0 tabular-nums text-ink-secondary" title="Выручка за всё время">
        {money(l.lifetimeRevenue)}
      </div>
    </li>
  );
}
