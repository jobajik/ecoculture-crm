"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { localDayKey } from "@/lib/timezone";
import { commitAtomic, prefetchTables, SHEET_TABS, type WriteOp } from "@/lib/sheets";
import { saveSettings } from "@/lib/repo/settings";
import {
  appendFilePart,
  botChatWrite,
  broadcastUpdate,
  createBroadcast,
  emptyBotChat,
  findBroadcastRow,
  listBotChats,
  listRecipients,
  recipientUpdate,
  settingsMap,
} from "@/lib/repo/broadcasts";
import { loadAudience } from "@/lib/broadcastAudience";
import {
  BOT_MODES,
  BROADCAST_STATUSES,
  MAX_RECIPIENTS,
  OPT_OUT_LINE,
  broadcastTextRefusal,
  dailyLimitOf,
  greetingName,
  nextGapSeconds,
  personalize,
  sendTooSoon,
  sentOnDay,
  waPhone,
} from "@/lib/broadcast";
import { isChannelError } from "@/lib/wazzup";
import { WazzupError, listChannels, pickWhatsappChannel, sendWazzup, wazzupConfigured } from "@/lib/wazzupApi";
import { publicFileUrl } from "@/lib/waFileSign";
import { phoneKey } from "@/lib/leads";

/**
 * Рассылки WhatsApp через Wazzup — только админ и РОП (решение владельца):
 * сообщение уходит сразу сотням клиентов, и нажимать эту кнопку должны немногие.
 */
async function requireBroadcaster() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) throw new Error("Рассылки запускают администратор и РОП");
  return { email: session.user.email.toLowerCase() };
}

