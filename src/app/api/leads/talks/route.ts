import { SHEET_TABS } from "@/lib/constants";
import { prefetchTables } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { listLeads } from "@/lib/repo/leads";
import { listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { buildTalkReport, talkInfoByLead } from "@/lib/talkAnalysis";
import { runStaleAnalyses } from "@/lib/talkRunner";
import { openAiConfigured } from "@/lib/openai";
import { runStaleBroadcastAnalyses } from "@/lib/broadcastAnalysisRunner";
import { remindBotInvoices } from "@/lib/botFollowUp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Вечерний разбор переписок (расписание Vercel, `vercel.json`): лиды, у которых
 * за день появились сообщения, разбираются сами — утром РОП видит свежие оценки.
 * Сначала — ответы на свежие рассылки (не больше двух, до 25 секунд), потом
 * лиды на оставшееся время: функция живёт минуту.
 * Вызов только с секретом CRON_SECRET, как у резервной копии.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  // Вечером бот напоминает об оплате по своим заявкам — до разбора, он короче.
  const reminders = await remindBotInvoices();
  if (!openAiConfigured()) return Response.json({ ok: true, skipped: "openai not configured", reminders });
  const started = Date.now();
  let broadcasts: { analyzed: number; errors: number } = { analyzed: 0, errors: 0 };
  try {
    broadcasts = await runStaleBroadcastAnalyses({ limit: 2, budgetMs: 25000 });
  } catch (err) {
    console.error("broadcast analyses:", err instanceof Error ? err.message : err);
  }
  try {
    await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.LEAD_ANALYSES]);
    const [leads, messages, analyses] = await Promise.all([listLeads(), listWaMessages(), listLeadAnalyses()]);
    const infos = Array.from(talkInfoByLead(leads, messages, analyses).values());
    const { stale } = buildTalkReport(infos, new Map(), new Date());
    const result = await runStaleAnalyses(leads, stale, messages, "cron", localDayKey(), {
      limit: 20,
      budgetMs: Math.max(5000, 45000 - (Date.now() - started)),
    });
    return Response.json({ ok: true, ...result, broadcasts, reminders });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
