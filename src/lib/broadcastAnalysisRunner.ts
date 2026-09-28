import { prefetchTables, SHEET_TABS } from "./sheets";
import { chatJson, openAiConfigured } from "./openai";
import { deliveryByMessage, recipientViews, type RecipientView } from "./broadcast";
import {
  AUTO_ANALYSIS_DAYS,
  BROADCAST_ANALYSIS_SCHEMA,
  BROADCAST_ANALYSIS_SYSTEM,
  analysisIsStale,
  broadcastTranscript,
  parseBroadcastAnalysis,
  type BroadcastAnalysis,
} from "./broadcastAnalysis";
import {
  appendBroadcastAnalysis,
  latestBroadcastAnalyses,
  listBroadcasts,
  listRecipients,
  listWaStatuses,
  type Broadcast,
} from "./repo/broadcasts";
import { listWaMessages } from "./repo/talks";
import { mergeMessages } from "./whatsapp";
import type { WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Разбор ответов на рассылку: собрать переписку, отдать модели, записать итог
// во вкладку BroadcastAnalyses. Зовут кнопка на странице рассылки и вечернее
// расписание (`/api/leads/talks`). Правила — `broadcastAnalysis.ts`.
// ---------------------------------------------------------------------------

async function load(): Promise<{ broadcasts: Broadcast[]; views: RecipientView[]; messages: WaMessage[] }> {
  await prefetchTables([
    SHEET_TABS.BROADCASTS,
    SHEET_TABS.BROADCAST_RECIPIENTS,
    SHEET_TABS.WA_STATUSES,
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.BROADCAST_ANALYSES,
  ]);
  const [broadcasts, recipients, statuses, raw] = await Promise.all([
    listBroadcasts(),
    listRecipients(),
    listWaStatuses(),
    listWaMessages(),
  ]);
  const messages = mergeMessages(raw);
  return { broadcasts, views: recipientViews(recipients, deliveryByMessage(statuses), messages), messages };
}

async function analyze(b: Broadcast, views: RecipientView[], messages: WaMessage[], by: string): Promise<BroadcastAnalysis> {
  if (!openAiConfigured()) throw new Error("ИИ (OpenAI) не подключён — разбор недоступен");
  const replied = views.filter((v) => v.broadcastId === b.broadcastId && v.state === "replied");
  if (replied.length === 0) throw new Error("На эту рассылку пока никто не ответил — разбирать нечего");
  const { text, phones } = broadcastTranscript(b.text, replied, messages);
  if (phones.length === 0) throw new Error("Ответы есть, но переписка не найдена — попробуйте позже");
  const { data, model } = await chatJson(BROADCAST_ANALYSIS_SYSTEM, text, "broadcast_analysis", BROADCAST_ANALYSIS_SCHEMA);
  const analysis = parseBroadcastAnalysis(data, phones);
  await appendBroadcastAnalysis({ broadcastId: b.broadcastId, createdBy: by, model, replies: replied.length, analysis });
  return analysis;
}

/** Разобрать одну рассылку сейчас (кнопка на странице). */
export async function analyzeBroadcastNow(broadcastId: string, by: string): Promise<BroadcastAnalysis> {
  const { broadcasts, views, messages } = await load();
  const b = broadcasts.find((x) => x.broadcastId === broadcastId);
  if (!b) throw new Error("Рассылка не найдена");
  return analyze(b, views, messages, by);
}

/**
 * Вечерний проход: свежие рассылки (не старше AUTO_ANALYSIS_DAYS), на которые
 * после прошлого разбора пришли новые ответы. Не больше `limit` за раз и не
 * дольше `budgetMs`. Сбой одной рассылки не мешает остальным.
 */
export async function runStaleBroadcastAnalyses(options: { limit: number; budgetMs: number }): Promise<{ analyzed: number; errors: number }> {
  const started = Date.now();
  if (!openAiConfigured()) return { analyzed: 0, errors: 0 };
  const [{ broadcasts, views, messages }, done] = await Promise.all([load(), latestBroadcastAnalyses()]);
  const cutoff = new Date(Date.now() - AUTO_ANALYSIS_DAYS * 24 * 3600 * 1000).toISOString();
  const candidates = broadcasts.filter((b) => {
    if (!b.startedAt || b.startedAt < cutoff) return false;
    const replied = views.filter((v) => v.broadcastId === b.broadcastId && v.state === "replied").length;
    return analysisIsStale(replied, done.get(b.broadcastId)?.replies ?? null);
  });
  let analyzed = 0;
  let errors = 0;
  for (const b of candidates.slice(0, options.limit)) {
    if (Date.now() - started > options.budgetMs) break;
    try {
      await analyze(b, views, messages, "cron");
      analyzed++;
    } catch (err) {
      errors++;
      console.error("broadcast analysis:", err instanceof Error ? err.message : err);
    }
  }
  return { analyzed, errors };
}
