import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { generateId } from "../id";
import { toIsoDateTime } from "../sheetDate";
import { phoneKey } from "../leads";
import type { BotChat, RecipientRow, WaStatusRow } from "../broadcast";
import { parseBroadcastAnalysis, type BroadcastAnalysis } from "../broadcastAnalysis";

/**
 * Рассылки, их получатели, статусы доставки, файлы и состояние чатов бота.
 * Чтения обёрнуты в try/catch: пока вкладок нет (`npm run setup-sheet`),
 * страницы показывают пустоту, а не падают.
 */

async function rows(tab: string, fresh = false) {
  try {
    const t = await readTable(tab, { fresh });
    return t.rows.map((row, i) => ({ record: rowToRecord(tab, row), rowNumber: t.rowNumbers[i] }));
  } catch {
    return [];
  }
}

// --- Рассылки ---------------------------------------------------------------

export interface Broadcast {
  broadcastId: string;
  createdAt: string;
  createdByEmail: string;
  title: string;
  text: string;
  fileId: string;
  fileName: string;
  status: string;
  audience: string;
  startedAt: string;
  finishedAt: string;
  lastSendAt: string;
  updatedAt: string;
  note: string;
}

function toBroadcast(r: Record<string, string>): Broadcast {
  return {
    broadcastId: r.BroadcastID || "",
    createdAt: toIsoDateTime(r.CreatedAt),
    createdByEmail: r.CreatedByEmail || "",
    title: r.Title || "",
    text: r.Text || "",
    fileId: r.FileID || "",
    fileName: r.FileName || "",
    status: r.Status || "draft",
    audience: r.Audience || "",
    startedAt: toIsoDateTime(r.StartedAt),
    finishedAt: toIsoDateTime(r.FinishedAt),
    lastSendAt: r.LastSendAt || "",
    updatedAt: r.UpdatedAt || "",
    note: r.Note || "",
  };
}

