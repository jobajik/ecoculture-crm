import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prefetchTables } from "@/lib/sheets";
import { ROLES, SHEET_TABS } from "@/lib/constants";
import { canManageLeads, canWorkLead } from "@/lib/leads";
import { listLeadTouches, listLeads } from "@/lib/repo/leads";
import { listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { listUsers } from "@/lib/repo/users";
import { buildDecisionBoard, decisionScope } from "@/lib/leadDecisions";
import { localDayKey } from "@/lib/timezone";
import { openAiConfigured } from "@/lib/openai";
import PageHeader from "@/components/PageHeader";
import Hint from "@/components/Hint";
import LeadDecisionsBoard, { type BoardRow } from "@/components/LeadDecisionsBoard";
import { clientsTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * «Решения ИИ» (15.10.2026, владелец: «сортировку по лидам от Земфиры, где ИИ сам определяет,
 * как дальше поступать с клиентом: отказ, перезвонить через 3 дня, продать — отдельной вкладкой»).
 * Лиды с рекламы по решению из разбора переписки (`src/lib/leadDecisions.ts`); применяет человек.
 */
export default async function LeadDecisionsPage({ searchParams }: { searchParams?: { m?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.LEADGEN && role !== ROLES.MANAGER && !canManageLeads(role)) redirect("/clients/leads");
  const email = (session?.user?.email ?? "").toLowerCase();
  const today = localDayKey();

  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.LEAD_ANALYSES, SHEET_TABS.WA_MESSAGES, SHEET_TABS.USERS]);
  const [leads, touches, analyses, messages, users] = await Promise.all([
    listLeads(),
    listLeadTouches(),
    listLeadAnalyses(),
    listWaMessages({ lines: "all" }),
    listUsers(),
  ]);
  const manage = canManageLeads(role);
  const managerFilter = manage ? (searchParams?.m ?? "").toLowerCase() : "";
  const mine = decisionScope({ role, email, leads, messages, analyses, manager: managerFilter });
  // Отбор по менеджеру у владельца и РОПа: кто есть среди лидов с перепиской.
  const scopeAll = manage ? decisionScope({ role, email, leads, messages, analyses }) : [];
  const managerOptions = Array.from(new Set(scopeAll.map((l) => l.managerEmail).filter(Boolean)))
    .map((e) => ({ email: e, name: users.find((u) => u.email.toLowerCase() === e)?.name || e }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const board = buildDecisionBoard({
    leads: mine,
    messages,
    analyses,
    touches,
    today,
    toDay: (iso) => (iso ? localDayKey(new Date(iso)) : ""),
  });
  const byId = new Map(mine.map((l) => [l.leadId, l]));
  const nameOf = (e: string) => (e ? users.find((u) => u.email.toLowerCase() === e)?.name || e : "");
  const toRow = (r: (typeof board.done)[number]): BoardRow => {
    const lead = byId.get(r.leadId)!;
    return { ...r, managerName: nameOf(r.managerEmail), canWork: canWorkLead(role, email, lead) };
  };

  return (
    <div className="space-y-5">
      <PageHeader
        area="leads"
        title={
          <span className="inline-flex items-center gap-2">
            Решения ИИ
            <Hint>
              ИИ читает переписку с лидом и предлагает одно из трёх: продать сейчас, написать позже через несколько
              дней или закрыть отказом — с причиной и готовым сообщением клиенту. Решает человек: кнопка «Применить» записывает
              касание, стадию и дату следующего разговора. Новые переписки разбираются кнопкой и каждый вечер сами.
            </Hint>
          </span>
        }
        subtitle={role === ROLES.LEADGEN ? "Лиды с рекламы: что ИИ советует сделать с каждым" : "Лиды с перепиской в WhatsApp: что ИИ советует сделать с каждым"}
        tabs={clientsTabsFor(undefined, role)}
      />
      {manage && managerOptions.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {[{ email: "", name: "Все менеджеры" }, ...managerOptions].map((o) => (
            <Link
              key={o.email || "all"}
              href={o.email ? `/clients/leads/decide?m=${encodeURIComponent(o.email)}` : "/clients/leads/decide"}
              className={
                "px-3 py-1.5 rounded-lg border transition-colors " +
                (o.email === managerFilter ? "border-section-leads bg-section-leads-soft text-ink-primary font-medium" : "border-line-hairline text-ink-secondary hover:text-ink-primary")
              }
            >
              {o.name}
            </Link>
          ))}
        </div>
      )}
      <LeadDecisionsBoard
        today={today}
        aiReady={openAiConfigured()}
        toAnalyze={board.toAnalyze.length}
        closed={board.closed}
        groups={{
          sell: board.groups.sell.map(toRow),
          follow_up: board.groups.follow_up.map(toRow),
          lost: board.groups.lost.map(toRow),
          none: board.groups.none.map(toRow),
        }}
        done={board.done.map(toRow)}
        showManager={manage}
      />
    </div>
  );
}
