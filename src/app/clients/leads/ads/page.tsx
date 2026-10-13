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
  const tiles = [
    { label: "Заведено", value: String(report.created), hint: `ещё у Земфиры: ${report.inWork}` },
    { label: "Передано менеджерам", value: String(report.handed), hint: "" },
    { label: "Стали клиентами", value: String(report.won), hint: report.handed ? `${Math.round((report.won / report.handed) * 100)} % от переданных` : "" },
    { label: "Заказали на", value: money(report.orderSum), hint: "заявки после передачи" },
    { label: "Отказ", value: String(report.lost), hint: "" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader area="leads" title="С рекламы" tabs={clientsTabsFor(undefined, role)} />

      <div className="flex flex-wrap gap-2">
        {[...months, "all"].map((m) => (
          <Link
            key={m}
            href={`/clients/leads/ads?month=${m}`}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition-colors " +
              (m === month ? "border-accent bg-accent-soft text-ink-primary font-medium" : "border-line-hairline text-ink-secondary hover:text-ink-primary")
            }
          >
            {m === "all" ? "Всё время" : periodLabel(m)}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="card !py-3">
            <div className="text-xs text-ink-secondary">{t.label}</div>
            <div className="font-display text-xl font-extrabold tabular-nums">{t.value}</div>
            {t.hint && <div className="text-xs text-ink-muted">{t.hint}</div>}
          </div>
        ))}
      </div>

      {report.byManager.length > 0 && (
        <Section
          tone="leads"
          icon="client"
          flush
          title={
            <>
              Как отрабатывают менеджеры
              <span className="normal-case tracking-normal">
                <Hint>
                  Касания — только менеджера после передачи. Норма {ADS_MIN_TOUCHES}–{ADS_MAX_TOUCHES}: отказ раньше {ADS_MIN_TOUCHES}-го
                  касания программа не даёт (кроме неверного номера и «не оптовик»), после {ADS_MAX_TOUCHES} без заказа — решить, что
                  дальше.
                </Hint>
              </span>
            </>
          }
        >
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
        </Section>
      )}

      <Section tone="leads" icon="list" title={`Лиды с рекламы · ${report.rows.length}`} flush>
        {report.rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">
            {leadgen ? "За этот период вы не заводили лидов. Новый лид — на вкладке «Лиды»." : "За этот период лидов с рекламы не было."}
          </p>
        ) : (
          <div className="table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-2 font-medium">Лид</th>
                  <th className="px-3 py-2 font-medium">Передан</th>
                  <th className="px-3 py-2 font-medium text-right">Касаний</th>
                  <th className="px-3 py-2 font-medium">Стадия</th>
                  <th className="px-4 py-2 font-medium text-right">Заказы</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.leadId} className="border-b border-line-hairline/70 last:border-0 align-top">
                    <td className="px-4 py-2">
                      <Link href={`/clients/leads/${r.leadId}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-ink-muted">
                        {[r.city, r.source, `заведён ${formatDay(r.createdAt)}`].filter(Boolean).join(" · ")}
                      </div>
                      {r.flag && <div className={`text-xs ${r.flag === "no_touch" ? "text-status-critical" : "text-[#8a5a00]"}`}>{ADS_FLAG_TEXT[r.flag]}</div>}
                    </td>
                    <td data-label="Передан" className="px-3 py-2 text-ink-secondary">
                      {r.handedOverAt ? (
                        <>
                          {nameOf(r.managerEmail)}
                          <div className="text-xs text-ink-muted">{formatDay(r.handedOverAt)}</div>
                        </>
                      ) : (
                        <span className="text-ink-muted">ещё у Земфиры</span>
                      )}
                    </td>
                    <td data-label="Касаний" className="px-3 py-2 sm:text-right tabular-nums">
                      {r.handedOverAt ? r.touches : "—"}
                    </td>
                    <td data-label="Стадия" className="px-3 py-2">
                      {r.stageLabel}
                      {r.lostReason && <div className="text-xs text-ink-muted">{r.lostReason}</div>}
                    </td>
                    <td data-label="Заказы" className="px-4 py-2 sm:text-right tabular-nums">
                      {r.orders > 0 ? (
                        <>
                          {money(r.orderSum)}
                          <div className="text-xs text-ink-muted">заявок: {r.orders}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {report.bySource.length > 1 && (
        <Section tone="leads" icon="note" title="По источникам" flush>
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
  );
}
