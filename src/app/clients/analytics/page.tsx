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
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import Hint from "@/components/Hint";
import Change from "@/components/Change";
import ClientBreakdown from "@/components/ClientBreakdown";
import { clientsTabsFor } from "../tabs";

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
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));

  const a = buildClientAnalytics({ clients, orders, nameByEmail, period, today: localDayKey() });
  const c = a.current;
  const p = a.previous;
  const hasPrev = p.orders > 0;
  const prevName = periodLabel(a.prevPeriod).split(" ")[0].toLowerCase();

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Клиенты</h1>
      <SectionTabs tabs={clientsTabsFor(period)} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

      {/* --- Итоги месяца ------------------------------------------------------ */}
      <section className="card">
        <dl className="grid grid-cols-2 lg:grid-cols-6 gap-x-4 gap-y-5">
          <Stat title="Выручка" value={money(c.revenue)} now={c.revenue} before={p.revenue} hasPrev={hasPrev} />
          <Stat
            title="Покупали клиентов"
            value={nf(c.buyers)}
            note={`из ${nf(a.baseClients)} в базе`}
            now={c.buyers}
            before={p.buyers}
            hasPrev={hasPrev}
          />
          <Stat
            title="Новых клиентов"
            value={c.newBuyers > 0 ? `+${nf(c.newBuyers)}` : "0"}
            note={c.buyers > 0 ? `вернулись: ${nf(c.returning)}` : ""}
            now={c.newBuyers}
            before={p.newBuyers}
            hasPrev={hasPrev}
          />
          <Stat title="Средний чек" value={money(c.avgCheck)} now={c.avgCheck} before={p.avgCheck} hasPrev={hasPrev} />
          <Stat
            title="Заявок на клиента"
            value={c.buyers > 0 ? dec(c.ordersPerBuyer) : "—"}
            note={c.repeatBuyers > 0 ? `брали 2+ раза: ${nf(c.repeatBuyers)}` : ""}
            now={c.ordersPerBuyer}
            before={p.ordersPerBuyer}
            hasPrev={hasPrev}
          />
          <Stat
            title="Получено"
            value={c.revenue > 0 ? `${Math.round((c.paid / c.revenue) * 100)} %` : "—"}
            note={c.revenue > 0 ? `${money(c.paid)} из ${money(c.revenue)}` : ""}
            warn={c.revenue > 0 && c.paid / c.revenue < 0.5}
          />
        </dl>
        <p className="mt-4 pt-3 border-t border-line-hairline text-xs text-ink-muted">
          Заявок {nf(c.orders)} · стеблей {nf(c.stems)} · средняя цена стебля {money(c.pricePerStem)}
          {a.neverOrdered > 0 && ` · карточек без единой заявки: ${nf(a.neverOrdered)}`}
          {a.debt > 0 && ` · долг клиентов сейчас: ${money(a.debt)}`}
          {a.ordersWithoutClient > 0 && ` · заявок без карточки клиента: ${nf(a.ordersWithoutClient)}`}
        </p>
      </section>

      <ClientBreakdown
        rows={{ manager: a.byManager, city: a.byCity, type: a.byType, flower: a.byFlower }}
        prevLabel="прошлому"
      />

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* --- На ком держится выручка (ABC) --------------------------------- */}
        <section className="card space-y-3 min-w-0">
          <h2 className="font-semibold">
            На ком держится выручка
            <Hint>
              Клиенты месяца по убыванию выручки. «Основные» дают первые 80 % выручки, «средние» —
              следующие 15 %, «мелкие» — остальное. Если основных два-три, потеря одного — это заметная
              дыра в месяце.
            </Hint>
          </h2>
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
                    <span className="shrink-0 text-right tabular-nums sm:w-32">{money(b.revenue)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-muted">За месяц продаж нет.</p>
          )}
        </section>

        {/* --- Кому позвонить ------------------------------------------------ */}
        <section className="card !p-0 min-w-0">
          <div className="px-4 pt-4 pb-2">
            <h2 className="font-semibold">
              Давно не заказывали · {a.quiet.length}
              <Hint>
                Покупали раньше, но молчат {ATTENTION_DAYS} дней и дольше — и дольше, чем обычно у этого клиента между
                заказами. Сверху — самые ценные за всё время. Красным — больше месяца.
              </Hint>
            </h2>
          </div>
          {a.quiet.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-ink-muted">Таких нет — все, кто покупал, заказывают в своём ритме.</p>
          ) : (
            <ul className="divide-y divide-line-hairline/70 border-t border-line-hairline">
              {a.quiet.slice(0, 12).map((l) => (
                <QuietRow key={l.clientId} l={l} />
              ))}
              {a.quiet.length > 12 && (
                <li className="px-4 py-2 text-xs text-ink-muted">
                  и ещё {a.quiet.length - 12} —{" "}
                  <Link href="/clients" className="text-accent hover:underline">
                    весь список
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      {/* --- Крупнейшие клиенты месяца ---------------------------------------- */}
      {a.top.length > 0 && (
        <section className="card !p-0">
          <h2 className="font-semibold px-4 pt-4 pb-2">Крупнейшие клиенты месяца</h2>
          <div className="table-scroll table-cards border-t border-line-hairline">
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
        </section>
      )}
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

function Stat({
  title,
  value,
  note,
  now,
  before,
  hasPrev,
  warn,
}: {
  title: string;
  value: string;
  note?: string;
  now?: number;
  before?: number;
  hasPrev?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-ink-secondary">{title}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${warn ? "text-[#8a5a00]" : ""}`}>{value}</dd>
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
