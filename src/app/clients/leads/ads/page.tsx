import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prefetchTables } from "@/lib/sheets";
import { ROLES, SHEET_TABS, periodLabel, periodOf, periodShift } from "@/lib/constants";
import { listLeadTouches, listLeads } from "@/lib/repo/leads";
import { listUsers } from "@/lib/repo/users";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ADS_MAX_TOUCHES, ADS_MIN_TOUCHES, canManageLeads } from "@/lib/leads";
import { ADS_FLAG_TEXT, buildAdsReport } from "@/lib/adsLeads";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import Hint from "@/components/Hint";
import KpiTile from "@/components/KpiTile";
import Pill from "@/components/Pill";
import PaneTabs from "@/components/PaneTabs";
import PagedList from "@/components/PagedList";
import { clientsTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/**
 * «С рекламы»: лиды Земфиры и что с ними сделали менеджеры (13.10.2026). Земфира видит свои,
 * РОП и админ — все. Расчёт — `buildAdsReport` в `src/lib/adsLeads.ts`.
 */
export default async function AdsLeadsPage({ searchParams }: { searchParams?: { month?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const leadgen = role === ROLES.LEADGEN;
  if (!leadgen && !canManageLeads(role)) redirect("/clients/leads");
  const email = (session?.user?.email ?? "").toLowerCase();

  const current = periodOf(new Date());
  const month = searchParams?.month === "all" ? "all" : searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : current;
  const today = localDayKey();

  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.USERS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS]);
  const [allLeads, touches, users, orders] = await Promise.all([listLeads(), listLeadTouches(), listUsers(), listOrdersWithItems()]);
  // Земфира — только свои: заведённые ею или переданные ею.
  const leads = leadgen ? allLeads.filter((l) => l.createdByEmail === email || l.handedOverBy === email) : allLeads;
  const report = buildAdsReport({
    leads,
    touches,
    orders,
    today,
    from: month === "all" ? "" : `${month}-01`,
    to: month === "all" ? "" : `${month}-31`,
  });
  const nameOf = (e: string) => users.find((u) => u.email.toLowerCase() === e)?.name || e;

  const months: string[] = [];
  for (let i = 3; i >= 0; i--) months.push(periodShift(current, -i));
  const pctWon = report.handed ? Math.round((report.won / report.handed) * 100) : 0;
  const leadRows = report.rows.map((r) => (
    <li key={r.leadId} className="px-4 py-3 grid gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,1fr)_150px_64px_160px_120px] lg:items-start text-sm">
      <div className="min-w-0">
        <Link href={`/clients/leads/${r.leadId}`} className="font-medium hover:underline break-words">
          {r.name}
        </Link>
        <div className="text-xs text-ink-muted truncate">{[r.city, r.source, `заведён ${formatDay(r.createdAt)}`].filter(Boolean).join(" · ")}</div>
        {r.flag && (
          <div className="mt-1">
            <Pill tone={r.flag === "no_touch" ? "bad" : "wait"}>{ADS_FLAG_TEXT[r.flag]}</Pill>
          </div>
        )}
      </div>
      <div className="text-ink-secondary">
        {r.handedOverAt ? (
          <>
            {nameOf(r.managerEmail)}
            <span className="text-xs text-ink-muted lg:block"> · {formatDay(r.handedOverAt)}</span>
          </>
        ) : (
          <span className="text-ink-muted">ещё у Земфиры</span>
        )}
      </div>
      <div className="tabular-nums lg:text-right">
        <span className="lg:hidden text-ink-muted">Касаний: </span>
        {r.handedOverAt ? r.touches : "—"}
      </div>
      <div>
        {r.stageLabel}
        {r.lostReason && <div className="text-xs text-ink-muted">{r.lostReason}</div>}
      </div>
      <div className="tabular-nums lg:text-right">
        {r.orders > 0 ? (
          <>
            {money(r.orderSum)}
            <div className="text-xs text-ink-muted">заявок: {r.orders}</div>
          </>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </div>
    </li>
  ));

  return (
    <div>
      <PageHeader area="leads" title="С рекламы" tabs={clientsTabsFor(undefined, role)} />

      <div className="flex gap-2 overflow-x-auto scroll-x-hidden lg:flex-wrap -mx-1 px-1 mb-5">
        {[...months, "all"].map((m) => (
          <Link
            key={m}
            href={`/clients/leads/ads?month=${m}`}
            className={
              "flex-none h-8 px-3 rounded-full border text-[13px] whitespace-nowrap inline-flex items-center transition-colors " +
              (m === month ? "bg-ink-primary border-ink-primary text-white" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary")
            }
          >
            {m === "all" ? "Всё время" : periodLabel(m)}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="client" label="Заведено" value={report.created} hint={`ещё у Земфиры: ${report.inWork}`} />
        <KpiTile icon="arrow" label="Передано менеджерам" value={report.handed} hint={report.lost > 0 ? `отказ: ${report.lost}` : undefined} />
        <KpiTile icon="check" label="Стали клиентами" value={report.won} hint={report.handed ? `${pctWon} % от переданных` : undefined} tone={report.won > 0 ? "good" : undefined} />
        <KpiTile icon="chart" label="Заказали на" value={money(report.orderSum)} hint="заявки после передачи" />
      </div>

      <div className={report.bySource.length > 1 ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start" : ""}>
        <PaneTabs
          boxed
          tabs={[
            {
              key: "leads",
              label: "Лиды",
              count: report.rows.length,
              content: (
                <>
                  {report.rows.length > 0 && (
                    <div className="hidden lg:grid px-4 py-2 border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted gap-x-4 grid-cols-[minmax(0,1fr)_150px_64px_160px_120px]">
                      <span>Лид</span>
                      <span>Передан</span>
                      <span className="text-right">Касаний</span>
                      <span>Стадия</span>
                      <span className="text-right">Заказы</span>
                    </div>
                  )}
                  <PagedList
                    what="лидов"
                    items={leadRows}
                    empty={
                      <p className="px-4 py-6 text-sm text-ink-muted">
                        {leadgen ? "За этот период вы не заводили лидов. Новый лид — на вкладке «Лиды»." : "За этот период лидов с рекламы не было."}
                      </p>
                    }
                  />
                </>
              ),
            },
            {
              key: "managers",
              label: "Менеджеры",
              count: report.byManager.length,
              content:
                report.byManager.length > 0 ? (
                  <>
                    <p className="px-4 py-2.5 text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline flex items-center">
                      Касания — только менеджера после передачи, норма {ADS_MIN_TOUCHES}–{ADS_MAX_TOUCHES}
                      <Hint>
                        Отказ раньше {ADS_MIN_TOUCHES}-го касания программа не даёт (кроме неверного номера и «не оптовик»), после{" "}
                        {ADS_MAX_TOUCHES} без заказа — решить, что дальше.
                      </Hint>
                    </p>
                    <div className="table-cards">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-ink-secondary border-b border-line-hairline">
                            <th className="px-4 py-2 font-medium">Менеджер</th>
                            <th className="px-3 py-2 font-medium text-right">Передано</th>
                            <th className="px-3 py-2 font-medium text-right">Касаний в среднем</th>
                            <th className="px-3 py-2 font-medium text-right">Не связался</th>
                            <th className="px-3 py-2 font-medium text-right">{ADS_MAX_TOUCHES}+ без заказа</th>
                            <th className="px-3 py-2 font-medium text-right">Стали клиентами</th>
                            <th className="px-3 py-2 font-medium text-right">Заказали на</th>
                            <th className="px-4 py-2 font-medium text-right">Отказ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.byManager.map((m) => (
                            <tr key={m.email} className="border-b border-line-hairline/70 last:border-0">
                              <td className="px-4 py-2 font-medium">{nameOf(m.email)}</td>
                              <td data-label="Передано" className="px-3 py-2 sm:text-right tabular-nums">{m.handed}</td>
                              <td data-label="Касаний в среднем" className="px-3 py-2 sm:text-right tabular-nums">{m.avgTouches.toLocaleString("ru-RU")}</td>
                              <td data-label="Не связался" className={`px-3 py-2 sm:text-right tabular-nums ${m.noTouch ? "text-status-critical" : ""}`}>{m.noTouch || ""}</td>
                              <td data-label={`${ADS_MAX_TOUCHES}+ без заказа`} className={`px-3 py-2 sm:text-right tabular-nums ${m.many ? "text-[#8a5a00]" : ""}`}>{m.many || ""}</td>
                              <td data-label="Стали клиентами" className="px-3 py-2 sm:text-right tabular-nums text-status-good">{m.won || ""}</td>
                              <td data-label="Заказали на" className="px-3 py-2 sm:text-right tabular-nums">{m.orderSum ? money(m.orderSum) : ""}</td>
                              <td data-label="Отказ" className="px-4 py-2 sm:text-right tabular-nums text-ink-muted">{m.lost || ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null,
            },
          ]}
        />

        {report.bySource.length > 1 && (
          <Section tone="leads" icon="note" title="По источникам" flush className="!mb-0">
            <ul className="divide-y divide-line-hairline text-sm">
              {report.bySource.map((s) => (
                <li key={s.source} className="flex justify-between gap-3 px-4 py-2">
                  <span>{s.source}</span>
                  <span className="tabular-nums text-ink-secondary">
                    заведено {s.created} · стали клиентами {s.won}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
