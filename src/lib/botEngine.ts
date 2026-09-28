import { commitAtomic, prefetchTables, SHEET_TABS, type WriteOp } from "./sheets";
import { localDayKey } from "./timezone";
import { FLOWER_TYPE_LABELS, formatGrade, compareGrades } from "./constants";
import { getCurrentPrices } from "./repo/prices";
import { botChatWrite, emptyBotChat, listBotChats, settingsMap } from "./repo/broadcasts";
import {
  BOT_HANDOFF_TEXT,
  BOT_MODES,
  BOT_OPT_OUT_TEXT,
  botDecision,
  botSettingsFrom,
  botSilenceReason,
  isOptOutText,
  pushContext,
  type BotChat,
} from "./broadcast";
import { chatJson, openAiConfigured } from "./openai";
import { greenConfig, sendText } from "./greenApi";
import type { BotIncoming } from "./greenOut";
import { phoneKey } from "./leads";

// ---------------------------------------------------------------------------
// Бот-автоответчик WhatsApp (Green API). Зовётся из вебхука ПОСЛЕ того, как
// сообщения записаны в WaMessages, и никогда не роняет вебхук: сбой бота — это
// «ответит менеджер», а не повтор уведомления и двойные сообщения.
//
// Правила «когда молчать» — `botSilenceReason` в `broadcast.ts` (чистая функция
// под проверкой). Здесь — чтение состояния, запрос к модели, отправка, запись.
// ---------------------------------------------------------------------------

const BOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "handoff", "reason"],
  properties: {
    reply: { type: "string", description: "Ответ клиенту: коротко, вежливо, на его языке. Пусто — если сразу передаёшь человеку." },
    handoff: { type: "boolean", description: "true — вопрос должен решать менеджер (заказ, наличие, сроки, жалоба, непонятно)." },
    reason: { type: "string", description: "Почему передаёшь менеджеру — одной фразой. Пусто, если не передаёшь." },
  },
};

function almatyHour(d: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(d);
  return Number(h) % 24;
}

/** Действующий клиентский прайс одной строкой на позицию — для подсказки модели. */
async function priceText(): Promise<string> {
  try {
    const prices = await getCurrentPrices(localDayKey());
    const lines = Array.from(prices.values())
      .filter((p) => p.price > 0)
      .sort(
        (a, b) =>
          a.flowerType.localeCompare(b.flowerType) ||
          (a.variety || "").localeCompare(b.variety || "") ||
          compareGrades(a.flowerType, a.grade, b.grade)
      )
      .map((p) => `${FLOWER_TYPE_LABELS[p.flowerType] ?? p.flowerType} · ${p.variety || "все сорта"} · ${formatGrade(p.grade)} — ${Math.round(p.price)} ₸`);
    const text = lines.join("\n");
    return text.length > 7000 ? `${text.slice(0, 7000)}\n…` : text;
  } catch {
    return "";
  }
}

function systemPrompt(instructions: string, prices: string): string {
  return [
    "Ты — помощник оптовой цветочной компании Ecoculture (Казахстан, своё тепличное хозяйство: розы, хризантемы, эустома).",
    "Продаём оптом салонам, магазинам и цветочникам. Отвечаешь клиентам в WhatsApp от имени компании.",
    "Пиши коротко (1–3 предложения), вежливо, на языке клиента (русский или казахский), без разметки и без эмодзи.",
    "Цены бери ТОЛЬКО из прайса ниже — это тенге за стебель. Если позиции нет в прайсе — не придумывай, передай менеджеру.",
    "Не обещай наличие, сроки и стоимость доставки, скидки и условия оплаты. Хочет заказать, спрашивает о наличии,",
    "доставке, счёте, жалуется или вопрос непонятен — handoff=true и напиши, что менеджер скоро ответит.",
    "Никогда не проси номера карт, пароли и коды из SMS. Не спорь и не обсуждай посторонние темы.",
    instructions ? `\nУказания владельца (главнее общих правил, кроме запрета выдумывать цены):\n${instructions}` : "",
    prices ? `\nДействующий прайс:\n${prices}` : "\nПрайса сейчас нет — о ценах отвечает менеджер (handoff=true).",
  ].join("\n");
}

function transcript(chat: BotChat): string {
  return chat.context.map((c) => `${c.role === "client" ? "Клиент" : "Мы"}: ${c.text}`).join("\n");
}

/**
 * Разобрать входящие одного уведомления: отметить, где писал человек,
 * отписку, и, если бот должен ответить, — ответить. Ничего не бросает.
 */
