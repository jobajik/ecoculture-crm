import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prefetchTables } from "@/lib/sheets";
import { ROLES, SHEET_TABS } from "@/lib/constants";
import { listLeadTouches, listLeads } from "@/lib/repo/leads";
import { listUsers } from "@/lib/repo/users";
import { buildLeadRows, canManageLeads, canSeeLead, canUseLeads, compareLeadRows, summarizeLeads } from "@/lib/leads";
import { localDayKey } from "@/lib/timezone";
import { isRetailRole } from "@/lib/retail";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import LeadsBoard from "@/components/LeadsBoard";
import NewLeadForm from "@/components/NewLeadForm";
import LeadImportForm from "@/components/LeadImportForm";
import Hint from "@/components/Hint";
import WaInbox from "@/components/WaInbox";
import type { LeadTalkMark } from "@/components/LeadsBoard";
import { listClients } from "@/lib/repo/clients";
import { listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { talkInfoByLead } from "@/lib/talkAnalysis";
import { buildInbox, minutesSince } from "@/lib/whatsapp";
import { isClosedStage, phoneKey } from "@/lib/leads";
import { CLIENT_SOURCES } from "@/lib/constants";
import { clientsTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Клиенты → Лиды»: база тех, кто ещё не покупал, и работа с ней по стадиям.
 * Правила — `src/lib/leads.ts`, действия — `./actions.ts`.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: { new?: string; phone?: string; name?: string; source?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (isRetailRole(role)) redirect("/retail");
  if (!canUseLeads(role)) redirect("/?error=forbidden");
  const email = (session?.user?.email ?? "").toLowerCase();
  const manage = canManageLeads(role);

  // Все вкладки — одним запросом (грабли 1.17).
  await prefetchTables([
    SHEET_TABS.LEADS,
    SHEET_TABS.LEAD_TOUCHES,
    SHEET_TABS.USERS,
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.LEAD_ANALYSES,
    SHEET_TABS.CLIENTS,
  ]);
  const [leads, touches, users, messages, analyses, clients] = await Promise.all([
    listLeads(),
    listLeadTouches(),
    listUsers(),
    listWaMessages(),
    listLeadAnalyses(),
    listClients(),
  ]);
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const today = localDayKey();

  // Менеджеру — свои и ничьи; РОПу и админу — все (`canSeeLead`).
  const visible = leads.filter((l) => canSeeLead(role, email, l));
  const rows = buildLeadRows(visible, touches, nameByEmail, today).sort(compareLeadRows);
  const summary = summarizeLeads(rows, touches, nameByEmail, today);

  // Переписка WhatsApp: метки у лидов и «написали сами» с незнакомых номеров.
  const now = new Date();
  const talk: Record<string, LeadTalkMark> = {};
  for (const info of Array.from(talkInfoByLead(visible, messages, analyses).values())) {
    talk[info.leadId] = {
      waitingMinutes: !isClosedStage(info.stage) && info.waitingSince ? minutesSince(info.waitingSince, now) : null,
      temperature: isClosedStage(info.stage) ? "" : info.analysis?.temperature ?? "",
      score: info.analysis?.score ?? null,
    };
  }
  const known = new Set<string>();
  for (const l of leads) if (phoneKey(l.phone)) known.add(phoneKey(l.phone));
  for (const c of clients) for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) if (phoneKey(p)) known.add(phoneKey(p));
  const inbox = buildInbox(messages, known, now);
  const initial =
    searchParams?.new === "1"
      ? {
          phone: (searchParams.phone || "").slice(0, 40),
          name: (searchParams.name || "").slice(0, 200),
          source: (CLIENT_SOURCES as readonly string[]).includes(searchParams.source || "") ? searchParams.source! : "",
        }
      : undefined;
  const managers = users
    .filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD))
    .map((u) => ({ email: u.email.toLowerCase(), name: u.name || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return (
    <div className="space-y-4">
      <PageHeader area="leads" title="Лиды" tabs={clientsTabsFor()} />

      <p className="text-sm text-ink-secondary">
        В работе {summary.open}
        {summary.dueToday + summary.overdue > 0 && ` · касаться сегодня: ${summary.dueToday + summary.overdue}`}
        {summary.overdue > 0 && <span className="text-status-critical"> · из них просрочено {summary.overdue}</span>}
        {summary.unassigned > 0 && ` · ничьих: ${summary.unassigned}`}
        {` · касаний за 7 дней: ${summary.touches7}`}
        <Hint>
          Лид — тот, кто ещё не покупал. Каждый разговор записывается касанием: как связывались, о чём
          договорились и когда следующий раз. Чтобы оформить заявку, лида заводят клиентом — кнопкой в его
          карточке. Менеджер видит свои лиды и ничьи; РОП — всех.
        </Hint>
      </p>

      <div className="flex flex-wrap items-start gap-2">
        <NewLeadForm key={initial ? `${initial.phone}` : "blank"} canManage={manage} managers={managers} initial={initial} />
        {manage && <LeadImportForm managers={managers} />}
      </div>

      {manage && summary.byManager.length > 0 && (
        <Section
          tone="leads"
          icon="client"
          flush
          className="!mb-0"
          title={
            <>
              По менеджерам
              <span className="normal-case tracking-normal">
                <Hint>«Дошли до заказа» и «отказ» — за 30 дней по дню смены стадии.</Hint>
              </span>
            </>
          }
        >
          <div className="table-cards border-t border-line-hairline">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-2 font-medium">Менеджер</th>
                  <th className="px-3 py-2 font-medium text-right">В работе</th>
                  <th className="px-3 py-2 font-medium text-right">Просрочено</th>
                  <th className="px-3 py-2 font-medium text-right">Касаний за 7 дней</th>
                  <th className="px-3 py-2 font-medium text-right">Дошли до заказа</th>
                  <th className="px-4 py-2 font-medium text-right">Отказ</th>
                </tr>
              </thead>
              <tbody>
                {summary.byManager.map((m) => (
                  <tr key={m.email} className="border-b border-line-hairline/70 last:border-0">
                    <td className="px-4 py-2 font-medium">{m.name}</td>
                    <td data-label="В работе" className="px-3 py-2 text-right tabular-nums">{m.open}</td>
                    <td data-label="Просрочено" className={`px-3 py-2 text-right tabular-nums ${m.overdue > 0 ? "text-status-critical" : ""}`}>
                      {m.overdue || ""}
                    </td>
                    <td data-label="Касаний за 7 дней" className="px-3 py-2 text-right tabular-nums">{m.touches7}</td>
                    <td data-label="Дошли до заказа" className="px-3 py-2 text-right tabular-nums text-status-good">{m.won30 || ""}</td>
                    <td data-label="Отказ" className="px-4 py-2 text-right tabular-nums text-ink-muted">{m.lost30 || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <WaInbox rows={inbox} />

      <LeadsBoard rows={rows} myEmail={email} canManage={manage} managers={managers} talk={talk} />
    </div>
  );
}
