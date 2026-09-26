import { fetchChatHistory, downloadMedia, greenConfig } from "./greenApi";
import { chatJson, openAiConfigured, transcribeAudio } from "./openai";
import {
  ANALYSIS_SCHEMA,
  MIN_MESSAGES_FOR_ANALYSIS,
  buildPrompt,
  parseAnalysis,
  scoreOf,
} from "./talkAnalysis";
import { mergeMessages, messagesForPhone, replyStats, transcriptForAi } from "./whatsapp";
import { saveLeadAnalysis } from "./repo/talks";
import type { Lead, LeadAnalysis, WaMessage } from "./types";

/** Голосовых за один разбор расшифровываем не больше — иначе не уложимся в минуту. */
const MAX_VOICE_PER_RUN = 6;

export interface TalkRunResult {
  analysis: Omit<LeadAnalysis, "analysisId">;
  analysisId: string;
  pulled: number;
}

/**
 * Разобрать переписку с лидом: взять сохранённые сообщения, дотянуть историю
 * чата из Green API (там есть и то, что было до подключения), расшифровать
 * голосовые, отдать ИИ и записать разбор вместе с новыми сообщениями — одним
 * запросом (грабли 1.16). Никаких изменений в самом лиде: стадию и касание
 * меняет менеджер.
 */
export async function runTalkAnalysis(
  lead: Lead,
  allMessages: WaMessage[],
  byEmail: string,
  today: string
): Promise<TalkRunResult> {
  if (!openAiConfigured()) throw new Error("ИИ не подключён: владелец вводит ключ OpenAI в whatsapp-key.bat.");
  if (!lead.phone) throw new Error("У лида нет телефона — не по чему найти переписку.");

  const stored = messagesForPhone(allMessages, lead.phone);
  const storedIds = new Set(stored.map((m) => m.messageId));
  let pulled: WaMessage[] = [];
  const cfg = greenConfig();
  if (cfg) {
    try {
      pulled = (await fetchChatHistory(cfg, lead.phone, 150)).filter((m) => !storedIds.has(m.messageId));
    } catch (err) {
      // История не пришла — разбираем то, что уже есть; причину видно в журнале сервера.
      console.error("whatsapp history:", err instanceof Error ? err.message : err);
    }
  }
  let merged = mergeMessages([...stored, ...pulled]);
  if (merged.length < MIN_MESSAGES_FOR_ANALYSIS) {
    throw new Error(
      cfg
        ? "С этим номером в WhatsApp пока почти нет переписки — разбирать нечего."
        : "WhatsApp ещё не подключён, и сохранённой переписки с этим номером нет."
    );
  }

  // Голосовые без расшифровки — самые свежие первыми. Расшифрованная копия
  // записывается новой строкой с тем же номером: при чтении склеится (длиннее — она).
  const toWrite: WaMessage[] = [...pulled];
  const voices = merged.filter((m) => m.type === "voice" && !m.text && m.mediaUrl).reverse().slice(0, MAX_VOICE_PER_RUN);
  for (const v of voices) {
    try {
      const file = await downloadMedia(v.mediaUrl);
      if (!file) continue;
      const text = await transcribeAudio(file.data, file.mime);
      if (!text) continue;
      const done = { ...v, text };
      const i = toWrite.findIndex((m) => m.messageId === v.messageId);
      if (i >= 0) toWrite[i] = done;
      else toWrite.push(done);
    } catch (err) {
      console.error("whatsapp voice:", err instanceof Error ? err.message : err);
    }
  }
  merged = mergeMessages([...merged, ...toWrite]);

  const { text, used } = transcriptForAi(merged);
  const prompt = buildPrompt({ lead, transcript: text, today });
  const { data, model } = await chatJson(prompt.system, prompt.user, "lead_talk_analysis", ANALYSIS_SCHEMA);
  const parsed = parseAnalysis(data);
  const stats = replyStats(merged);

  const analysis: Omit<LeadAnalysis, "analysisId"> = {
    leadId: lead.leadId,
    createdAt: new Date().toISOString(),
    createdByEmail: byEmail,
    managerEmail: lead.managerEmail,
    messagesFrom: used[0]?.at ?? "",
    messagesTo: merged[merged.length - 1]?.at ?? "",
    messageCount: merged.length,
    model,
    ...parsed,
    score: scoreOf(parsed.checklist),
    replyMinutes: stats.replyMinutes,
  };
  const analysisId = await saveLeadAnalysis(analysis, toWrite);
  return { analysis, analysisId, pulled: pulled.length };
}

/**
 * Разобрать лиды, у которых после прошлого разбора появились сообщения, — для
 * кнопки РОПа и ночного запуска. Идём по очереди и следим за временем: функция
 * на Vercel живёт минуту, а один разбор занимает 5–20 секунд. Что не успели —
 * останется «ждёт разбора» до следующего раза.
 */
export async function runStaleAnalyses(
  leads: Lead[],
  stale: { leadId: string }[],
  allMessages: WaMessage[],
  byEmail: string,
  today: string,
  options: { limit: number; budgetMs: number }
): Promise<{ done: number; failed: string[]; left: number }> {
  const started = Date.now();
  const byId = new Map(leads.map((l) => [l.leadId, l]));
  let done = 0;
  const failed: string[] = [];
  let i = 0;
  for (; i < stale.length && i < options.limit; i++) {
    if (Date.now() - started > options.budgetMs) break;
    const lead = byId.get(stale[i].leadId);
    if (!lead) continue;
    try {
      await runTalkAnalysis(lead, allMessages, byEmail, today);
      done++;
    } catch (err) {
      failed.push(`${lead.name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }
  return { done, failed, left: stale.length - i };
}