export async function runBot(all: BotIncoming[]): Promise<void> {
  // Эхо наших же сообщений через API (рассылка, сам бот) ничего не меняет —
  // и таблицу ради него не читаем (лимит общий, грабли 1.17).
  const messages = all.filter((m) => !(m.isEcho && m.fromApi));
  if (messages.length === 0) return;
  try {
    await prefetchTables([SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS]);
    const [chats, map] = await Promise.all([listBotChats(true), settingsMap()]);
    const settings = botSettingsFrom(map);
    const byKey = new Map(chats.map((c) => [phoneKey(c.phone), c]));

    const phones = Array.from(new Set(messages.map((m) => phoneKey(m.phone)).filter(Boolean)));
    const writes: WriteOp[] = [];
    for (const key of phones) {
      const mine = messages.filter((m) => phoneKey(m.phone) === key).sort((a, b) => (a.at < b.at ? -1 : 1));
      const existing = byKey.get(key) ?? null;
      // Номер рабочий: по нему идёт вся переписка менеджеров. Память заводим
      // только тем, с кем бот может говорить, — иначе вкладка BotChats копила бы
      // строку на каждого, кто хоть раз написал в WhatsApp.
      if (!existing && !(settings.enabled && settings.scope === "all" && mine.some((m) => !m.isEcho))) continue;
      const chat: BotChat = existing ? { ...existing, context: [...existing.context], ourIds: [...existing.ourIds] } : emptyBotChat(mine[0].phone);
      let changed = false;

      for (const m of mine.filter((x) => x.isEcho)) {
        if (chat.ourIds.includes(m.messageId)) continue;
        // Написал живой человек (с телефона или из WhatsApp Web) — бот уступает.
        chat.humanAt = m.at;
        chat.context = pushContext(chat.context, { role: "us", text: m.text || "[файл]", at: m.at });
        changed = true;
      }

      const incoming = mine.filter((x) => !x.isEcho);
      const last = incoming[incoming.length - 1];
      if (last) {
        for (const m of incoming) chat.context = pushContext(chat.context, { role: "client", text: m.text || `[${m.type}]`, at: m.at });
        if (last.senderName) chat.name = last.senderName;
        changed = true;
        const now = new Date();
        const silence = botSilenceReason({ settings, chat: existing ? chat : null, messageId: last.messageId, now, hour: almatyHour(now) });
        const duplicate = silence === "повтор уведомления";
        chat.lastInMessageId = last.messageId;

        if (!duplicate && isOptOutText(last.text) && chat.ourIds.length > 0 && chat.mode !== BOT_MODES.OPT_OUT) {
          chat.mode = BOT_MODES.OPT_OUT;
          await reply(chat, last, BOT_OPT_OUT_TEXT);
        } else if (!silence && greenConfig()) {
          await answer(chat, last, settings.instructions);
        }
      }
      if (changed) writes.push(botChatWrite(chat, existing?.rowNumber ?? null));
    }
    if (writes.length > 0) await commitAtomic(writes);
  } catch (err) {
    console.error("whatsapp bot:", err instanceof Error ? err.message : err);
  }
}

async function reply(chat: BotChat, to: BotIncoming, text: string): Promise<boolean> {
  const cfg = greenConfig();
  if (!cfg) return false;
  try {
    const id = await sendText(cfg, to.phone, text);
    chat.ourIds = [...chat.ourIds, id].slice(-20);
    chat.context = pushContext(chat.context, { role: "us", text, at: new Date().toISOString() });
    return true;
  } catch (err) {
    console.error("whatsapp bot send:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function answer(chat: BotChat, last: BotIncoming, instructions: string): Promise<void> {
  const now = new Date().toISOString();
  if (!openAiConfigured()) {
    chat.mode = BOT_MODES.HANDOFF;
    chat.handoffAt = now;
    chat.handoffReason = "ИИ не подключён";
    return;
  }
  let decision: { reply: string; handoff: boolean; reason: string };
  try {
    const { data } = await chatJson(
      systemPrompt(instructions, await priceText()),
      `Переписка (последние сообщения):\n${transcript(chat)}\n\nОтветь на последнее сообщение клиента.`,
      "bot_reply",
      BOT_SCHEMA,
      { fast: true }
    );
    decision = botDecision(data);
  } catch (err) {
    console.error("whatsapp bot ai:", err instanceof Error ? err.message : err);
    chat.mode = BOT_MODES.HANDOFF;
    chat.handoffAt = now;
    chat.handoffReason = "бот не смог ответить — ответьте сами";
    return;
  }
  const text = decision.handoff ? decision.reply || BOT_HANDOFF_TEXT : decision.reply;
  const sent = await reply(chat, last, text);
  chat.botReplies += sent ? 1 : 0;
  if (decision.handoff || !sent) {
    chat.mode = BOT_MODES.HANDOFF;
    chat.handoffAt = now;
    chat.handoffReason = sent ? decision.reason || "нужен менеджер" : "бот не смог отправить ответ";
  } else if (chat.mode !== BOT_MODES.OPT_OUT) {
    chat.mode = BOT_MODES.BOT;
  }
}