const SITE = () => (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");

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

async function channelOrThrow() {
  if (!wazzupConfigured()) throw new Error("Wazzup не подключён — владелец вводит ключ в wazzup-key.bat");
  const channel = pickWhatsappChannel(await listChannels());
  if (!channel) throw new Error("В Wazzup нет канала WhatsApp — подключите номер в кабинете Wazzup");
  if (channel.transport !== "whatsapp") throw new Error("Канал Wazzup — не обычный WhatsApp. Для WABA нужны шаблоны, их пока не поддерживаем");
  if (channel.state !== "active") throw new Error(`Канал WhatsApp в Wazzup не работает (${channel.state}) — проверьте в кабинете Wazzup`);
  return channel;
}

/** Одно сообщение рассылки: сначала файл, потом текст (вместе Wazzup не шлёт). */
async function deliver(channelId: string, phone: string, text: string, file: { id: string; name: string } | null, tag: string) {
  const ids: string[] = [];
  if (file) {
    ids.push(await sendWazzup({ channelId, phone, contentUri: publicFileUrl(SITE(), file.id, file.name), crmMessageId: `${tag}-f` }));
  }
  if (text) ids.push(await sendWazzup({ channelId, phone, text, crmMessageId: `${tag}-t` }));
  return ids;
}

async function sendTestActionInner(input: { text: string; fileId: string; fileName: string; phone: string; withOptOut: boolean }) {
  await requireBroadcaster();
  const phone = waPhone(input.phone);
  if (!phone) throw new Error("Впишите мобильный номер для проверки");
  const refusal = broadcastTextRefusal(input.text, !!input.fileId);
  if (refusal) throw new Error(refusal);
  const channel = await channelOrThrow();
  const text = personalize(input.text, "Тест", input.withOptOut);
  try {
    await deliver(channel.channelId, phone, text, input.fileId ? { id: input.fileId, name: input.fileName } : null, `test-${Date.now()}`);
  } catch (err) {
    if (err instanceof WazzupError) throw new Error(err.message);
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
  const raw = String(input.text || "").replace(/\r/g, "").trim();
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
  if (status === "sending") await channelOrThrow();
  const changes: Record<string, unknown> = { Status: status, Note: "" };
  if (status === "sending" && !found.broadcast.startedAt) changes.StartedAt = new Date().toISOString();
  if (status === "cancelled") changes.FinishedAt = new Date().toISOString();
  await commitAtomic([broadcastUpdate(found.rowNumber, changes)]);
  revalidatePath("/clients/broadcasts");
  return { ok: true };
}

/**
 * Отправить следующее сообщение рассылки. Зовёт открытая страница рассылки,
 * раз в 25–50 секунд (пауза случайная — так пишет человек, а не робот).
 * Сервер сам не торопится: слишком частый вызов (две открытые вкладки)
 * получает «подождите», а дневной предел общий на все рассылки.
 */
async function sendNextActionInner(broadcastId: string) {
  await requireBroadcaster();
  await prefetchTables([SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS]);
  const found = await findBroadcastRow(broadcastId, false);
  if (!found) throw new Error("Рассылка не найдена");
  const b = found.broadcast;
  const all = await listRecipients();
  const mine = all.filter((r) => r.broadcastId === broadcastId);
  const remaining = () => mine.filter((r) => r.status === "queued").length;
  const result = (extra: Record<string, unknown>) => ({ status: b.status, remaining: remaining(), ...extra });

  if (b.status !== BROADCAST_STATUSES.SENDING) return result({ waitSeconds: 0, note: "" });
  const now = new Date();
  if (sendTooSoon(b.lastSendAt, now)) return result({ waitSeconds: 20, note: "" });

  const limit = dailyLimitOf((await settingsMap()).BroadcastDailyLimit);
  const today = localDayKey(now);
  const sentToday = sentOnDay(all, today, (iso) => localDayKey(new Date(iso)));
  if (sentToday >= limit) {
    return result({ waitSeconds: 600, note: `На сегодня отправлено ${sentToday} из ${limit} — продолжим завтра` });
  }

  const next = mine.find((r) => r.status === "queued");
  if (!next) {
    await commitAtomic([broadcastUpdate(found.rowNumber, { Status: BROADCAST_STATUSES.DONE, FinishedAt: now.toISOString() })]);
    revalidatePath("/clients/broadcasts");
    return { status: BROADCAST_STATUSES.DONE, remaining: 0, waitSeconds: 0, note: "Рассылка закончена" };
  }

  const chats = await listBotChats();
  const chat = chats.find((c) => phoneKey(c.phone) === phoneKey(next.phone)) ?? null;
  const writes: WriteOp[] = [broadcastUpdate(found.rowNumber, { LastSendAt: now.toISOString() })];

  if (chat?.mode === BOT_MODES.OPT_OUT) {
    writes.push(recipientUpdate(next.rowNumber, { Status: "skipped", Error: "отписался" }));
    await commitAtomic(writes);
    return result({ waitSeconds: 1, note: "" });
  }

  let channelId = "";
  try {
    channelId = (await channelOrThrow()).channelId;
  } catch (err) {
    writes.push(broadcastUpdate(found.rowNumber, { Status: BROADCAST_STATUSES.PAUSED, Note: err instanceof Error ? err.message : "канал не работает" }));
    await commitAtomic(writes);
    revalidatePath("/clients/broadcasts");
    return { status: BROADCAST_STATUSES.PAUSED, remaining: remaining(), waitSeconds: 0, note: err instanceof Error ? err.message : "" };
  }

  const text = personalize(b.text, next.name, false);
  try {
    const ids = await deliver(channelId, next.phone, text, b.fileId ? { id: b.fileId, name: b.fileName } : null, `${broadcastId}-${next.rowNumber}`);
    writes.push(recipientUpdate(next.rowNumber, { Status: "sent", MessageID: ids[ids.length - 1], SentAt: now.toISOString(), Error: "" }));
    // Номера наших сообщений — в память чата: бот поймёт, что это не менеджер написал.
    const c = chat ?? emptyBotChat(next.phone);
    const updated = { ...c, ourIds: [...c.ourIds, ...ids].slice(-20), name: c.name || next.name };
    writes.push(botChatWrite(updated, chat?.rowNumber ?? null));
    await commitAtomic(writes);
    return result({ waitSeconds: nextGapSeconds(), note: "", sentTo: next.name || next.phone, remaining: remaining() - 1 });
  } catch (err) {
    const e = err instanceof WazzupError ? err : null;
    if (e && isChannelError(e.code, e.status)) {
      writes.push(broadcastUpdate(found.rowNumber, { Status: BROADCAST_STATUSES.PAUSED, Note: e.message }));
      await commitAtomic(writes);
      revalidatePath("/clients/broadcasts");
      return { status: BROADCAST_STATUSES.PAUSED, remaining: remaining(), waitSeconds: 0, note: e.message };
    }
    writes.push(recipientUpdate(next.rowNumber, { Status: "error", Error: (err instanceof Error ? err.message : "ошибка").slice(0, 200), SentAt: now.toISOString() }));
    await commitAtomic(writes);
    return result({ waitSeconds: nextGapSeconds(), note: "", remaining: remaining() - 1 });
  }
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
