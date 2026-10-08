"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { localDayKey } from "@/lib/timezone";
import { commitAtomic, SHEET_TABS } from "@/lib/sheets";
import { saveSettings } from "@/lib/repo/settings";
import {
  appendFilePart,
  botChatWrite,
  broadcastUpdate,
  createBroadcast,
  findBroadcastRow,
  listBotChats,
} from "@/lib/repo/broadcasts";
import { loadAudience } from "@/lib/broadcastAudience";
import {
  deliver,
  mimeOf,
  sendNextBroadcastMessage,
  withPrices,
} from "@/lib/broadcastSend";
import {
  BOT_MODES,
  BROADCAST_STATUSES,
  MAX_RECIPIENTS,
  OPT_OUT_LINE,
  broadcastTextRefusal,
  dailyLimitOf,
  greetingName,
  personalize,
  waPhone,
} from "@/lib/broadcast";
import { GreenError, type GreenConfig } from "@/lib/greenApi";
import { checkGreenChannel } from "@/lib/greenChannel";
import { phoneKey } from "@/lib/leads";
import { analyzeBroadcastNow } from "@/lib/broadcastAnalysisRunner";

/**
 * Рассылки WhatsApp через Green API — только админ и РОП (решение владельца):
 * сообщение уходит сразу сотням клиентов, и нажимать эту кнопку должны немногие.
 */
async function requireBroadcaster() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) throw new Error("Рассылки запускают администратор и РОП");
  return { email: session.user.email.toLowerCase() };
}


const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// --- Файл -------------------------------------------------------------------

async function uploadFilePartActionInner(input: {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  partOffset: number;
  data: string;
}) {
  const { email } = await requireBroadcaster();
  if (!ALLOWED_MIME.includes(input.mime)) throw new Error("Можно картинку (JPG, PNG) или PDF");
  if (!(input.size > 0) || input.size > MAX_FILE_BYTES) throw new Error("Файл больше 5 МБ — уменьшите");
  if (!/^[A-Za-z0-9+/=]+$/.test(input.data || "") || input.data.length > 800_000) throw new Error("Файл не прочитался — выберите заново");
  return appendFilePart({
    fileId: String(input.fileId || ""),
    createdByEmail: email,
    name: String(input.name || "file").slice(0, 120),
    mime: input.mime,
    size: Math.round(input.size),
    partOffset: Math.max(0, Math.floor(Number(input.partOffset) || 0)),
    data: input.data,
  });
}

// --- Канал ------------------------------------------------------------------

/** Green API подключён и номер в сети — иначе понятный отказ. */
async function channelOrThrow(): Promise<GreenConfig> {
  const c = await checkGreenChannel();
  if (c.action !== "ok" || !c.cfg) throw new Error(c.text);
  return c.cfg;
}

async function sendTestActionInner(input: { text: string; fileId: string; fileName: string; phone: string; withOptOut: boolean }) {
  await requireBroadcaster();
  const phone = waPhone(input.phone);
  if (!phone) throw new Error("Впишите мобильный номер для проверки");
  const refusal = broadcastTextRefusal(input.text, !!input.fileId);
  if (refusal) throw new Error(refusal);
  const cfg = await channelOrThrow();
  const text = personalize(await withPrices(input.text), "Тест", input.withOptOut);
  try {
    await deliver(cfg, phone, text, input.fileId ? { id: input.fileId, name: input.fileName, mime: mimeOf(input.fileName) } : null);
  } catch (err) {
    if (err instanceof GreenError) throw new Error(err.message);
    throw err;
  }
  return { ok: true };
}

// --- Рассылка ---------------------------------------------------------------

async function createBroadcastActionInner(input: {
  title: string;
  text: string;
  fileId: string;
  fileName: string;
  withOptOut: boolean;
  audience: string;
  refs: { kind: string; refId: string }[];
}) {
  const { email } = await requireBroadcaster();
  const refusal = broadcastTextRefusal(input.text, !!input.fileId);
  if (refusal) throw new Error(refusal);
  const wanted = new Set((input.refs || []).map((r) => `${r.kind}:${r.refId}`));
  if (wanted.size === 0) throw new Error("Выберите, кому отправить");
  if (wanted.size > MAX_RECIPIENTS) throw new Error(`Больше ${MAX_RECIPIENTS} получателей за раз нельзя — разбейте на несколько рассылок`);

  const audience = await loadAudience();
  const recipients = audience
    .filter((a) => wanted.has(`${a.kind}:${a.refId}`) && !a.excluded)
    .map((a) => ({
      phone: a.waPhone,
      name: greetingName(a.contactPerson, a.name),
      kind: a.kind,
      refId: a.refId,
      managerEmail: a.managerEmail,
    }));
  if (recipients.length === 0) throw new Error("Среди выбранных нет ни одного мобильного номера, которому можно писать");

  // Текст хранится уже с «ответьте СТОП»: так в отчёте видно ровно то, что ушло.
  const raw = (await withPrices(String(input.text || "").replace(/\r/g, ""))).trim();
  const text = input.withOptOut && !/стоп/i.test(raw) ? `${raw}\n\n${OPT_OUT_LINE}`.trim() : raw;
  const id = await createBroadcast({
    createdByEmail: email,
    title: String(input.title || "").trim().slice(0, 120) || `Рассылка ${localDayKey()}`,
    text,
    fileId: String(input.fileId || ""),
    fileName: String(input.fileName || ""),
    audience: String(input.audience || "").slice(0, 300),
    recipients,
  });
  revalidatePath("/clients/broadcasts");
  return { broadcastId: id, count: recipients.length };
}

