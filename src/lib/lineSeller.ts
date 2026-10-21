import { botAct, botReply } from "./botEngine";
import { botDecision } from "./broadcast";
import { REPEAT_TASK, repeatsOurMessage } from "./botTurn";
import { fetchChatHistory, sendFileByUrl, sendText, configureWebhook } from "./greenApi";
import { phoneKey } from "./leads";
import { mergeMessages, messageText } from "./whatsapp";
import { appendWaMessages, listWaMessages } from "./repo/talks";
import { settingsMap } from "./repo/broadcasts";
import { appendAssistantLog, listAssistantLog, listWaLines, managerLineConfig, type AssistantLogRow } from "./repo/waLines";
import { readTable, SHEET_TABS } from "./sheets";
import { lineChannel, isChannelOrder } from "./sellerChannel";
import { lineAlertText, lineBotChat, managerTalkAt } from "./lineSellerRules";
import { notifyLineManager } from "./lineNotify";
import { MANAGER_PROFILES_SETTING, parseManagerProfiles, profileOf } from "./managerProfile";
import type { BotFile } from "./botEngine";
import type { WaLine } from "./waLines";
import type { WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Ход продающего помощника на номере менеджера (режим «sell», 19.10.2026). Тот же продавец, что бот
// основного номера (`botEngine.ts`: подсказка, заказ, фото, каталог, счёт Kaspi), но:
//  - пишет с номера менеджера и от его имени (`managerName` в подсказке);
//  - заявка и новая карточка — на менеджера (`SellerChannel`), его продажа и бонус;
//  - память — переписка номера из WaMessages (+ история чата из Green API, если её мало);
//  - всё отправленное — в WaMessages (source «assistant») и в журнал AssistantLog (kind auto);
//  - записки и тревоги — в журнал (kind note) и сообщением менеджеру с основного номера.
// Ничего не бросает наружу: сбой — «ответит менеджер».
// ---------------------------------------------------------------------------

export interface SellerTurnResult {
  sent: boolean;
  why: string;
  /** Решено окончательно (ИИ промолчал, повтор, заказ — дело менеджера): на это сообщение больше не отвечать. */
  settled?: boolean;
}

/** Мало переписки в CRM (номер подключили недавно) — дотянуть историю чата из Green API и сохранить. */
async function withHistory(line: WaLine, phone: string, chat: WaMessage[]): Promise<WaMessage[]> {
  if (mergeMessages(chat).length >= 8) return chat;
  const cfg = managerLineConfig(line);
  if (!cfg) return chat;
  try {
    const known = new Set(chat.map((m) => m.messageId));
    const fresh = (await fetchChatHistory(cfg, phone, 40, 12000)).filter((m) => !known.has(m.messageId)).map((m) => ({ ...m, line: line.code }));
    if (fresh.length) await appendWaMessages(fresh).catch(() => undefined);
    return [...chat, ...fresh];
  } catch {
    return chat;
  }
}

/** Свежая переписка номера с клиентом — перед отправкой: не дописал ли клиент, не ответил ли менеджер. */
async function freshChat(line: WaLine, phone: string): Promise<WaMessage[]> {
  await readTable(SHEET_TABS.WA_MESSAGES, { fresh: true }).catch(() => undefined);
  const key = phoneKey(phone);
  return (await listWaMessages({ lines: "all" })).filter((m) => m.line === line.code && phoneKey(m.phone) === key);
}

/** Записать отправленное помощником: в переписку и в журнал (по номеру сообщения CRM узнаёт ответы ИИ). */
async function recordSent(line: WaLine, phone: string, id: string, type: string, text: string, kind: "auto" | "nudge", note = ""): Promise<void> {
  const at = new Date().toISOString();
  await appendWaMessages([
    { messageId: id, at, chatId: `${phone}@c.us`, phone, direction: "out", type, text, mediaUrl: "", senderName: "", source: "assistant", line: line.code },
  ]).catch((err) => console.error("line seller record:", err instanceof Error ? err.message : err));
  await appendAssistantLog([{ at, line: line.code, phone, kind, messageId: id, text, note, byEmail: "assistant" }]).catch((err) =>
    console.error("line seller log:", err instanceof Error ? err.message : err)
  );
}

/** Картинки (фото позиции, каталог) с номера менеджера. Возвращает, сколько ушло. */
async function sendFiles(line: WaLine, phone: string, files: BotFile[]): Promise<number> {
  const cfg = managerLineConfig(line);
  if (!cfg) return 0;
  let sent = 0;
  for (const f of files) {
    try {
      const id = await sendFileByUrl(cfg, phone, f.url, f.name, f.caption);
      await recordSent(line, phone, id, "image", f.memo, "auto");
      sent += 1;
    } catch (err) {
      console.error("line seller file:", err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

/** Записка менеджеру в журнал; тревога («внимание: …») — ещё и сообщением ему, не чаще раза в час на чат. */
async function noteForLine(line: WaLine, phone: string, note: string, reply: string, lastClient: string, name: string, log: AssistantLogRow[]): Promise<void> {
  if (!note) return;
  const at = new Date().toISOString();
  await appendAssistantLog([{ at, line: line.code, phone, kind: "note", messageId: "", text: reply, note, byEmail: "assistant" }]).catch(() => undefined);
  const alert = note
    .split("; ")
    .filter((n) => n.startsWith("внимание:"))
    .join("; ");
  if (!alert) return;
  const key = phoneKey(phone);
  const recent = log.some((r) => r.kind === "note" && r.line === line.code && phoneKey(r.phone) === key && /внимание:/.test(r.note) && Date.now() - Date.parse(r.at) < 3600000);
  if (!recent) await notifyLineManager(line.code, lineAlertText({ phone, name, note: alert, lastClient }));
}

/**
 * Ответить клиенту на номере менеджера как продавец. `chat` — переписка этой линии с этим номером,
 * `lastIn` — сообщение клиента, на которое отвечаем. Перед отправкой проверяет свежую переписку:
 * клиент дописал или менеджер ответил сам — молчит (ответит следующий проход или человек).
 */
export async function sellerTurn(input: { line: WaLine; phone: string; chat: WaMessage[]; lastIn: WaMessage; managerName: string }): Promise<SellerTurnResult> {
  const { line, phone } = input;
  const cfg = managerLineConfig(line);
  if (!cfg) return { sent: false, why: "номер не подключён" };
  const settings = await settingsMap();
  const channel = lineChannel(line, input.managerName, profileOf(parseManagerProfiles(settings[MANAGER_PROFILES_SETTING]), line.managerEmail));
  const chat = await withHistory(line, phone, input.chat);
  const memory = lineBotChat(phone, chat);
  const instructions = (settings.BotInstructions || "").trim();
  let decision: ReturnType<typeof botDecision>;
  try {
    decision = await botReply(memory, instructions, "Ответь на последнее сообщение клиента.", channel);
    if (!decision.silent && !decision.order.confirmed && repeatsOurMessage(decision.reply, memory.context)) {
      decision = await botReply(memory, instructions, REPEAT_TASK, channel);
    }
  } catch (err) {
    return { sent: false, why: `ИИ не ответил: ${err instanceof Error ? err.message : err}`.slice(0, 200) };
  }
  const log = await listAssistantLog({ fresh: true });
  const lastClient = messageText(input.lastIn);
  if (decision.silent) {
    if (decision.alert) await noteForLine(line, phone, `внимание: ${decision.alert}`, "", lastClient, memory.name, log);
    return { sent: false, why: "ИИ решил промолчать", settled: true };
  }
  if (!decision.order.confirmed && repeatsOurMessage(decision.reply, memory.context)) {
    await noteForLine(line, phone, "внимание: помощник не нашёл, что ответить, кроме повтора — ответьте клиенту сами", "", lastClient, memory.name, log);
    return { sent: false, why: "повтор", settled: true };
  }
  // Пока модель думала: клиент дописал (ответит ход нового сообщения) или ответил менеджер (разговор его).
  const now = await freshChat(line, phone);
  const autoIds = new Set(log.filter((r) => r.kind === "auto" || r.kind === "nudge").map((r) => r.messageId));
  if (now.some((m) => m.direction === "in" && m.messageId !== input.lastIn.messageId && m.at > input.lastIn.at)) return { sent: false, why: "клиент дописал" };
  if (now.some((m) => m.direction === "out" && m.at > input.lastIn.at && !autoIds.has(m.messageId))) return { sent: false, why: "ответил менеджер" };
  if (log.some((r) => (r.kind === "auto" || r.kind === "nudge") && r.line === line.code && phoneKey(r.phone) === phoneKey(phone) && r.at > input.lastIn.at)) {
    return { sent: false, why: "уже ответили" };
  }

  // Разговор ведёт сам менеджер (отвечал клиенту за последние часы) — заказ оформляет он, помощник только напоминает.
  const managerAt = managerTalkAt([...chat, ...now], autoIds, new Date());
  const { text, note, files } = await botAct(memory, decision, channel, { orderBy: managerAt ? input.managerName || "менеджер" : "" });
  const filesSent = await sendFiles(line, phone, files);
  let sent = filesSent > 0;
  if (text) {
    try {
      const id = await sendText(cfg, phone, text);
      await recordSent(line, phone, id, "text", text, "auto");
      sent = true;
    } catch (err) {
      console.error("line seller send:", err instanceof Error ? err.message : err);
    }
  }
  await noteForLine(line, phone, note, text, lastClient, memory.name, log);
  if (!sent && managerAt && decision.order.confirmed) return { sent: false, why: "заказ ведёт менеджер — записка ему", settled: true };
  return { sent, why: sent ? "ответил" : "не ушло" };
}

/**
 * Касание (дожим) с номера менеджера: фото или текст. Записывается как kind «nudge» — по нему считаются
 * касания и не путаются с ответами менеджера.
 */
export async function sendLineNudge(line: WaLine, phone: string, msg: { text: string; file?: { url: string; name: string; caption: string; memo: string } }): Promise<string> {
  const cfg = managerLineConfig(line);
  if (!cfg) throw new Error("номер не подключён");
  if (msg.file) {
    const id = await sendFileByUrl(cfg, phone, msg.file.url, msg.file.name, msg.file.caption);
    await recordSent(line, phone, id, "image", msg.file.memo, "nudge");
    return id;
  }
  const id = await sendText(cfg, phone, msg.text);
  await recordSent(line, phone, id, "text", msg.text, "nudge");
  return id;
}

/** Написать клиенту с номера менеджера про его заказ (оплата пришла, счёт не дошёл, напоминание). */
export async function sendLineOrderMessage(managerEmail: string, phone: string, text: string, note = ""): Promise<string> {
  const line = (await listWaLines()).find((l) => l.active && l.assistant === "sell" && l.managerEmail === managerEmail.trim().toLowerCase());
  if (!line) return "";
  const cfg = managerLineConfig(line);
  if (!cfg) return "";
  const digits = phone.replace(/\D/g, "");
  const id = await sendText(cfg, digits, text);
  await recordSent(line, digits, id, "text", text, "auto", note);
  if (note) await appendAssistantLog([{ at: new Date().toISOString(), line: line.code, phone: digits, kind: "note", messageId: "", text, note, byEmail: "assistant" }]).catch(() => undefined);
  return id;
}

/** Есть ли у менеджера номер с продающим помощником (тогда его заказы помощника ведёт этот номер). */
export async function sellLineOf(managerEmail: string): Promise<WaLine | null> {
  const email = managerEmail.trim().toLowerCase();
  return (await listWaLines()).find((l) => l.active && l.assistant === "sell" && l.managerEmail === email) ?? null;
}

export { isChannelOrder };

/**
 * Адрес уведомлений номера менеджера пропал (перепривязка по QR его стирает, 19.10.2026: у Ильяса после
 * подключения адрес был пуст, и в CRM не пришло ни одного сообщения) — прописать заново. Не чаще раза в
 * 30 минут на экземпляр; ошибки молча.
 */
export async function ensureLineWebhooks(site: string): Promise<string[]> {
  const g = globalThis as unknown as { __lineHookCheck?: number };
  if (g.__lineHookCheck && Date.now() - g.__lineHookCheck < 30 * 60000) return [];
  g.__lineHookCheck = Date.now();
  const token = (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim();
  if (!token || !site) return [];
  const out: string[] = [];
  for (const line of await listWaLines()) {
    const cfg = line.active ? managerLineConfig(line) : null;
    if (!cfg) continue;
    try {
      const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/getSettings/${cfg.token}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      const s = (await res.json()) as { webhookUrl?: string; incomingWebhook?: string };
      if ((s.webhookUrl || "").includes(`line=${encodeURIComponent(line.code)}`) && s.incomingWebhook === "yes") continue;
      await configureWebhook(cfg, `${site}/api/whatsapp/webhook?line=${encodeURIComponent(line.code)}`, token);
      out.push(`${line.code}: адрес уведомлений прописан заново`);
    } catch (err) {
      out.push(`${line.code}: ${err instanceof Error ? err.message : err}`.slice(0, 160));
    }
  }
  return out;
}
