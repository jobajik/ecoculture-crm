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
import { withBotName } from "@/lib/botIdentity";
import { canOpen } from "@/lib/access";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Загрузка базы на тысячи строк и раздача пишут в таблицу одним большим запросом.
export const maxDuration = 60;

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
  const leadgen = role === ROLES.LEADGEN;

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
    listWaMessages({ lines: "all" }),
    listLeadAnalyses(),
    listClients(),
  ]);
  const nameByEmail = withBotName(new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email])));
  const today = localDayKey();

  // Менеджеру — свои и ничьи; РОПу и админу — все (`canSeeLead`).
  const visible = leads.filter((l) => canSeeLead(role, email, l));
  // «Что известно» из прошлой CRM в списке не нужно — только лишний вес страницы
  // (у загруженной базы это 3 700 строк по полстраницы текста).
  const rows = buildLeadRows(visible, touches, nameByEmail, today)
    .sort(compareLeadRows)
    .map((r) => ({ ...r, history: "" }));
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
  // «Написали в WhatsApp» — только номер Земфиры (ей, РОПу и админу). Рабочий номер сюда не идёт
  // (13.10.2026, владелец: «убери это, номер Эмиля пока я не использую» — там сотрудники и водители).
  const inbox = leadgen || manage ? buildInbox(messages.filter((m) => m.line === "leads"), known, now) : [];
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
    <div>
      <PageHeader
        area="leads"
        title="Лиды"
        subtitle={
          <>
            Те, кто ещё не покупал{summary.unassigned > 0 && manage ? ` · ничьих: ${summary.unassigned}` : ""} · касаний за 7 дней: {summary.touches7}
            <Hint>
              Каждый разговор — касание: как связывались, о чём договорились и когда следующий раз. Чтобы оформить
              заявку, лида заводят клиентом — кнопкой в его карточке. Менеджер видит свои лиды и ничьи; РОП — всех.
            </Hint>
          </>
        }
        tabs={clientsTabsFor(undefined, role)}
      />

      <div className="flex flex-wrap items-start gap-2 mb-5">
        <NewLeadForm key={initial ? `${initial.phone}` : "blank"} canManage={manage} managers={managers} initial={initial} />
        {manage && (
          <details className="group sm:ml-auto">
            <summary className="btn-secondary !py-1.5 cursor-pointer list-none select-none">Загрузить базу файлом ▾</summary>
            <div className="mt-2">
              <LeadImportForm managers={managers} />
            </div>
          </details>
        )}
      </div>

      {/* Новый вид (19.10.2026): лиды слева, справа — кто написал в WhatsApp и как работают менеджеры. */}
      <div className={inbox.length > 0 || (manage && summary.byManager.length > 0) ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] items-start" : ""}>
        <LeadsBoard
          rows={rows}
          myEmail={email}
          canManage={manage}
          leadgen={leadgen}
          canOpenCalls={canOpen(role, "/clients/leads/calls")}
          managers={managers}
          talk={talk}
          today={today}
        />

        {(inbox.length > 0 || (manage && summary.byManager.length > 0)) && (
          <div className="space-y-5 min-w-0">
            {/* Кто написал на номер Земфиры и ещё не заведён лидом; рабочий номер не показываем. */}
            <WaInbox rows={inbox} />

            {manage && summary.byManager.length > 0 && (
              <div className="card !p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-line-hairline">
                  <h2 className="font-display text-[15px] font-bold">Как работают менеджеры</h2>
                  <Hint>«Дошли до заказа» и «отказ» — за 30 дней. Просрочено у всех: {summary.overdue}.</Hint>
                </div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                      <th className="px-4 py-2 font-medium">Менеджер</th>
                      <th className="px-2 py-2 font-medium text-right" title="В работе">Работа</th>
                      <th className="px-2 py-2 font-medium text-right" title="Просрочено">Проср.</th>
                      <th className="px-2 py-2 font-medium text-right" title="Касаний за 7 дней">7 дн.</th>
                      <th className="px-4 py-2 font-medium text-right" title="Дошли до заказа / отказ за 30 дней">Заказ / отказ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byManager.map((m) => (
                      <tr key={m.email} className="border-b border-line-hairline/70 last:border-0">
                        <td className="px-4 py-2 font-medium truncate max-w-[120px]">{m.name}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{m.open}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${m.overdue > 0 ? "text-status-critical font-semibold" : "text-ink-muted"}`}>
                          {m.overdue || "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{m.touches7}</td>
                        <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                          <span className="text-status-good">{m.won30 || 0}</span>
                          <span className="text-ink-muted"> / {m.lost30 || 0}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
