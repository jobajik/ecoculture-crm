"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES, SHEET_TABS } from "@/lib/constants";
import { prefetchTables } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import {
  adsManagerTouches,
  canManageLeads,
  canSeeLead,
  canWorkLead,
  cleanStage,
  isAdsLead,
  leadChangesAfterTouch,
  touchRefusal,
} from "@/lib/leads";
import { addTouch, addTouchesBatch, getLead, listLeadTouches, listLeads } from "@/lib/repo/leads";
import { listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { buildDecisionBoard, decisionScope, decisionTouch } from "@/lib/leadDecisions";
import { latestByLead, type DecisionKey } from "@/lib/talkAnalysis";
import { runStaleAnalyses } from "@/lib/talkRunner";
import { openAiConfigured } from "@/lib/openai";
import type { Lead } from "@/lib/types";

/**
 * «Решения ИИ» (15.10.2026): Земфира — свои лиды с рекламы, РОП и админ — все.
 * ИИ предлагает, касание записывает человек кнопкой. Проверки — на сервере (грабли 1.11).
 */
async function requireDecider() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (role !== ROLES.LEADGEN && role !== ROLES.MANAGER && !canManageLeads(role)) throw new Error("Решения ИИ — у менеджеров, Земфиры, РОПа и админа");
  return { email: session.user.email.trim().toLowerCase(), role };
}

const toDay = (iso: string) => (iso ? localDayKey(new Date(iso)) : "");
const PATH = "/clients/leads/decide";

function refresh(leadIds: string[] = []) {
  revalidatePath(PATH);
  revalidatePath("/clients/leads");
  for (const id of leadIds.slice(0, 5)) revalidatePath(`/clients/leads/${id}`);
}

const DECISION_SET = new Set<string>(["sell", "follow_up", "lost"]);

function cleanOverride(o?: { decision?: string; days?: number }): { decision?: DecisionKey; days?: number } | undefined {
  if (!o) return undefined;
  const decision = o.decision && DECISION_SET.has(o.decision) ? (o.decision as DecisionKey) : undefined;
  const days = Number.isFinite(Number(o.days)) && o.days != null ? Math.min(30, Math.max(1, Math.round(Number(o.days)))) : undefined;
  return decision || days != null ? { decision, days } : undefined;
}

/** Применить решение по одному лиду: касание «Решение ИИ — …», стадия и следующее касание. */
async function applyDecisionActionInner(leadId: string, override?: { decision?: string; days?: number }) {
  const { email, role } = await requireDecider();
  const lead = await getLead(leadId, { fresh: true });
  if (!lead) throw new Error("Лид не найден");
  if (!canWorkLead(role, email, lead)) throw new Error("Лид уже у менеджера — решение за ним");
  const analysis = latestByLead(await listLeadAnalyses()).get(leadId);
  if (!analysis) throw new Error("Переписку ещё не разбирали — сначала «Разобрать»");
  const today = localDayKey();
  const input = decisionTouch(analysis, lead, today, toDay, cleanOverride(override));
  const adsBefore = lead.handedOverAt ? adsManagerTouches(lead, await listLeadTouches({ fresh: true })).length : 0;
  const refusal = touchRefusal(input, lead, today, adsBefore);
  if (refusal) throw new Error(refusal);
  const now = new Date().toISOString();
  await addTouch(
    leadId,
    { managerEmail: email, channel: input.channel, comment: input.comment, stageFrom: cleanStage(lead.stage), stageTo: input.stage, nextTouchAt: input.nextTouchAt },
    leadChangesAfterTouch(lead, input, now),
    now
  );
  refresh([leadId]);
  return { stage: input.stage, nextTouchAt: input.nextTouchAt };
}

export async function applyDecisionAction(leadId: string, override?: { decision?: string; days?: number }) {
  return guard(() => applyDecisionActionInner(leadId, override));
}

/** Применить решения у группы — одной записью. Кого нельзя — пропускаем и говорим почему. */
async function applyDecisionsActionInner(leadIds: string[]): Promise<{ applied: number; skipped: string[] }> {
  const { email, role } = await requireDecider();
  if (!Array.isArray(leadIds) || leadIds.length === 0) throw new Error("Некого применять");
  const ids = Array.from(new Set(leadIds.map(String))).slice(0, 80);
  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.LEAD_ANALYSES, SHEET_TABS.LEAD_TOUCHES]);
  const [leads, analyses, touches] = await Promise.all([listLeads({ fresh: true }), listLeadAnalyses(), listLeadTouches({ fresh: true })]);
  const byId = new Map(leads.map((l) => [l.leadId, l]));
  const latest = latestByLead(analyses);
  const today = localDayKey();
  const now = new Date().toISOString();
  const skipped: string[] = [];
  const items: Parameters<typeof addTouchesBatch>[0] = [];
  for (const id of ids) {
    const lead = byId.get(id);
    if (!lead) continue;
    const a = latest.get(id);
    if (!canWorkLead(role, email, lead) || !a) {
      skipped.push(`${lead.name}: ${!a ? "нет разбора" : "лид уже у менеджера"}`);
      continue;
    }
    const input = decisionTouch(a, lead, today, toDay);
    const refusal = touchRefusal(input, lead, today, lead.handedOverAt ? adsManagerTouches(lead, touches).length : 0);
    if (refusal) {
      skipped.push(`${lead.name}: ${refusal}`);
      continue;
    }
    items.push({
      leadId: id,
      touch: { managerEmail: email, channel: input.channel, comment: input.comment, stageFrom: cleanStage(lead.stage), stageTo: input.stage, nextTouchAt: input.nextTouchAt },
      leadChanges: leadChangesAfterTouch(lead, input, now),
    });
  }
  const applied = await addTouchesBatch(items, now);
  refresh();
  return { applied, skipped: skipped.slice(0, 10) };
}

export async function applyDecisionsAction(leadIds: string[]) {
  return guard(() => applyDecisionsActionInner(leadIds));
}

/** «Разобрать»: несколько лидов за нажатие (функция живёт минуту), сначала ни разу не разобранные. */
async function analyzeDecisionsActionInner(): Promise<{ done: number; failed: string[]; left: number }> {
  const { email, role } = await requireDecider();
  if (!openAiConfigured()) throw new Error("ИИ не подключён: нужен ключ OpenAI.");
  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.LEAD_ANALYSES, SHEET_TABS.LEAD_TOUCHES]);
  const [leads, messages, analyses, touches] = await Promise.all([
    listLeads(),
    listWaMessages({ lines: "all" }),
    listLeadAnalyses(),
    listLeadTouches(),
  ]);
  const mine = decisionScope({ role, email, leads, messages, analyses });
  const board = buildDecisionBoard({ leads: mine, messages, analyses, touches, today: localDayKey(), toDay });
  const analysed = new Set(latestByLead(analyses).keys());
  const queue = [...board.toAnalyze.filter((id) => !analysed.has(id)), ...board.toAnalyze.filter((id) => analysed.has(id))];
  const result = await runStaleAnalyses(mine, queue.map((leadId) => ({ leadId })), messages, email, localDayKey(), {
    // Новый разбор начинаем, только пока прошло меньше 22 с: один разбор идёт до 25 с, а функция живёт минуту.
    // 16.10.2026 при 40 с запрос обрывался посреди шестого разбора, и страница писала «сохранение не дошло».
    limit: 4,
    budgetMs: 22000,
  });
  refresh();
  return result;
}

export async function analyzeDecisionsAction() {
  return guard(() => analyzeDecisionsActionInner());
}