export async function listBroadcasts(fresh = false): Promise<Broadcast[]> {
  return (await rows(SHEET_TABS.BROADCASTS, fresh))
    .map((r) => toBroadcast(r.record))
    .filter((b) => b.broadcastId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function findBroadcastRow(broadcastId: string, fresh = true) {
  const found = (await rows(SHEET_TABS.BROADCASTS, fresh)).find((r) => r.record.BroadcastID === broadcastId);
  return found ? { broadcast: toBroadcast(found.record), rowNumber: found.rowNumber } : null;
}

function toRecipient(r: Record<string, string>): RecipientRow {
  return {
    broadcastId: r.BroadcastID || "",
    phone: (r.Phone || "").replace(/\D/g, ""),
    name: r.Name || "",
    kind: r.Kind || "",
    refId: r.RefID || "",
    managerEmail: r.ManagerEmail || "",
    status: r.Status || "queued",
    messageId: r.MessageID || "",
    sentAt: r.SentAt || "",
    error: r.Error || "",
  };
}

export async function listRecipients(fresh = false): Promise<(RecipientRow & { rowNumber: number })[]> {
  return (await rows(SHEET_TABS.BROADCAST_RECIPIENTS, fresh))
    .map((r) => ({ ...toRecipient(r.record), rowNumber: r.rowNumber }))
    .filter((r) => r.broadcastId && r.phone);
}

/** Новая рассылка и её получатели — одним запросом (грабли 1.16). */
export async function createBroadcast(input: {
  createdByEmail: string;
  title: string;
  text: string;
  fileId: string;
  fileName: string;
  audience: string;
  recipients: { phone: string; name: string; kind: string; refId: string; managerEmail: string }[];
}): Promise<string> {
  const id = generateId("BC");
  const now = new Date().toISOString();
  await commitAtomic([
    {
      kind: "append",
      tab: SHEET_TABS.BROADCASTS,
      records: [
        {
          BroadcastID: id,
          CreatedAt: now,
          CreatedByEmail: input.createdByEmail,
          Title: input.title,
          Text: input.text,
          FileID: input.fileId,
          FileName: input.fileName,
          Status: "draft",
          Audience: input.audience,
          UpdatedAt: now,
        },
      ],
    },
    {
      kind: "append",
      tab: SHEET_TABS.BROADCAST_RECIPIENTS,
      records: input.recipients.map((r) => ({
        BroadcastID: id,
        Phone: r.phone,
        Name: r.name,
        Kind: r.kind,
        RefID: r.refId,
        ManagerEmail: r.managerEmail,
        Status: "queued",
        UpdatedAt: now,
      })),
    },
  ]);
  return id;
}

export function broadcastUpdate(rowNumber: number, changes: Record<string, unknown>): WriteOp {
  return { kind: "update", tab: SHEET_TABS.BROADCASTS, rowNumber, changes: { ...changes, UpdatedAt: new Date().toISOString() } };
}

export function recipientUpdate(rowNumber: number, changes: Record<string, unknown>): WriteOp {
  return {
    kind: "update",
    tab: SHEET_TABS.BROADCAST_RECIPIENTS,
    rowNumber,
    changes: { ...changes, UpdatedAt: new Date().toISOString() },
  };
}

// --- Статусы доставки ---------------------------------------------------------

export async function listWaStatuses(): Promise<WaStatusRow[]> {
  return (await rows(SHEET_TABS.WA_STATUSES)).map((r) => ({
    messageId: r.record.MessageID || "",
    at: r.record.At || "",
    status: r.record.Status || "",
    error: r.record.Error || "",
  }));
}

/** Дописать статусы — без чтения (вебхук, грабли 1.17). */
export async function appendWaStatuses(list: WaStatusRow[]): Promise<void> {
  if (list.length === 0) return;
  const now = new Date().toISOString();
  await commitAtomic([
    {
      kind: "append",
      tab: SHEET_TABS.WA_STATUSES,
      records: list.map((s) => ({ MessageID: s.messageId, At: s.at, Status: s.status, Error: s.error, CreatedAt: now })),
    },
  ]);
}

// --- Файлы ------------------------------------------------------------------

/** В ячейке Google не больше 50 000 знаков — режем с запасом. */
const CELL_CHARS = 45000;

export interface WaFileMeta {
  fileId: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * Часть файла (base64) — дописывается строками по ячейке. Первая часть
 * заводит номер файла; следующие части приходят с ним.
 */
export async function appendFilePart(input: {
  fileId: string;
  createdByEmail: string;
  name: string;
  mime: string;
  size: number;
  partOffset: number;
  data: string;
}): Promise<{ fileId: string; nextOffset: number }> {
  const fileId = input.fileId || generateId("F");
  const now = new Date().toISOString();
  const records: Record<string, unknown>[] = [];
  let part = input.partOffset;
  for (let i = 0; i < input.data.length; i += CELL_CHARS) {
    records.push({
      FileID: fileId,
      CreatedAt: now,
      CreatedByEmail: input.createdByEmail,
      Name: input.name,
      Mime: input.mime,
      Size: input.size,
      Part: part++,
      Data: input.data.slice(i, i + CELL_CHARS),
    });
  }
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.WA_FILES, records }]);
  return { fileId, nextOffset: part };
}

/** Файл целиком: имя, тип и содержимое. Нет или не собрался — null. */
export async function readWaFile(fileId: string): Promise<(WaFileMeta & { data: Buffer }) | null> {
  const parts = (await rows(SHEET_TABS.WA_FILES))
    .map((r) => r.record)
    .filter((r) => r.FileID === fileId)
    .sort((a, b) => Number(a.Part) - Number(b.Part));
  if (parts.length === 0) return null;
  const base64 = parts.map((p) => p.Data || "").join("");
  const data = Buffer.from(base64, "base64");
  const size = Number(parts[0].Size) || 0;
  if (size && data.length !== size) return null;
  return { fileId, name: parts[0].Name || "file", mime: parts[0].Mime || "application/octet-stream", size: data.length, data };
}

// --- Чаты бота ---------------------------------------------------------------

function toBotChat(r: Record<string, string>): BotChat {
  let context: BotChat["context"] = [];
  try {
    const parsed = JSON.parse(r.Context || "[]");
    if (Array.isArray(parsed)) context = parsed.filter((x) => x && typeof x.text === "string");
  } catch {
    context = [];
  }
  return {
    phone: (r.Phone || "").replace(/\D/g, ""),
    updatedAt: r.UpdatedAt || "",
    mode: r.Mode || "",
    humanAt: r.HumanAt || "",
    handoffAt: r.HandoffAt || "",
    handoffReason: r.HandoffReason || "",
    lastInMessageId: r.LastInMessageID || "",
    ourIds: (r.OurIDs || "").split(/[,\s]+/).filter(Boolean),
    context,
    name: r.Name || "",
    botReplies: Number(r.BotReplies) || 0,
  };
}

