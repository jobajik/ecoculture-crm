import { localDayKey } from "./timezone";
import { commitAtomic, prefetchTables, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "./sheets";
import {
  botChatWrite,
  broadcastUpdate,
  emptyBotChat,
  findBroadcastRow,
  listBotChats,
  listRecipients,
  recipientUpdate,
  settingsMap,
} from "./repo/broadcasts";
import {
  BOT_MODES,
  BROADCAST_STATUSES,
  broadcastTextRefusal,
  effectiveDailyLimit,
  nextGapSeconds,
  pacingWait,
  personalize,
  pickNextRecipient,
  sendTooSoon,
} from "./broadcast";
import { listWaMessages } from "./repo/talks";
import { GreenError, sendFileByUrl, sendText, type GreenConfig } from "./greenApi";
import { checkGreenChannel } from "./greenChannel";
import { MAX_CAPTION, greenFailureKind, greenFileName } from "./greenOut";
import { publicFileUrl, safeFileName } from "./waFileSign";
import { ROTATION_FILE, isSpecialFile } from "./botPhotos";
import { loadPhotoContext, rotationPhoto } from "./botPhotoSend";
import { catalogFiles } from "./catalogFiles";
import { phoneKey } from "./leads";
import { getCurrentPrices } from "./repo/prices";
import { priceMapForClient } from "./priceList";
import { fillPrices, priceTagFlowers, priceTagsRefusal } from "./broadcastPrices";
import { ORDER_STATUSES } from "./constants";

// ---------------------------------------------------------------------------
// Отправка рассылки — один шаг «следующее сообщение». Зовут страница рассылки
// (серверное действие, `BroadcastSender`) и `/api/broadcast/tick` (CRON_SECRET):
// его по кругу дёргает `scripts/broadcast-run.ts` с компьютера владельца, чтобы
// рассылка шла без открытой страницы (08.10.2026, владелец: «прогони по клиентской
// базе, 40 клиентов в день»). Правила осторожности — `broadcast.ts`.
// ---------------------------------------------------------------------------

export const SITE = () => (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");

export interface SendStep {
  status: string;
  remaining: number;
  waitSeconds: number;
  note: string;
  sentTo?: string;
  /** Изменился статус рассылки — страницу списка стоит перерисовать. */
  changed?: boolean;
}

/**
 * Клиенты, которые у нас хоть раз заказывали (не отменённое), — «тёплые», как и
 * писавшие в WhatsApp (владелец, 08.10.2026: «покупавшие — тоже тёплые»).
 */
async function buyerClientIds(): Promise<Set<string>> {
  try {
    const t = await readTable(SHEET_TABS.ORDERS);
    const out = new Set<string>();
    for (const row of t.rows) {
      const r = rowToRecord(SHEET_TABS.ORDERS, row);
      if (r.ClientID && r.Status !== ORDER_STATUSES.CANCELLED) out.add(r.ClientID);
    }
    return out;
  } catch {
    return new Set();
  }
}

/**
 * Метки {цены хризантема} → действующий прайс. Подставляется ОДИН раз — при
 * создании рассылки (и в проверочном сообщении): всем получателям уходит одна и
 * та же цена, а в отчёте хранится ровно то, что ушло. Прайс читается, только если
 * метка в тексте есть.
 */
export async function withPrices(text: string): Promise<string> {
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
 * Одно сообщение рассылки. С файлом — файл с подписью-текстом одним сообщением;
 * если текст длиннее подписи WhatsApp (1024 знака) — файл, потом текст.
 */
export async function deliver(cfg: GreenConfig, phone: string, text: string, file: { id: string; name: string; mime: string } | null) {
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
export function mimeOf(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Отправить следующее сообщение рассылки. Зовёт открытая страница рассылки,
 * раз в 1–2,5 минуты (пауза случайная — так пишет человек, а не робот), после каждых
 * 10 — перерыв, только 10:00–19:00, не больше 15 в час, сначала «тёплым» (04.10.2026).
 * Сервер сам не торопится: слишком частый вызов (две открытые вкладки)
 * получает «подождите», а дневной предел общий на все рассылки.
 */
export async function sendNextBroadcastMessage(broadcastId: string): Promise<SendStep> {
  await prefetchTables([SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.ORDERS]);
  const found = await findBroadcastRow(broadcastId, false);
  if (!found) throw new Error("Рассылка не найдена");
  const b = found.broadcast;
  const all = await listRecipients();
  const mine = all.filter((r) => r.broadcastId === broadcastId);
  const remaining = () => mine.filter((r) => r.status === "queued").length;
  const result = (extra: { waitSeconds: number; note: string; sentTo?: string; remaining?: number }): SendStep => ({ status: b.status, remaining: remaining(), ...extra });

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
    return { status: BROADCAST_STATUSES.DONE, remaining: 0, waitSeconds: 0, note: "Рассылка закончена", changed: true };
  }
  if (sentToday >= limit) {
    return result({ waitSeconds: 1800, note: `На сегодня отправлено ${sentToday} из ${limit} — продолжим завтра` });
  }
  // Осторожно: только днём, не больше 15 в час, перерыв после каждых 10 — по ВСЕМ рассылкам сразу.
  const wait = pacingWait({ now, minutes: now.getHours() * 60 + now.getMinutes(), sentTimes: sentRows.map((r) => Date.parse(r.sentAt)) });
  if (wait) return result(wait);

  // Сначала тем, кто уже писал нам или покупал; остальным — не больше 10 в день.
  const wrote = new Set((await listWaMessages()).filter((m) => m.direction === "in").map((m) => phoneKey(m.phone)));
  const buyers = await buyerClientIds();
  const isWarm = (r: { phone: string; kind: string; refId: string }) => wrote.has(phoneKey(r.phone)) || (r.kind === "client" && buyers.has(r.refId));
  const coldSentToday = sentRows.filter((r) => !isWarm(r)).length;
  const pick = pickNextRecipient(queued, isWarm, coldSentToday);
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
    return { status: BROADCAST_STATUSES.PAUSED, remaining: remaining(), waitSeconds: 0, note: channel.text, changed: true };
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
        return { status: BROADCAST_STATUSES.PAUSED, remaining: remaining(), waitSeconds: 0, note: e.message, changed: true };
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
