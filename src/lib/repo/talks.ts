import { commitAtomic, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import { toIsoDateTime } from "../sheetDate";
import type { ChecklistMark, LeadAnalysis, TalkObjection, WaMessage } from "../types";

/**
 * Переписка WhatsApp (WaMessages) и разборы ИИ (LeadAnalyses).
 *
 * Чтения обёрнуты в try/catch: пока вкладок нет (`npm run setup-sheet`),
 * страницы показывают пустоту, а не падают.
 */

function toMessage(r: Record<string, string>): WaMessage {
  return {
    messageId: (r.MessageID || "").trim(),
    at: toIsoDateTime(r.At),
    chatId: r.ChatID || "",
    phone: (r.Phone || "").replace(/\D/g, ""),
    direction: r.Direction === "out" ? "out" : "in",
    type: r.Type || "text",
    text: r.Text || "",
    mediaUrl: r.MediaURL || "",
    senderName: r.SenderName || "",
    source: r.Source || "",
  };
}

export async function listWaMessages(): Promise<WaMessage[]> {
  try {
    const table = await readTable(SHEET_TABS.WA_MESSAGES);
    return table.rows
      .map((row) => toMessage(rowToRecord(SHEET_TABS.WA_MESSAGES, row)))
      .filter((m) => m.messageId && m.phone && m.at);
  } catch {
    return [];
  }
}

function messageRecord(m: WaMessage, nowIso: string): Record<string, unknown> {
  return {
    MessageID: m.messageId,
    At: m.at,
    ChatID: m.chatId,
    Phone: m.phone,
    Direction: m.direction,
    Type: m.type,
    Text: m.text,
    MediaURL: m.mediaUrl,
    SenderName: m.senderName,
    Source: m.source,
    CreatedAt: nowIso,
  };
}

/**
 * Дописать сообщения — одним запросом. Повторы НЕ проверяются чтением: вебхук
 * не читает таблицу (лимит Google общий на всю компанию, грабли 1.17), а
 * одинаковые номера сообщений склеиваются при чтении (`mergeMessages`).
 */
export async function appendWaMessages(messages: WaMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const now = new Date().toISOString();
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.WA_MESSAGES, records: messages.map((m) => messageRecord(m, now)) }]);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function numOrNull(raw: string): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toAnalysis(r: Record<string, string>): LeadAnalysis {
  const t = (r.Temperature || "").trim();
  return {
    analysisId: r.AnalysisID || "",
    leadId: (r.LeadID || "").trim(),
    createdAt: toIsoDateTime(r.CreatedAt),
    createdByEmail: (r.CreatedByEmail || "").trim().toLowerCase(),
    managerEmail: (r.ManagerEmail || "").trim().toLowerCase(),
    messagesFrom: toIsoDateTime(r.MessagesFrom),
    messagesTo: toIsoDateTime(r.MessagesTo),
    messageCount: Number(r.MessageCount) || 0,
    model: r.Model || "",
    summary: r.Summary || "",
    needs: r.Needs || "",
    agreed: r.Agreed || "",
    nextStep: r.NextStep || "",
    nextTouchDays: numOrNull(r.NextTouchDays),
    suggestedStage: (r.SuggestedStage || "").trim(),
    temperature: t === "hot" || t === "warm" || t === "cold" ? t : "",
    temperatureWhy: r.TemperatureWhy || "",
    score: numOrNull(r.Score),
    checklist: parseJson<ChecklistMark[]>(r.Checklist || "[]", []),
    objections: parseJson<TalkObjection[]>(r.Objections || "[]", []),
    lostReason: r.LostReason || "",
    advice: r.Advice || "",
    replyMinutes: numOrNull(r.ReplyMinutes),
  };
}

export async function listLeadAnalyses(): Promise<LeadAnalysis[]> {
  try {
    const table = await readTable(SHEET_TABS.LEAD_ANALYSES);
    return table.rows
      .map((row) => toAnalysis(rowToRecord(SHEET_TABS.LEAD_ANALYSES, row)))
      .filter((a) => a.analysisId && a.leadId);
  } catch {
    return [];
  }
}

/**
 * Разбор и сообщения, которых ещё не было в таблице (подтянутые из истории
 * чата, с расшифровками), — ОДНИМ атомарным запросом (грабли 1.16).
 */
export async function saveLeadAnalysis(
  analysis: Omit<LeadAnalysis, "analysisId">,
  newMessages: WaMessage[]
): Promise<string> {
  const id = generateId("TALK");
  const now = new Date().toISOString();
  await commitAtomic([
    ...(newMessages.length > 0
      ? [{ kind: "append" as const, tab: SHEET_TABS.WA_MESSAGES, records: newMessages.map((m) => messageRecord(m, now)) }]
      : []),
    {
      kind: "append",
      tab: SHEET_TABS.LEAD_ANALYSES,
      records: [
        {
          AnalysisID: id,
          LeadID: analysis.leadId,
          CreatedAt: analysis.createdAt,
          CreatedByEmail: analysis.createdByEmail,
          ManagerEmail: analysis.managerEmail,
          MessagesFrom: analysis.messagesFrom,
          MessagesTo: analysis.messagesTo,
          MessageCount: analysis.messageCount,
          Model: analysis.model,
          Summary: analysis.summary,
          Needs: analysis.needs,
          Agreed: analysis.agreed,
          NextStep: analysis.nextStep,
          NextTouchDays: analysis.nextTouchDays ?? "",
          SuggestedStage: analysis.suggestedStage,
          Temperature: analysis.temperature,
          TemperatureWhy: analysis.temperatureWhy,
          Score: analysis.score ?? "",
          Checklist: JSON.stringify(analysis.checklist),
          Objections: JSON.stringify(analysis.objections),
          LostReason: analysis.lostReason,
          Advice: analysis.advice,
          ReplyMinutes: analysis.replyMinutes ?? "",
        },
      ],
    },
  ]);
  return id;
}
