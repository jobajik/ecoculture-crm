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
  effectiveDailyLimit,
  greetingName,
  nextGapSeconds,
  pacingWait,
  personalize,
  pickNextRecipient,
  sendTooSoon,
  waPhone,
} from "@/lib/broadcast";
import { listWaMessages } from "@/lib/repo/talks";
import { GreenError, sendFileByUrl, sendText, type GreenConfig } from "@/lib/greenApi";
import { checkGreenChannel } from "@/lib/greenChannel";
import { MAX_CAPTION, greenFailureKind, greenFileName } from "@/lib/greenOut";
import { publicFileUrl, safeFileName } from "@/lib/waFileSign";
import { ROTATION_FILE, isSpecialFile } from "@/lib/botPhotos";
import { loadPhotoContext, rotationPhoto } from "@/lib/botPhotoSend";
import { catalogFiles } from "@/lib/catalogFiles";
import { phoneKey } from "@/lib/leads";
import { analyzeBroadcastNow } from "@/lib/broadcastAnalysisRunner";
import { getCurrentPrices } from "@/lib/repo/prices";
import { priceMapForClient } from "@/lib/priceList";
import { fillPrices, priceTagFlowers, priceTagsRefusal } from "@/lib/broadcastPrices";

/**
 * Метки {цены хризантема} → действующий прайс. Подставляется ОДИН раз — при
 * создании рассылки (и в проверочном сообщении): всем получателям уходит одна и
 * та же цена, а в отчёте хранится ровно то, что ушло. Прайс читается, только если
 * метка в тексте есть.
 */
async function withPrices(text: string): Promise<string> {
  if (priceTagFlowers(text).length === 0) return text;
  const prices = priceMapForClient(await getCurrentPrices(localDayKey()));
  const refusal = priceTagsRefusal(text, prices);
  if (refusal) throw new Error(refusal);
  const filled = fillPrices(text, prices);
  const tooLong = broadcastTextRefusal(filled, true);
  if (tooLong) throw new Error(`${tooLong} (вместе с ценами)`);
  return filled;
}

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

/** Green API подключён и номер в сети — иначе понятный отказ. */
async function channelOrThrow(): Promise<GreenConfig> {
  const c = await checkGreenChannel();
  if (c.action !== "ok" || !c.cfg) throw new Error(c.text);
  return c.cfg;
}

/**
 * Одно сообщение рассылки. С файлом — файл с подписью-текстом одним сообщением;
 * если текст длиннее подписи WhatsApp (1024 знака) — файл, потом текст.
 */
async function deliver(cfg: GreenConfig, phone: string, text: string, file: { id: string; name: string; mime: string } | null) {
  const ids: string[] = [];
  // Фото из ротации — каждому своё (если текста нет — подпись к фото с ценами); каталог — страница на цветок.
  if (file && isSpecialFile(file.id)) {
    const files: { url: string; name: string }[] = [];
    let caption = text;
    if (file.id === ROTATION_FILE) {
      const ctx = await loadPhotoContext();
      const r = rotationPhoto(ctx, { question: "Поставить вам на завтра?", caption: text || undefined });
      if (r) {
        files.push({ url: r.url, name: greenFileName(safeFileName(r.name), "image/jpeg") });
        caption = r.caption;
        await commitAtomic([r.after]).catch(() => undefined);
      }
    } else {
      for (const c of await catalogFiles()) files.push({ url: c.url, name: c.name });
    }
    const inCaption = caption.length <= MAX_CAPTION;
    for (let i = 0; i < files.length; i++) {
      const last = i === files.length - 1;
      ids.push(await sendFileByUrl(cfg, phone, files[i].url, files[i].name, last && inCaption ? caption : ""));
    }
    if (caption && (files.length === 0 || !inCaption)) ids.push(await sendText(cfg, phone, caption));
    return ids;
  }
  if (file) {
    const url = publicFileUrl(SITE(), file.id, file.name);
    const name = greenFileName(safeFileName(file.name), file.mime);
    const inCaption = text.length <= MAX_CAPTION;
    ids.push(await sendFileByUrl(cfg, phone, url, name, inCaption ? text : ""));
    if (!inCaption && text) ids.push(await sendText(cfg, phone, text));
    return ids;
  }
  if (text) ids.push(await sendText(cfg, phone, text));
  return ids;
}