async function setBroadcastStatusActionInner(broadcastId: string, status: "sending" | "paused" | "cancelled") {
  await requireBroadcaster();
  const found = await findBroadcastRow(broadcastId);
  if (!found) throw new Error("Рассылка не найдена");
  const cur = found.broadcast.status;
  if (cur === BROADCAST_STATUSES.DONE || cur === BROADCAST_STATUSES.CANCELLED) throw new Error("Рассылка уже закончена");
  // Продолжить можно и при разовом сбое Green API — страница сама проверит снова
  // через минуту. Не пускаем, только если без человека не исправится.
  if (status === "sending") {
    const c = await checkGreenChannel();
    if (c.action === "pause") throw new Error(c.text);
  }
  const changes: Record<string, unknown> = { Status: status, Note: "" };
  if (status === "sending" && !found.broadcast.startedAt) changes.StartedAt = new Date().toISOString();
  if (status === "cancelled") changes.FinishedAt = new Date().toISOString();
  await commitAtomic([broadcastUpdate(found.rowNumber, changes)]);
  revalidatePath("/clients/broadcasts");
  return { ok: true };
}

/** Следующее сообщение рассылки — правила и отправка в `broadcastSend.ts`. */
async function sendNextActionInner(broadcastId: string) {
  await requireBroadcaster();
  const r = await sendNextBroadcastMessage(broadcastId);
  if (r.changed) revalidatePath("/clients/broadcasts");
  return r;
}

// --- Бот --------------------------------------------------------------------

async function saveBotSettingsActionInner(input: {
  enabled: boolean;
  scope: string;
  hours: string;
  workFrom: number;
  workTo: number;
  instructions: string;
  dailyLimit: number;
}) {
  await requireBroadcaster();
  const hour = (n: number, def: number) => (Number.isInteger(Number(n)) && n >= 0 && n <= 24 ? String(n) : String(def));
  await saveSettings({
    BotEnabled: input.enabled ? "TRUE" : "FALSE",
    BotScope: input.scope === "all" ? "all" : "broadcast",
    BotHours: input.hours === "offhours" ? "offhours" : "always",
    BotWorkFrom: hour(Number(input.workFrom), 9),
    BotWorkTo: hour(Number(input.workTo), 19),
    BotInstructions: String(input.instructions || "").slice(0, 4000),
    BroadcastDailyLimit: String(dailyLimitOf(String(input.dailyLimit))),
  });
  revalidatePath("/clients/broadcasts/bot");
  return { ok: true };
}

/** Менеджер ответил сам — убрать чат из «передано менеджеру» (бот снова может отвечать). */
async function releaseHandoffActionInner(phone: string) {
  await requireBroadcaster();
  const chats = await listBotChats(true);
  const chat = chats.find((c) => phoneKey(c.phone) === phoneKey(phone));
  if (!chat) throw new Error("Чат не найден");
  if (chat.mode !== BOT_MODES.HANDOFF) return { ok: true };
  await commitAtomic([botChatWrite({ ...chat, mode: BOT_MODES.BOT, handoffReason: "", botReplies: 0 }, chat.rowNumber)]);
  revalidatePath("/clients/broadcasts/bot");
  return { ok: true };
}

// --- Разбор ответов ------------------------------------------------------------

/** Разобрать ответы на рассылку ИИ сейчас (кнопка на странице рассылки). */
async function analyzeBroadcastActionInner(broadcastId: string) {
  const { email } = await requireBroadcaster();
  await analyzeBroadcastNow(String(broadcastId || ""), email);
  revalidatePath(`/clients/broadcasts/${broadcastId}`);
  return { ok: true };
}

// Обёртки: отказ ВОЗВРАЩАЕТСЯ, а не бросается (грабли 1.13).
export async function uploadFilePartAction(...args: Parameters<typeof uploadFilePartActionInner>) {
  return guard(() => uploadFilePartActionInner(...args));
}
export async function sendTestAction(...args: Parameters<typeof sendTestActionInner>) {
  return guard(() => sendTestActionInner(...args));
}
export async function createBroadcastAction(...args: Parameters<typeof createBroadcastActionInner>) {
  return guard(() => createBroadcastActionInner(...args));
}
export async function setBroadcastStatusAction(...args: Parameters<typeof setBroadcastStatusActionInner>) {
  return guard(() => setBroadcastStatusActionInner(...args));
}
export async function sendNextAction(...args: Parameters<typeof sendNextActionInner>) {
  return guard(() => sendNextActionInner(...args));
}
export async function saveBotSettingsAction(...args: Parameters<typeof saveBotSettingsActionInner>) {
  return guard(() => saveBotSettingsActionInner(...args));
}
export async function releaseHandoffAction(...args: Parameters<typeof releaseHandoffActionInner>) {
  return guard(() => releaseHandoffActionInner(...args));
}
export async function analyzeBroadcastAction(...args: Parameters<typeof analyzeBroadcastActionInner>) {
  return guard(() => analyzeBroadcastActionInner(...args));
}
