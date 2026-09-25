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
import SectionTabs from "@/components/SectionTabs";
import LeadsBoard from "@/components/LeadsBoard";
import NewLeadForm from "@/components/NewLeadForm";
import LeadImportForm from "@/components/LeadImportForm";
import Hint from "@/components/Hint";
import { clientsTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Клиенты → Лиды»: база тех, кто ещё не покупал, и работа с ней по стадиям.
 * Правила — `src/lib/leads.ts`, действия — `./actions.ts`.
 */
export default async function LeadsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (isRetailRole(role)) redirect("/retail");
  if (!canUseLeads(role)) redirect("/?error=forbidden");
  const email = (session?.user?.email ?? "").toLowerCase();
  const manage = canManageLeads(role);

  // Три вкладки — одним запросом (грабли 1.17).
  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.USERS]);
  const [leads, touches, users] = await Promise.all([listLeads(), listLeadTouches(), listUsers()]);
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const today = localDayKey();

  // Менеджеру — свои и ничьи; РОПу и админу — все (`canSeeLead`).
  const visible = leads.filter((l) => canSeeLead(role, email, l));
  const rows = buildLeadRows(visible, touches, nameByEmail, today).sort(compareLeadRows);
  const summary = summarizeLeads(rows, touches, nameByEmail, today);
  const managers = users
    .filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD))
    .map((u) => ({ email: u.email.toLowerCase(), name: u.name || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Клиенты</h1>
      <SectionTabs tabs={clientsTabsFor()} />

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
        <NewLeadForm canManage={manage} managers={managers} />
        {manage && <LeadImportForm managers={managers} />}
      </div>

      {manage && summary.byManager.length > 0 && (
        <section className="card !p-0">
          <h2 className="font-semibold px-4 pt-4 pb-2">
            По менеджерам
            <Hint>«Дошли до заказа» и «отказ» — за 30 дней по дню смены стадии.</Hint>
          </h2>
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
        </section>
      )}

      <LeadsBoard rows={rows} myEmail={email} canManage={manage} managers={managers} />
    </div>
  );
}
