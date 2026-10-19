import { chatJson, openAiConfigured } from "./openai";
import { salesKnowledge } from "./botEngine";
import { toWhatsApp } from "./botOrder";
import { sendText } from "./greenApi";
import { ourPhoneKeys } from "./lineNotify";
import { phoneKey } from "./leads";
import { mergeMessages, messageText } from "./whatsapp";
import { appendWaMessages, listWaMessages } from "./repo/talks";
import { settingsMap } from "./repo/broadcasts";
import { saveSettings } from "./repo/settings";
import { chainBusy, parseChainLock } from "./autoBroadcast";
import { listUsers } from "./repo/users";
import { appendAssistantLog, listAssistantLog, listWaLines, managerLineConfig } from "./repo/waLines";
import { assistantVerdict, type WaLine } from "./waLines";
import { sellerTurn } from "./lineSeller";
import type { WaMessage } from "./types";

// ---------------------------------------------------------------------------
// ИИ-помощник менеджера (16.10.2026, владелец выбрал «подсказывает, отвечает при
// молчании»). Две роли:
//  - ПОДСКАЗКА: в «Переписках» кнопка «Предложить ответ» — черновик, менеджер
//    правит и отправляет сам;
//  - ОТВЕТ ПРИ МОЛЧАНИИ: клиент ждёт дольше 20 минут в рабочее время или пишет
//    вечером и в выходные (`assistantVerdict`) — помощник отвечает с номера
//    менеджера сам. Заказ и счёт он НЕ оформляет: подтверждает, что понял, и
//    оставляет менеджеру записку «оформить заказ: …» (`AssistantLog`, kind note).
// Знание о ценах и складе — то же, что у бота (`salesKnowledge`), модель — та же быстрая.
// ---------------------------------------------------------------------------

const S = (description: string) => ({ type: "string", description });

export const ASSISTANT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "silent", "needs_manager"],
  properties: {
    reply: S("Сообщение клиенту в WhatsApp. Пусто, если silent"),
    silent: { type: "boolean", description: "true — не отвечать: автоответ, кивок, не про цветы, сотрудник, поставщик, водитель, личное" },
    needs_manager: S("Что сделать менеджеру одной фразой: оформить заказ (позиции, количество, день), дать ответ на вопрос, позвонить. Иначе пусто"),
  },
};

