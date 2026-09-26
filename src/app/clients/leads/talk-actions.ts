"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { SHEET_TABS } from "@/lib/constants";
import { prefetchTables } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { canManageLeads, canUseLeads, canWorkLead } from "@/lib/leads";
import { listLeads } from "@/lib/repo/leads";
import { listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { buildTalkReport, talkInfoByLead } from "@/lib/talkAnalysis";
import { runStaleAnalyses, runTalkAnalysis } from "@/lib/talkRunner";

/**
 * Разбор переписки ИИ. Запускает менеджер своего лида, РОП и админ; РОП ещё
 * может разобрать разом всё, где появились новые сообщения. Проверки — здесь,
 * на сервере (грабли 1.11).
 */
async function requireLeads() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (!canUseLeads(role)) throw new Error("Лидами занимаются менеджеры и РОП");
  return { email: session.user.email.trim().toLowerCase(), role };
}

function refresh(leadId?: string) {
  revalidatePath("/clients/leads");
  revalidatePath("/clients/leads/talks");
  if (leadId) revalidatePath(`/clients/leads/${leadId}`);
}

async function analyzeLeadTalkActionInner(leadId: string): Promise<{ score: number | null; temperature: string; pulled: number }> {
  const { email, role } = await requireLeads();
  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.WA_MESSAGES]);
  const [leads, messages] = await Promise.all([listLeads(), listWaMessages()]);
  const lead = leads.find((l) => l.leadId === leadId);
  if (!lead) throw new Error("Лид не найден — возможно, его удалили в таблице");
  if (!canWorkLead(role, email, lead)) throw new Error("Разбирает переписку менеджер этого лида или РОП");
  const result = await runTalkAnalysis(lead, messages, email, localDayKey());
  refresh(leadId);
  return { score: result.analysis.score, temperature: result.analysis.temperature, pulled: result.pulled };
}

export async function analyzeLeadTalkAction(leadId: string) {
  return guard(() => analyzeLeadTalkActionInner(leadId));
}

async function analyzeStaleTalksActionInner(): Promise<{ done: number; failed: string[]; left: number }> {
  const { email, role } = await requireLeads();
  if (!canManageLeads(role)) throw new Error("Разбирать всё разом может РОП или админ");
  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.LEAD_ANALYSES]);
  const [leads, messages, analyses] = await Promise.all([listLeads(), listWaMessages(), listLeadAnalyses()]);
  const infos = Array.from(talkInfoByLead(leads, messages, analyses).values());
  const report = buildTalkReport(infos, new Map(), new Date());
  // Кнопка в браузере ждёт ответа, поэтому по нажатию — немного: остальное по кругу.
  const result = await runStaleAnalyses(leads, report.stale, messages, email, localDayKey(), { limit: 4, budgetMs: 35000 });
  refresh();
  return result;
}

export async function analyzeStaleTalksAction() {
  return guard(() => analyzeStaleTalksActionInner());
}