/** Тип файла по имени — для расширения, если в имени его нет. */
function mimeOf(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
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

/**
 * Отправить следующее сообщение рассылки. Зовёт открытая страница рассылки,
 * раз в 1–2,5 минуты (пауза случайная — так пишет человек, а не робот), после каждых
 * 10 — перерыв, только 10:00–19:00, не больше 15 в час, сначала «тёплым» (04.10.2026).
 * Сервер сам не торопится: слишком частый вызов (две открытые вкладки)
 * получает «подождите», а дневной предел общий на все рассылки.
 */
async function sendNextActionInner(broadcastId: string) {
  await requireBroadcaster();
  await prefetchTables([SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS, SHEET_TABS.WA_MESSAGES]);
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

  const settings = await settingsMap();
  const today = localDayKey(now);
  const limit = effectiveDailyLimit(settings.BroadcastDailyLimit, settings.BroadcastWarmupFrom, today);
  const sentRows = all.filter((r) => r.status === "sent" && r.sentAt && localDayKey(new Date(r.sentAt)) === today);
  const sentToday = sentRows.length;

  const queued = mine.filter((r) => r.status === "queued");
  if (queued.length === 0) {
    await commitAtomic([broadcastUpdate(found.rowNumber, { Status: BROADCAST_STATUSES.DONE, FinishedAt: now.toISOString() })]);
    revalidatePath("/clients/broadcasts");
    return { status: BROADCAST_STATUSES.DONE, remaining: 0, waitSeconds: 0, note: "Рассылка закончена" };
  }
  if (sentToday >= limit) {
    return result({ waitSeconds: 1800, note: `На сегодня отправлено ${sentToday} из ${limit} — продолжим завтра` });
  }
  // Осторожно: только днём, не больше 15 в час, перерыв после каждых 10 — по ВСЕМ рассылкам сразу.
  const wait = pacingWait({ now, minutes: now.getHours() * 60 + now.getMinutes(), sentTimes: sentRows.map((r) => Date.parse(r.sentAt)) });
  if (wait) return result(wait);

  // Сначала тем, кто уже писал нам; «холодным» — не больше 10 в день.
  const warm = new Set((await listWaMessages()).filter((m) => m.direction === "in").map((m) => phoneKey(m.phone)));
  const coldSentToday = sentRows.filter((r) => !warm.has(phoneKey(r.phone))).length;
  const pick = pickNextRecipient(queued, warm, coldSentToday);
  if (!pick.next) return result({ waitSeconds: 1800, note: pick.note });
  const next = pick.next;

  const chats = await listBotChats();
  const chat = chats.find((c) => phoneKey(c.phone) === phoneKey(next.phone)) ?? null;
  const writes: WriteOp[] = [broadcastUpdate(found.rowNumber, { LastSendAt: now.toISOString() })];

  if (chat?.mode === BOT_MODES.OPT_OUT) {
    writes.push(recipientUpdate(next.rowNumber, { Status: "skipped", Error: "отписался" }));
    await commitAtomic(writes);
    return result({ waitSeconds: 1, note: "" });
  }

  const channel = await checkGreenChannel();
  if (channel.action === "retry") {
    // Разовый сбой: рассылку НЕ останавливаем, этого же получателя — через минуту.
    await commitAtomic(writes);
    return result({ waitSeconds: 60, note: channel.text });
  }
  if (channel.action === "pause" || !channel.cfg) {
    writes.push(broadcastUpdate(found.rowNumber, { Status: BROADCAST_STATUSES.PAUSED, Note: channel.text }));
    await commitAtomic(writes);
    revalidatePath("/clients/broadcasts");
    return { status: BROADCAST_STATUSES.PAUSED, remaining: remaining(), waitSeconds: 0, note: channel.text };
  }
  const cfg = channel.cfg;

  const text = personalize(b.text, next.name, false);
  try {
    const ids = await deliver(cfg, next.phone, text, b.fileId ? { id: b.fileId, name: b.fileName, mime: mimeOf(b.fileName) } : null);
    writes.push(recipientUpdate(next.rowNumber, { Status: "sent", MessageID: ids[ids.length - 1], SentAt: now.toISOString(), Error: "" }));
    // Номера наших сообщений — в память чата: бот поймёт, что это не менеджер написал.
    const c = chat ?? emptyBotChat(next.phone);
    const updated = { ...c, ourIds: [...c.ourIds, ...ids].slice(-20), name: c.name || next.name };
    writes.push(botChatWrite(updated, chat?.rowNumber ?? null));
    await commitAtomic(writes);
    return result({ waitSeconds: nextGapSeconds(Math.random, sentToday + 1), note: "", sentTo: next.name || next.phone, remaining: remaining() - 1 });
  } catch (err) {
    const e = err instanceof GreenError ? err : null;
    const kind = e ? greenFailureKind(e.status) : "recipient";
    if (e && kind === "pause") {
      writes.push(broadcastUpdate(found.rowNumber, { Status: BROADCAST_STATUSES.PAUSED, Note: e.message }));
      await commitAtomic(writes);
      revalidatePath("/clients/broadcasts");
      return { status: BROADCAST_STATUSES.PAUSED, remaining: remaining(), waitSeconds: 0, note: e.message };
    }
    if (e && kind === "retry") {
      // Сбой связи: этого же получателя попробуем через минуту, ошибку ему не ставим.
      await commitAtomic(writes);
      return result({ waitSeconds: 60, note: e.message });
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
