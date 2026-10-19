import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import clsx from "clsx";
import { authOptions } from "@/lib/auth";
import { prefetchTables } from "@/lib/sheets";
import { ROLES, SHEET_TABS } from "@/lib/constants";
import { listLeadTouches, listLeads } from "@/lib/repo/leads";
import { listUsers } from "@/lib/repo/users";
import { canManageLeads, canUseLeads } from "@/lib/leads";
import { buildCallQueue, buildCallReport, listCampaigns } from "@/lib/calls";
import { localDayKey } from "@/lib/timezone";
import { isRetailRole } from "@/lib/retail";
import PageHeader from "@/components/PageHeader";
import PaneTabs from "@/components/PaneTabs";
import CallDesk from "@/components/CallDesk";
import CallReport from "@/components/CallReport";
import { clientsTabsFor } from "../../tabs";
import { withBotName } from "@/lib/botIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Загрузка базы на тысячи строк и раздача пишут в таблицу одним большим запросом.
export const maxDuration = 60;

/** Сколько клиентов отдаём экрану обзвона за раз: дальше очередь дочитается сама. */
const QUEUE_BATCH = 60;

/**
 * «Клиенты → Обзвон». Менеджер звонит по своей очереди и ставит итог одним
 * нажатием; РОП и админ видят итоги обзвона, раздают базу и слушают ленту
 * звонков. Правила — `src/lib/calls.ts`, действия — `./actions.ts`.
 */
export default async function CallsPage({ searchParams }: { searchParams?: { c?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (isRetailRole(role)) redirect("/retail");
  if (!canUseLeads(role)) redirect("/?error=forbidden");
  const email = (session?.user?.email ?? "").toLowerCase();
  const manage = canManageLeads(role);

  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.USERS]);
  const [leads, touches, users] = await Promise.all([listLeads(), listLeadTouches(), listUsers()]);
  const today = localDayKey();
  const nameByEmail = withBotName(new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email])));
  const managers = users
    .filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD))
    .map((u) => ({ email: u.email.toLowerCase(), name: u.name || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const campaigns = listCampaigns(leads);
  const asked = (searchParams?.c ?? "").trim();
  const campaign = campaigns.some((c) => c.name === asked) ? asked : "";

  const mine = leads.filter((l) => l.managerEmail === email);
  const queue = buildCallQueue(mine, touches, today, campaign);
  const myCallsToday = touches.filter((t) => t.managerEmail === email && !!t.outcome && t.createdAt.slice(0, 10) === today).length;
  const report = manage
    ? buildCallReport({
        leads,
        touches,
        campaign: campaign || campaigns[0]?.name || "",
        today,
        nameByEmail,
        sellers: managers.filter((m) => users.find((u) => u.email.toLowerCase() === m.email)?.role === ROLES.MANAGER).map((m) => m.email),
      })
    : null;
  const showDesk = !manage || queue.items.length > 0 || queue.later > 0;
  const reportCampaign = report?.campaign ?? "";

  const desk = <CallDesk items={queue.items.slice(0, QUEUE_BATCH)} counts={queue} today={today} callsToday={myCallsToday} />;

  return (
    <div>
      <PageHeader area="leads" title="Обзвон" tabs={clientsTabsFor(undefined, role)} />

      {campaigns.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scroll-x-hidden lg:flex-wrap -mx-1 px-1 mb-5">
          {!manage && <CampaignChip href="/clients/leads/calls" active={!campaign} label="Все мои" />}
          {campaigns.map((c) => (
            <CampaignChip
              key={c.name}
              href={`/clients/leads/calls?c=${encodeURIComponent(c.name)}`}
              active={manage ? reportCampaign === c.name : campaign === c.name}
              label={c.name}
              count={c.leads}
            />
          ))}
        </div>
      )}

      {manage && campaigns.length === 0 && (
        <p className="card text-sm text-ink-secondary mb-5">
          Обзвонов ещё нет. Загрузите базу в «Лидах» — кнопка «Загрузить базу»: там же назовёте обзвон и раздадите
          клиентов менеджерам.{" "}
          <Link href="/clients/leads" className="text-accent hover:underline">
            Перейти в «Лиды» →
          </Link>
        </p>
      )}

      {manage ? (
        <PaneTabs
          tabs={[
            { key: "report", label: "Итоги обзвона", content: report && campaigns.length > 0 ? <CallReport report={report} managers={managers} /> : null },
            { key: "desk", label: "Мои звонки", count: queue.items.length, content: showDesk ? desk : null },
          ]}
        />
      ) : (
        desk
      )}
    </div>
  );
}

function CampaignChip({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      className={clsx(
        "flex-none h-8 px-3 rounded-full border text-[13px] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors",
        active ? "bg-ink-primary border-ink-primary text-white font-semibold" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary"
      )}
    >
      {label}
      {count !== undefined && <span className={clsx("tabular-nums", active ? "text-white/70" : "text-ink-muted")}>{count}</span>}
    </Link>
  );
}