export async function listBotChats(fresh = false): Promise<(BotChat & { rowNumber: number })[]> {
  return (await rows(SHEET_TABS.BOT_CHATS, fresh))
    .map((r) => ({ ...toBotChat(r.record), rowNumber: r.rowNumber }))
    .filter((c) => c.phone);
}

/** Номера, которые отписались (ключ `phoneKey`). */
export async function optedOutKeys(fresh = false): Promise<Set<string>> {
  return new Set((await listBotChats(fresh)).filter((c) => c.mode === "optout").map((c) => phoneKey(c.phone)));
}

export function botChatRecord(chat: BotChat): Record<string, unknown> {
  return {
    Phone: chat.phone,
    UpdatedAt: new Date().toISOString(),
    Mode: chat.mode,
    HumanAt: chat.humanAt,
    HandoffAt: chat.handoffAt,
    HandoffReason: chat.handoffReason,
    LastInMessageID: chat.lastInMessageId,
    OurIDs: chat.ourIds.slice(-20).join(","),
    Context: JSON.stringify(chat.context),
    Name: chat.name,
    BotReplies: chat.botReplies,
  };
}

/** Записать чат бота: есть строка — правка, нет — новая. */
export function botChatWrite(chat: BotChat, rowNumber: number | null): WriteOp {
  return rowNumber
    ? { kind: "update", tab: SHEET_TABS.BOT_CHATS, rowNumber, changes: botChatRecord(chat) }
    : { kind: "append", tab: SHEET_TABS.BOT_CHATS, records: [botChatRecord(chat)] };
}

export function emptyBotChat(phone: string): BotChat {
  return {
    phone,
    updatedAt: "",
    mode: "bot",
    humanAt: "",
    handoffAt: "",
    handoffReason: "",
    lastInMessageId: "",
    ourIds: [],
    context: [],
    name: "",
    botReplies: 0,
  };
}

// --- Настройки ---------------------------------------------------------------

/** Все пары ключ-значение вкладки Settings. */
export async function settingsMap(fresh = false): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const r of await rows(SHEET_TABS.SETTINGS, fresh)) {
    const key = (r.record.Key || "").trim();
    if (key) map[key] = r.record.Value ?? "";
  }
  return map;
}

// --- Разбор ответов (ИИ) ----------------------------------------------------

export interface StoredBroadcastAnalysis {
  broadcastId: string;
  createdAt: string;
  createdBy: string;
  model: string;
  /** Сколько человек ответило на момент разбора — чтобы видеть, что он устарел. */
  replies: number;
  analysis: BroadcastAnalysis;
}

/** Последний разбор по каждой рассылке. */
export async function latestBroadcastAnalyses(): Promise<Map<string, StoredBroadcastAnalysis>> {
  const out = new Map<string, StoredBroadcastAnalysis>();
  for (const { record: r } of await rows(SHEET_TABS.BROADCAST_ANALYSES)) {
    if (!r.BroadcastID) continue;
    let data: unknown = null;
    try {
      data = JSON.parse(r.Data || "null");
    } catch {
      continue;
    }
    const createdAt = toIsoDateTime(r.CreatedAt) || r.CreatedAt || "";
    const prev = out.get(r.BroadcastID);
    if (prev && prev.createdAt >= createdAt) continue;
    const people = (data as { people?: { phone: string }[] } | null)?.people ?? [];
    out.set(r.BroadcastID, {
      broadcastId: r.BroadcastID,
      createdAt,
      createdBy: r.CreatedBy || "",
      model: r.Model || "",
      replies: Number(r.Replies) || 0,
      // Уже проверенное при записи — повторная проверка лишь отсекает порчу руками.
      analysis: parseBroadcastAnalysis(data, people.map((p) => String(p.phone || ""))),
    });
  }
  return out;
}

export async function appendBroadcastAnalysis(input: {
  broadcastId: string;
  createdBy: string;
  model: string;
  replies: number;
  analysis: BroadcastAnalysis;
}): Promise<void> {
  await commitAtomic([
    {
      kind: "append",
      tab: SHEET_TABS.BROADCAST_ANALYSES,
      records: [
        {
          BroadcastID: input.broadcastId,
          CreatedAt: new Date().toISOString(),
          CreatedBy: input.createdBy,
          Model: input.model,
          Replies: input.replies,
          Data: JSON.stringify(input.analysis).slice(0, 45000),
        },
      ],
    },
  ]);
}
