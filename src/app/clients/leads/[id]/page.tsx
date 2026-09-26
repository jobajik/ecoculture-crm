import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prefetchTables } from "@/lib/sheets";
import { ROLES, SHEET_TABS } from "@/lib/constants";
import { listLeadTouches, listLeads } from "@/lib/repo/leads";
import { listUsers } from "@/lib/repo/users";
import { getClientById } from "@/lib/repo/clients";
import {
  LEAD_STAGES,
  canManageLeads,
  canSeeLead,
  canUseLeads,
  canWorkLead,
  cleanStage,
  isClosedStage,
  stageIndex,
  stageLabel,
} from "@/lib/leads";
import { localDayKey } from "@/lib/timezone";
import { formatDay, formatMoment } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import LeadStageBadge from "@/components/LeadStageBadge";
import LeadInfoForm from "@/components/LeadInfoForm";
import LeadTouchForm from "@/components/LeadTouchForm";
import LeadTalkPanel from "@/components/LeadTalkPanel";
import WaChat from "@/components/WaChat";
import { listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { latestByLead, newSinceAnalysis, touchPrefill } from "@/lib/talkAnalysis";
import { messagesForPhone, minutesSince, replyStats } from "@/lib/whatsapp";
import { whatsappLink } from "@/lib/leads";
import { greenConfig } from "@/lib/greenApi";
import { openAiConfigured } from "@/lib/openai";
import { clientsTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Разбор переписки (серверное действие этой страницы) идёт до полуминуты.
export const maxDuration = 60;

/** Карточка лида: кто это, где он в воронке и вся история касаний. */
export default async function LeadPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (!canUseLeads(role)) redirect("/?error=forbidden");
  const email = (session?.user?.email ?? "").toLowerCase();

  await prefetchTables([
    SHEET_TABS.LEADS,
    SHEET_TABS.LEAD_TOUCHES,
    SHEET_TABS.USERS,
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.LEAD_ANALYSES,
  ]);
  const [leads, touches, users, allMessages, analyses] = await Promise.all([
    listLeads(),
    listLeadTouches(),
    listUsers(),
    listWaMessages(),
    listLeadAnalyses(),
  ]);
  const lead = leads.find((l) => l.leadId === params.id);
  // Чужой лид не открывается и по прямой ссылке (грабли 1.11).
  if (!lead || !canSeeLead(role, email, lead)) notFound();

  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const history = touches
    .filter((t) => t.leadId === lead.leadId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const stage = cleanStage(lead.stage);
  const client = lead.clientId ? await getClientById(lead.clientId) : null;
  const today = localDayKey();
  const manage = canManageLeads(role);
  const work = canWorkLead(role, email, lead);
  const managers = users
    .filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD))
    .map((u) => ({ email: u.email.toLowerCase(), name: u.name || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const overdue = !isClosedStage(stage) && !!lead.nextTouchAt && lead.nextTouchAt < today;
  const current = stageIndex(stage);

  // Переписка рабочего WhatsApp и её разбор ИИ.
  const messages = messagesForPhone(allMessages, lead.phone);
  const talkStats = replyStats(messages);
  const waitingMinutes = !isClosedStage(stage) && talkStats.waitingSince ? minutesSince(talkStats.waitingSince, new Date()) : null;
  const analysis = latestByLead(analyses.filter((a) => a.leadId === lead.leadId)).get(lead.leadId) ?? null;
  const prefill = analysis && work && !isClosedStage(stage) ? touchPrefill(analysis, lead, today) : null;
  const waConnected = !!greenConfig();
  const aiReady = openAiConfigured();
  const showTalk = messages.length > 0 || !!analysis || waConnected || (aiReady && work);

  return (
    <div className="space-y-4">
      <PageHeader
        area="leads"
        eyebrow="Лид"
        title={lead.name}
        tabs={clientsTabsFor()}
        subtitle={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-1">
            <LeadStageBadge stage={stage} />
            {!isClosedStage(stage) && (
              <span className={`text-sm ${overdue ? "text-status-critical font-medium" : "text-ink-secondary"}`}>
                {lead.nextTouchAt
                  ? lead.nextTouchAt === today
                    ? "касание сегодня"
                    : `следующее касание ${formatDay(lead.nextTouchAt)}${overdue ? " — просрочено" : ""}`
                  : "следующее касание не назначено"}
              </span>
            )}
            {stage === "lost" && lead.lostReason && <span className="text-sm text-ink-muted">причина: {lead.lostReason}</span>}
          </span>
        }
        actions={
          <Link href="/clients/leads" className="text-sm text-accent hover:underline">
            ← Лиды
          </Link>
        }
      />

      {/* Путь по стадиям: где лид сейчас. Отказ — отдельно, не шаг пути. */}
      <ol className="flex gap-1 overflow-x-auto text-xs" aria-label="Стадии">
        {LEAD_STAGES.filter((s) => s.key !== "lost").map((s, i) => (
          <li
            key={s.key}
            className={`flex-1 min-w-[72px] rounded-md px-2 py-1.5 ${
              stage === "lost"
                ? "bg-surface-sunk text-ink-muted"
                : i < current
                  ? "bg-accent/15 text-accent"
                  : i === current
                    ? "bg-accent text-white font-medium"
                    : "bg-surface-sunk text-ink-muted"
            }`}
            title={`${s.label}: ${s.hint}`}
          >
            {s.short}
          </li>
        ))}
      </ol>

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 items-start">
        <LeadInfoForm
          lead={lead}
          canWork={work}
          canManage={manage}
          canTake={!lead.managerEmail && (role === ROLES.MANAGER || role === ROLES.SALES_HEAD)}
          managers={managers}
          managerName={lead.managerEmail ? nameByEmail.get(lead.managerEmail) ?? lead.managerEmail : ""}
          clientName={client?.name ?? ""}
        />

        <div className="space-y-4 min-w-0">
          {showTalk && (
            <LeadTalkPanel
              leadId={lead.leadId}
              canRun={work}
              aiReady={aiReady}
              analysis={analysis}
              prefill={prefill}
              newMessages={newSinceAnalysis(messages, analysis ?? undefined)}
              currentStage={stage}
              hasMessages={messages.length > 0}
              waConnected={waConnected}
              managerName={lead.managerEmail ? nameByEmail.get(lead.managerEmail) ?? "" : ""}
            />
          )}

          {work ? (
            <LeadTouchForm leadId={lead.leadId} stage={stage} hasClient={!!lead.clientId} today={today} />
          ) : (
            <p className="card text-sm text-ink-secondary">
              {lead.managerEmail ? "Касания записывает менеджер этого лида." : "Возьмите лид себе, чтобы записывать касания."}
            </p>
          )}

          {(messages.length > 0 || waConnected) && (
            <WaChat
              messages={messages}
              waLink={whatsappLink(lead.phone)}
              replyMinutes={talkStats.replyMinutes}
              waitingMinutes={waitingMinutes}
            />
          )}

          <Section tone="leads" icon="phone" title={`Касания · ${history.length}`} flush className="!mb-0">
            {history.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-ink-muted">Ещё не связывались.</p>
            ) : (
              <ol className="divide-y divide-line-hairline/70 border-t border-line-hairline">
                {history.map((t) => (
                  <li key={t.touchId} className="px-4 py-3 text-sm space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted">
                      <span className="tabular-nums">{formatMoment(t.createdAt)}</span>
                      <span>· {t.channel}</span>
                      <span>· {nameByEmail.get(t.managerEmail) ?? t.managerEmail}</span>
                      {t.stageTo && t.stageFrom !== t.stageTo && (
                        <span className="text-accent">
                          · {stageLabel(t.stageFrom)} → {stageLabel(t.stageTo)}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-line">{t.comment}</p>
                    {t.nextTouchAt && <p className="text-xs text-ink-muted">следующее: {formatDay(t.nextTouchAt)}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Section>
          <p className="text-xs text-ink-muted">
            Заведён {formatDay(lead.createdAt)}
            {lead.createdByEmail && ` · ${nameByEmail.get(lead.createdByEmail) ?? lead.createdByEmail}`}
          </p>
        </div>
      </div>
    </div>
  );
}