export function assistantSystemPrompt(p: {
  managerName: string;
  prices: string;
  stock: string;
  storeNote: string;
  harvest: string;
  push: string;
  client: string;
  instructions: string;
  today: string;
}): string {
  const weekday = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"][new Date(`${p.today}T12:00:00`).getDay()];
  return [
    `Ты — помощник менеджера по продажам${p.managerName ? ` ${p.managerName}` : ""} оптовой цветочной компании Ecoculture`,
    "(Казахстан, своё тепличное хозяйство: розы, хризантемы, эустома; продаём оптом магазинам, салонам, цветочникам).",
    "Пишешь клиенту в WhatsApp С РАБОЧЕГО НОМЕРА МЕНЕДЖЕРА, от его имени, пока он занят. Не говори, что ты бот, ИИ или помощник.",
    "Цель — не потерять клиента и продать: ответить по существу, предложить конкретное, довести до согласия на заказ.",
    "",
    "Стиль: как живой человек — коротко, тепло, на языке клиента (русский или казахский), 1–3 коротких блока.",
    "Не обращайся по имени. Не здоровайся заново, если в переписке уже здоровались. Не повторяй уже сказанное.",
    "Вопрос клиенту — не больше одного, последней строкой. Позиции и цены — списком «• …». Не используй # и **.",
    "",
    "Что можно:",
    "- цены — ТОЛЬКО из прайса ниже (тенге за стебель), наличие — ТОЛЬКО по складу ниже; точное число стеблей не называй;",
    "- на вопрос «что есть» — 3–5 ходовых позиций со склада с ценами; объём не назван — предложи одно число с суммой;",
    "- «дорого» — предложи категорию ниже или другой сорт с суммой; «подумаю» — пробную партию.",
    "Что НЕЛЬЗЯ, это решает менеджер (тогда честно «уточню и отпишусь» и заполни needs_manager):",
    "- оформлять заказ и выставлять счёт: клиент назвал позицию и количество или согласился — подтверди коротко",
    "  (позиция, количество, цена, сумма, день) и напиши, что оформляешь и подтверждение со счётом придёт сюда же;",
    "  needs_manager = «оформить заказ: …»;",
    "- оплата не вперёд (при получении, отсрочка, частями), скидки сверх прайса, документы, доставка ко времени, жалоба,",
    "  договорённости, о которых нет в переписке, просьба позвонить — needs_manager;",
    "- выдумывать то, чего нет в данных: цены, наличие, сроки, условия.",
    "silent=true — автоответ магазина, кивок без вопроса («ок», «спасибо», 👍), разговор не про цветы, сотрудник, водитель,",
    "поставщик, личное. Сомневаешься, клиент ли это, — silent.",
    "Если ответить по существу нечем — короткое «Принято, уточню и отпишусь здесь» и needs_manager.",
    `\nСегодня ${p.today}, ${weekday} (Алматы).`,
    p.storeNote ? p.storeNote : "",
    p.client ? `\nО клиенте:\n${p.client}` : "",
    p.instructions ? `\nУказания владельца для продаж:\n${p.instructions}` : "",
    p.push ? `\n${p.push}` : "",
    p.prices ? `\nДействующий прайс:\n${p.prices}` : "\nПрайса сейчас нет — цены не называй.",
    p.stock ? `\nСклад сейчас (можно продать):\n${p.stock}` : "\nДанных склада нет — о наличии не обещай.",
    p.harvest ? `\nПлан срезки (прогноз, продать можно только то, что на складе):\n${p.harvest}` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  return p.replace(",", "");
}

/** Переписка для модели: последние сообщения, «Клиент» / «Мы». */
export function assistantTranscript(chat: WaMessage[], maxChars = 12000): string {
  const lines: string[] = [];
  let total = 0;
  for (let i = chat.length - 1; i >= 0; i--) {
    const m = chat[i];
    const line = `[${shortTime(m.at)}] ${m.direction === "in" ? "Клиент" : "Мы"}: ${messageText(m)}`;
    if (total + line.length > maxChars && lines.length) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.reverse().join("\n");
}

export interface AssistantAnswer {
  reply: string;
  silent: boolean;
  note: string;
}

export function parseAssistantAnswer(raw: unknown): AssistantAnswer {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const silent = r.silent === true;
  const reply = silent ? "" : toWhatsApp(String(r.reply || "").trim()).slice(0, 3000);
  return { reply, silent: silent || !reply, note: String(r.needs_manager || "").trim().slice(0, 400) };
}

/** Ответ помощника на переписку ОДНОЙ линии с ОДНИМ номером — без отправки. */
export async function assistantAnswer(chat: WaMessage[], phone: string, managerName: string, task: string): Promise<AssistantAnswer> {
  if (!openAiConfigured()) throw new Error("ИИ не подключён — нужен ключ OpenAI.");
  const k = await salesKnowledge(phone);
  const system = assistantSystemPrompt({ managerName, ...k });
  const user = `Переписка (последние сообщения):\n${assistantTranscript(mergeMessages(chat))}\n\n${task}`;
  const { data } = await chatJson(system, user, "manager_assistant", ASSISTANT_SCHEMA, { fast: true });
  return parseAssistantAnswer(data);
}

export const DRAFT_TASK = "Подготовь ответ на последнее сообщение клиента — менеджер посмотрит, поправит и отправит сам.";
export const AUTO_TASK = "Менеджер сейчас не может ответить. Ответь на последнее сообщение клиента сам.";

/** Первое слово имени менеджера — для подсказки модели. */
async function managerNameOf(email: string): Promise<string> {
  try {
    const u = (await listUsers()).find((x) => x.email.toLowerCase() === email);
    return (u?.name || "").split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

/** Отправить текст с номера линии, записать в переписку и журнал. Возвращает номер сообщения. */
export async function sendFromLine(line: WaLine, phone: string, text: string, kind: "auto" | "crm", byEmail: string, note = ""): Promise<string> {
  const cfg = managerLineConfig(line);
  if (!cfg) throw new Error("Номер не подключён или выключен — проверьте в «Настройках → WhatsApp менеджеров».");
  const id = await sendText(cfg, phone, text);
  const now = new Date().toISOString();
  const msg: WaMessage = {
    messageId: id,
    at: now,
    chatId: `${phone}@c.us`,
    phone,
    direction: "out",
    type: "text",
    text,
    mediaUrl: "",
    senderName: "",
    source: kind === "auto" ? "assistant" : "crm",
    line: line.code,
  };
  await appendWaMessages([msg]);
  await appendAssistantLog([{ at: now, line: line.code, phone, kind, messageId: id, text, note, byEmail }]);
  return id;
}

export interface SweepResult {
  checked: number;
  replied: number;
  notes: number;
  skipped: string[];
  /** Клиент ждёт, ответить можно будет через столько мс (режим «продаёт сам») — сторожу номера ждать. */
  pendingMs?: number;
  /** Номера в режиме «продаёт сам», где кто-то ждёт: общий проход их не трогает, а будит сторожа номера. */
  watch?: string[];
}

/**
 * Пройти по номерам менеджеров с включённым помощником и ответить там, где клиент ждёт
 * (`assistantVerdict`). `only` — один чат (вебхук после сообщения вне рабочего времени).
 * Не больше `limit` ответов за проход; ответ уходит, только если после нашего чтения клиенту
 * никто не ответил (журнал перечитывается свежим перед каждой отправкой).
 */
export async function runAssistantSweep(
  options: {
    limit?: number;
    budgetMs?: number;
    only?: { line: string; phone?: string };
    quick?: boolean;
    /** Проход сторожа номера «продаёт сам» (`/api/assistant/sweep?watch=…`): только он отвечает на таких номерах. */
    watcher?: boolean;
  } = {}
): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, replied: 0, notes: 0, skipped: [], watch: [] };
  if (!openAiConfigured()) return result;
  const started = Date.now();
  const lines = (await listWaLines()).filter((l) => l.active && l.assistant !== "off" && (!options.only || l.code === options.only.line));
  if (lines.length === 0) return result;
  const codes = new Set(lines.map((l) => l.code));
  const [messages, log, map] = await Promise.all([listWaMessages({ lines: "all" }), listAssistantLog(), settingsMap()]);
  const autoIds = new Set(log.filter((r) => r.kind === "auto" || r.kind === "nudge").map((r) => r.messageId));
  const staff = await ourPhoneKeys(map);
  const now = new Date();

  type Due = { line: WaLine; phone: string; chat: WaMessage[]; lastInAt: string; lastIn: WaMessage };
  const due: Due[] = [];
  for (const line of lines) {
    const byKey = new Map<string, WaMessage[]>();
    for (const m of messages) {
      if (m.line !== line.code || !codes.has(m.line)) continue;
      const key = phoneKey(m.phone);
      if (!key || (options.only?.phone && key !== phoneKey(options.only.phone))) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), m]);
    }
    for (const [key, chat] of Array.from(byKey.entries())) {
      result.checked++;
      const v = assistantVerdict({ chat, autoIds, now, staff: staff.has(key), mode: line.assistant, quick: options.quick });
      if (line.assistant === "sell" && !options.watcher) {
        // Номер «продаёт сам» ведёт только его сторож (один на номер, под замком) — иначе два прохода ответили бы дважды.
        if ((v.due || v.retryInMs) && !result.watch!.includes(line.code)) result.watch!.push(line.code);
        continue;
      }
      if (v.due && v.lastIn) due.push({ line, phone: v.lastIn.phone, chat, lastInAt: v.lastIn.at, lastIn: v.lastIn });
      else if (v.retryInMs && line.assistant === "sell") result.pendingMs = Math.min(result.pendingMs ?? Infinity, v.retryInMs);
    }
  }
  // Дольше ждущие — первыми.
  due.sort((a, b) => (a.lastInAt < b.lastInAt ? -1 : 1));
  const limit = options.limit ?? 6;
  const names = new Map<string, string>();
  for (const d of due) {
    if (result.replied >= limit || Date.now() - started > (options.budgetMs ?? 30000)) {
      // Не успели — сторож номера «продаёт сам» вернётся к ним сразу.
      if (d.line.assistant === "sell") result.pendingMs = Math.min(result.pendingMs ?? Infinity, 1000);
      break;
    }
    // Свежий журнал: другой проход мог ответить этому клиенту секунду назад.
    const fresh = await listAssistantLog({ fresh: true });
    if (fresh.some((r) => r.kind === "auto" && r.line === d.line.code && phoneKey(r.phone) === phoneKey(d.phone) && r.at > d.lastInAt)) {
      result.skipped.push(`…${d.phone.slice(-4)}: уже ответили`);
      continue;
    }
    try {
      if (!names.has(d.line.managerEmail)) names.set(d.line.managerEmail, await managerNameOf(d.line.managerEmail));
      if (d.line.assistant === "sell") {
        // Продающий помощник: тот же продавец, что бот, — с заказом, счётом и фото (`lineSeller.ts`).
        const r = await sellerTurn({ line: d.line, phone: d.phone, chat: d.chat, lastIn: d.lastIn, managerName: names.get(d.line.managerEmail) ?? "" });
        if (r.sent) result.replied++;
        else result.skipped.push(`…${d.phone.slice(-4)}: ${r.why}`);
        continue;
      }
      const a = await assistantAnswer(d.chat, d.phone, names.get(d.line.managerEmail) ?? "", AUTO_TASK);
      if (a.silent) {
        result.skipped.push(`…${d.phone.slice(-4)}: ИИ решил промолчать`);
        if (a.note) {
          await appendAssistantLog([{ at: new Date().toISOString(), line: d.line.code, phone: d.phone, kind: "note", messageId: "", text: "", note: a.note, byEmail: "assistant" }]);
          result.notes++;
        }
        continue;
      }
      await sendFromLine(d.line, d.phone, a.reply, "auto", "assistant");
      result.replied++;
      if (a.note) {
        await appendAssistantLog([{ at: new Date().toISOString(), line: d.line.code, phone: d.phone, kind: "note", messageId: "", text: a.reply, note: a.note, byEmail: "assistant" }]);
        result.notes++;
      }
    } catch (err) {
      result.skipped.push(`…${d.phone.slice(-4)}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }
  return result;
}

/** Будить проход помощника из вебхука: не чаще раза в 3 минуты на экземпляр, запрос обрывается через 1,5 с. */
export async function kickAssistant(origin: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  const g = globalThis as unknown as { __assistantKick?: number };
  const now = Date.now();
  if (g.__assistantKick && now - g.__assistantKick < 3 * 60000) return;
  g.__assistantKick = now;
  try {
    await fetch(`${origin}/api/assistant/sweep?source=webhook`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Оборвали сами — проход идёт своей функцией.
  }
}

/** Ответ одному чату вне рабочего времени — своей функцией (`/api/assistant/sweep?line=…&phone=…`). */
export async function kickAssistantChat(origin: string, line: string, phone: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    await fetch(`${origin}/api/assistant/sweep?source=chat&line=${encodeURIComponent(line)}&phone=${encodeURIComponent(phone)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Оборвали сами.
  }
}

// --- Сторож номера «продаёт сам» ------------------------------------------------------
//
// Владелец выбрал «отвечать, если менеджер молчит 5 минут». Расписание у Vercel — раз в час, а вебхук
// не может ждать 5 минут, поэтому на номер — один сторож: функция под замком (настройка
// `AssistantWatch:<код>`, тот же приём, что у цепочки рассылок) проходит по чатам номера, отвечает тем,
// кому пора, ждёт до ближайшего «пора» (не дольше ~50 с) и, если кто-то ещё ждёт, будит себя снова.
// Никто не ждёт (менеджер ответил, ночь) — отпускает замок. Будят: вебхук номера на входящем, общий
// проход помощника и расписание раз в час.

const WATCH_PREFIX = "AssistantWatch:";
const WATCH_STEP_MS = 50000;
const WATCH_MAX_HOPS = 40;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLineWatch(
  code: string,
  origin: string,
  token: string,
  hop: number
): Promise<{ ok: boolean; busy?: boolean; handed?: boolean; replied: number; skipped: string[] }> {
  const key = `${WATCH_PREFIX}${code}`;
  const my = token || `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const lock = parseChainLock((await settingsMap(true))[key]);
  if (chainBusy(lock, my, new Date())) return { ok: true, busy: true, replied: 0, skipped: [] };
  await saveSettings({ [key]: JSON.stringify({ token: my, at: new Date().toISOString(), note: `шаг ${hop}` }) });
  await pause(1200);
  if (parseChainLock((await settingsMap(true))[key]).token !== my) return { ok: true, busy: true, replied: 0, skipped: [] };
  const started = Date.now();
  let replied = 0;
  const skipped: string[] = [];
  for (;;) {
    const r = await runAssistantSweep({ only: { line: code }, limit: 3, budgetMs: 25000, watcher: true });
    replied += r.replied;
    skipped.push(...r.skipped);
    const pending = r.pendingMs;
    const left = WATCH_STEP_MS - (Date.now() - started);
    if (!pending || !Number.isFinite(pending)) break;
    if (pending <= left - 3000) {
      await pause(pending);
      continue;
    }
    if (hop >= WATCH_MAX_HOPS) break;
    await pause(Math.max(0, Math.min(pending, left) - 1500));
    await saveSettings({ [key]: JSON.stringify({ token: my, at: new Date().toISOString(), note: `шаг ${hop + 1}` }) }).catch(() => undefined);
    await kickLineWatch(origin, code, my, hop + 1);
    return { ok: true, handed: true, replied, skipped };
  }
  await saveSettings({ [key]: "" }).catch(() => undefined);
  return { ok: true, replied, skipped };
}

/** Разбудить сторожа номера «продаёт сам» (запрос обрывается через 1,5 с — сторож идёт своей функцией). */
export async function kickLineWatch(origin: string, code: string, token = "", hop = 0): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    const q = new URLSearchParams({ watch: code, hop: String(hop), ...(token ? { token } : {}) });
    await fetch(`${origin}/api/assistant/sweep?${q.toString()}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1500) });
  } catch {
    // Оборвали сами.
  }
}
