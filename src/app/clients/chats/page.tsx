import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prefetchTables } from "@/lib/sheets";
import { SHEET_TABS } from "@/lib/constants";
import { canSeeLead, canWorkLead, phoneKey } from "@/lib/leads";
import { listLeads, listLeadTouches } from "@/lib/repo/leads";
import { listLeadAnalyses } from "@/lib/repo/talks";
import { buildDecisionBoard, type DecisionGroup, type DecisionRow } from "@/lib/leadDecisions";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import { listClients } from "@/lib/repo/clients";
import { listWaMessages } from "@/lib/repo/talks";
import { listUsers } from "@/lib/repo/users";
import { listAssistantLog } from "@/lib/repo/waLines";
import { canSendOnLeadsLine, visibleLines } from "@/lib/chatAccess";
import { buildChatList, isManagerLine, assistantVerdict, type ChatPartyInfo } from "@/lib/waLines";
import { mergeMessages } from "@/lib/whatsapp";
import { openAiConfigured } from "@/lib/openai";
import PageHeader from "@/components/PageHeader";
import Hint from "@/components/Hint";
import ChatsBoard, { type BoardChat, type BoardDecision, type BoardMessage, type BoardNote } from "@/components/ChatsBoard";
import { clientsTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * «Клиенты → Переписки» (16.10.2026, владелец: «хочу видеть их переписки, разборы и разговоры»).
 * Слева чаты выбранного номера, справа переписка, ИИ-черновик ответа и отправка с номера менеджера.
 */
export default async function ChatsPage({ searchParams }: { searchParams?: { line?: string; phone?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const email = (session?.user?.email ?? "").toLowerCase();
  const lines = await visibleLines(role, email);
  if (lines.length === 0) {
    if (!session) redirect("/login");
  }
  const wanted = searchParams?.line ?? null;
  const current = lines.find((l) => l.code === wanted) ?? lines[0] ?? null;

  await prefetchTables([
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.LEADS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.USERS,
    SHEET_TABS.ASSISTANT_LOG,
    SHEET_TABS.LEAD_ANALYSES,
    SHEET_TABS.LEAD_TOUCHES,
  ]);
  const [messages, leads, clients, users, log, analyses, touches] = await Promise.all([
    listWaMessages({ lines: "all" }),
    listLeads(),
    listClients(),
    listUsers(),
    listAssistantLog(),
    listLeadAnalyses(),
    listLeadTouches(),
  ]);
  const parties = new Map<string, ChatPartyInfo>();
  for (const l of leads) {
    const k = phoneKey(l.phone);
    if (k) parties.set(k, { kind: "lead", id: l.leadId, name: l.name, managerEmail: l.managerEmail });
  }
  for (const c of clients) {
    for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) {
      const k = phoneKey(p);
      if (k) parties.set(k, { kind: "client", id: c.clientId, name: c.name, managerEmail: c.managerEmail });
    }
  }
  const autoIds = new Set(log.filter((r) => r.kind === "auto" || r.kind === "nudge").map((r) => r.messageId));
  const crmIds = new Set(log.filter((r) => r.kind === "crm").map((r) => r.messageId));
  const now = new Date();
  const since = new Date(now.getTime() - 60 * 86400000).toISOString();

  // Сколько ждут ответа на каждом номере — для вкладок номеров.
  const lineTabs = lines.map((l) => {
    const list = buildChatList({ messages, line: l.code, parties, autoIds, sinceIso: since });
    return { code: l.code, label: l.label, waiting: list.filter((c) => c.waitingSince).length, chats: list.length };
  });

  const chats = current ? buildChatList({ messages, line: current.code, parties, autoIds, sinceIso: since }).slice(0, 400) : [];
  // Записки помощника «нужен менеджер»: открытые, и менеджер с тех пор в чат не писал.
  const openNotes = new Map<string, BoardNote[]>();
  if (current) {
    for (const n of log.filter((r) => r.kind === "note" && !r.doneAt && r.line === current.code)) {
      const k = phoneKey(n.phone);
      const humanAfter = messages.some((m) => (m.line || "") === current.code && phoneKey(m.phone) === k && m.direction === "out" && m.at > n.at && !autoIds.has(m.messageId));
      if (humanAfter) continue;
      openNotes.set(k, [...(openNotes.get(k) ?? []), { at: n.at, note: n.note }]);
    }
  }
  const nameOf = (e: string) => users.find((u) => u.email.toLowerCase() === e)?.name || e;

  // Решения ИИ прямо в чатах (19.10.2026, владелец: «поместить сюда Решения ИИ — сразу на чатах»): по лиду собеседника —
  // продать / позже / отказ, почему и черновик; применено ли уже. Те же правила, что на вкладке «Решения ИИ»
  // (`buildDecisionBoard`), только разложены по номерам телефонов.
  const today = localDayKey();
  const board = buildDecisionBoard({
    leads: leads.filter((l) => canSeeLead(role, email, l)),
    messages,
    analyses,
    touches,
    today,
    toDay: (iso) => (iso ? localDayKey(new Date(iso)) : ""),
  });
  const decisionByLead = new Map<string, BoardDecision>();
  const put = (r: DecisionRow, group: DecisionGroup | "done") => {
    const lead = leads.find((l) => l.leadId === r.leadId);
    decisionByLead.set(r.leadId, {
      group,
      days: group === "follow_up" ? (r.dueDay ? formatDay(r.dueDay) : "") : "",
      why: r.why,
      draft: r.draft,
      summary: r.summary,
      analyzedAt: r.analyzedAt,
      newMessages: r.newMessages,
      tooShort: r.tooShort,
      canWork: !!lead && canWorkLead(role, email, lead),
    });
  };
  for (const g of ["sell", "follow_up", "lost", "none"] as const) for (const r of board.groups[g]) put(r, g);
  for (const r of board.done) put(r, "done");

  const boardChats: BoardChat[] = chats.map((c) => ({
    decision: c.party?.kind === "lead" ? decisionByLead.get(c.party.id) ?? null : null,
    phone: c.phone,
    key: c.key,
    name: c.name,
    partyKind: c.party?.kind ?? "",
    partyId: c.party?.id ?? "",
    partyManager: c.party?.managerEmail ? nameOf(c.party.managerEmail) : "",
    lastAt: c.lastAt,
    lastText: c.lastText,
    lastDirection: c.lastDirection,
    lastByAssistant: c.lastByAssistant,
    waitingSince: c.waitingSince,
    notes: openNotes.get(c.key) ?? [],
  }));

  const selectedKey = phoneKey(searchParams?.phone ?? "");
  const selected = boardChats.find((c) => c.key === selectedKey) ?? null;
  let thread: BoardMessage[] = [];
  let verdict = "";
  if (current && selected) {
    const chat = mergeMessages(messages.filter((m) => (m.line || "") === current.code && phoneKey(m.phone) === selected.key));
    thread = chat.slice(-250).map((m) => ({
      id: m.messageId,
      at: m.at,
      direction: m.direction,
      type: m.type,
      text: m.text,
      by: autoIds.has(m.messageId) ? "ai" : crmIds.has(m.messageId) ? "crm" : "",
    }));
    if (current.line) {
      const v = assistantVerdict({ chat, autoIds, now, mode: current.line.assistant });
      verdict = current.line.assistant === "off" ? "ИИ на этом номере только подсказывает" : v.due ? "ИИ скоро ответит сам: клиент ждёт" : `ИИ сам не отвечает: ${v.reason}`;
    }
  }
  const canSend =
    !!current &&
    ((isManagerLine(current.code) && !!current.line && (role === "admin" || current.line.managerEmail === email)) ||
      (current.code === "leads" && canSendOnLeadsLine(role)));

  return (
    <div>
      <PageHeader
        area="leads"
        title={
          <span className="inline-flex items-center gap-2">
            Переписки
            <Hint>
              Переписки WhatsApp по номерам: менеджеров, Земфиры и основного (бот). «Предложить ответ» — ИИ пишет черновик с
              ценами и наличием со склада, вы правите и отправляете. ИИ-помощник отвечает сам, когда клиент ждёт дольше 20 минут,
              вечером и в выходные; его сообщения помечены «ИИ». Когда нужен человек (оформить заказ, нестандартный вопрос), он
              оставляет записку — она висит наверху, пока менеджер не ответит.
            </Hint>
          </span>
        }
        subtitle="WhatsApp менеджеров: кто ждёт ответа и что ответил ИИ"
        tabs={clientsTabsFor(undefined, role)}
      />
      {current ? (
        <ChatsBoard
          lines={lineTabs}
          line={current.code}
          chats={boardChats}
          selected={selected}
          thread={thread}
          verdict={verdict}
          canSend={canSend}
          aiReady={openAiConfigured()}
          lineConnected={!isManagerLine(current.code) || !!current.line?.tokenEnc}
        />
      ) : (
        <div className="card text-sm text-ink-secondary">
          Ваш номер WhatsApp ещё не подключён к CRM. Попросите администратора подключить его в «Настройках → WhatsApp менеджеров».
        </div>
      )}
    </div>
  );
}
