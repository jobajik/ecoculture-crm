import { SHEET_TABS } from "@/lib/constants";
import { prefetchTables } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { listLeadTouches, listLeads } from "@/lib/repo/leads";
import { listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { buildDecisionBoard, decisionScope } from "@/lib/leadDecisions";
import { latestByLead } from "@/lib/talkAnalysis";
import { runStaleAnalyses } from "@/lib/talkRunner";
import { openAiConfigured } from "@/lib/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Разобрать переписки лидов с рекламы для «Решений ИИ» без браузера (15.10.2026):
 * `scripts/leads-decide-run.ts` зовёт по кругу, пока `left` не станет 0. Сначала ни разу
 * не разобранные, потом изменившиеся. Только с секретом CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  if (!openAiConfigured()) return Response.json({ ok: false, error: "openai not configured" }, { status: 500 });
  try {
    await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.LEAD_ANALYSES, SHEET_TABS.LEAD_TOUCHES]);
    const [leads, messages, analyses, touches] = await Promise.all([
      listLeads(),
      listWaMessages({ lines: "all" }),
      listLeadAnalyses(),
      listLeadTouches(),
    ]);
    // Лиды с рекламы и все лиды с перепиской (номера менеджеров, 16.10.2026).
    const ads = decisionScope({ role: "admin", email: "", leads, messages, analyses });
    const board = buildDecisionBoard({
      leads: ads,
      messages,
      analyses,
      touches,
      today: localDayKey(),
      toDay: (iso) => (iso ? localDayKey(new Date(iso)) : ""),
    });
    const analysed = new Set(latestByLead(analyses).keys());
    const queue = [...board.toAnalyze.filter((id) => !analysed.has(id)), ...board.toAnalyze.filter((id) => analysed.has(id))];
    const result = await runStaleAnalyses(ads, queue.map((leadId) => ({ leadId })), messages, "cron", localDayKey(), {
      // Новый разбор — пока прошло меньше 25 с (один идёт до 25 с, функция живёт минуту): при 42 с проход обрывался 504.
      limit: 8,
      budgetMs: 25000,
    });
    const groups = Object.fromEntries(Object.entries(board.groups).map(([k, v]) => [k, v.length]));
    return Response.json({ ok: true, ...result, queue: queue.length, groups });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
