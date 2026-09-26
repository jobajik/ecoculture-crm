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
import { appendWaMessages, listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { exportToMessages, leadPhoneDigits, MAX_IMPORT_MESSAGES, type ExportLine } from "@/lib/whatsappExport";
import { openAiConfigured } from "@/lib/openai";
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

/**
 * Переписка из «Экспорта чата» WhatsApp — для личных номеров менеджеров и для
 * проверки разбора до подключения рабочего номера. Файл разбирается в браузере,
 * сюда приходят уже строки (так не упираемся в предел размера запроса), и сервер
 * проверяет их заново (грабли 1.11). Повторная загрузка того же чата склеивается
 * по номеру сообщения. `analyze` — сразу разобрать.
 */
async function importChatActionInner(
  leadId: string,
  lines: ExportLine[],
  ours: string[],
  analyze: boolean
): Promise<{ added: number; total: number; analyzed: boolean; analysisError: string }> {
  const { email, role } = await requireLeads();
  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.WA_MESSAGES]);
  const [leads, messages] = await Promise.all([listLeads(), listWaMessages()]);
  const lead = leads.find((l) => l.leadId === leadId);
  if (!lead) throw new Error("Лид не найден — возможно, его удалили в таблице");
  if (!canWorkLead(role, email, lead)) throw new Error("Загружает переписку менеджер этого лида или РОП");
  const digits = leadPhoneDigits(lead.phone);
  if (!digits) throw new Error("У лида нет телефона — впишите его в карточку, по нему переписка привязывается к лиду.");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("В файле не нашлось сообщений — это точно «Экспорт чата» WhatsApp?");
  if (!Array.isArray(ours) || ours.length === 0) throw new Error("Отметьте, кто в переписке пишет от нас.");

  const clean: ExportLine[] = lines
    .slice(-MAX_IMPORT_MESSAGES)
    .filter((l) => l && typeof l.at === "string" && !Number.isNaN(Date.parse(l.at)) && typeof l.author === "string" && typeof l.text === "string")
    .map((l) => ({ at: new Date(l.at).toISOString(), author: l.author.slice(0, 120), text: l.text.slice(0, 4000) }));
  const imported = exportToMessages({ messages: clean, authors: [] }, ours.map((o) => String(o).slice(0, 120)), digits);
  if (imported.every((m) => m.direction === "out")) throw new Error("Все сообщения отмечены как наши — снимите отметку с клиента.");
  const stored = new Set(messages.map((m) => m.messageId));
  const fresh = imported.filter((m) => !stored.has(m.messageId));
  await appendWaMessages(fresh);

  // Переписка уже записана — сбой разбора не должен выглядеть как «не загрузилось».
  let analyzed = false;
  let analysisError = "";
  if (analyze && openAiConfigured()) {
    try {
      await runTalkAnalysis(lead, [...messages, ...fresh], email, localDayKey());
      analyzed = true;
    } catch (err) {
      analysisError = err instanceof Error ? err.message : "Разобрать не удалось";
    }
  }
  refresh(leadId);
  return { added: fresh.length, total: imported.length, analyzed, analysisError };
}

export async function importChatAction(leadId: string, lines: ExportLine[], ours: string[], analyze: boolean) {
  return guard(() => importChatActionInner(leadId, lines, ours, analyze));
}
