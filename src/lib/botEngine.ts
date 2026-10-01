import { commitAtomic, prefetchTables, SHEET_TABS, type WriteOp } from "./sheets";
import { localDayKey } from "./timezone";
import { getCurrentPrices } from "./repo/prices";
import { listBatches } from "./repo/batches";
import { getSettings } from "./repo/settings";
import { botChatWrite, emptyBotChat, listBotChats, listBroadcasts, listRecipients, settingsMap } from "./repo/broadcasts";
import { lastBroadcastForBot, pricesForBot, stockForBot } from "./botKnowledge";
import {
  BOT_HANDOFF_TEXT,
  BOT_MODES,
  BOT_OPT_OUT_TEXT,
  botDecision,
  botSettingsFrom,
  botSilenceReason,
  isAckOnly,
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
  required: ["reply", "handoff", "reason", "silent"],
  properties: {
    reply: { type: "string", description: "Ответ клиенту: коротко, вежливо, на его языке. Пусто — если сразу передаёшь человеку." },
    handoff: {
      type: "boolean",
      description: "true — дальше нужен человек: заказ собран целиком, жалоба, клиент просит человека, вопрос о его заявке, счёте или долге.",
    },
    reason: { type: "string", description: "Почему передаёшь менеджеру — одной фразой. Пусто, если не передаёшь." },
    silent: {
      type: "boolean",
      description: "true — не отвечать вовсе: это автоответ магазина (приветствие-шаблон, часы работы, адрес) или отвечать не на что.",
    },
  },
};

function almatyHour(d: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(d);
  return Number(h) % 24;
}

/** Действующий клиентский прайс, уже разрешённый по сортам (`pricesForBot`) — для подсказки модели. */
async function priceText(): Promise<string> {
  try {
    const text = pricesForBot(Array.from((await getCurrentPrices(localDayKey())).values()));
    return text.length > 7000 ? `${text.slice(0, 7000)}\n…` : text;
  } catch {
    return "";
  }
}

/** Что сейчас есть на складе — для подсказки модели. Сбой — пусто, бот тогда о наличии не говорит. */
async function stockText(): Promise<string> {
  try {
    const [batches, settings] = await Promise.all([listBatches(), getSettings()]);
    return stockForBot(batches, settings, new Date());
  } catch {
    return "";
  }
}

async function broadcastText(phone: string): Promise<string> {
  try {
    const [list, recipients] = await Promise.all([listBroadcasts(), listRecipients()]);
    return lastBroadcastForBot(list, recipients, phone);
  } catch {
    return "";
  }
}

/**
 * Бот ведёт разговор САМ (владелец, 01.10.2026): цены, наличие, «пришлите
 * каталог», скидки, доставка, приём заказа. Менеджер нужен, когда заказ собран,
 * при жалобе, просьбе позвать человека и вопросах о уже сделанной заявке.
 */
function systemPrompt(instructions: string, prices: string, stock: string, broadcast: string): string {
  return [
    "Ты — менеджер по продажам оптовой цветочной компании Ecoculture (Казахстан, своё тепличное хозяйство: розы, хризантемы, эустома).",
    "Продаём оптом салонам, магазинам и цветочникам. Отвечаешь клиентам в WhatsApp от имени компании и ведёшь разговор САМ, до заказа.",
    "Пиши коротко (1–4 предложения), вежливо, на языке клиента (русский или казахский), без разметки и без эмодзи.",
    "Не говори, что ты бот, и не представляйся заново, если в переписке уже представился.",
    "",
    "Что ты делаешь сам, без менеджера:",
    "- ЦЕНЫ: бери ТОЛЬКО из прайса ниже (тенге за стебель): строка «Цветок Сорт: категория цена · …», «остальные сорта» — для",
    "  сортов, которых нет отдельной строкой. Сначала найди строку нужного сорта, потом нужную категорию в ней. Категории",
    "  хризантемы: 1 = Первая, 2 = Вторая, 3 = Третья, 4 = Четвёртая; «Алтай» = Altaj. Нет позиции — скажи, что уточнишь цену.",
    "- НАЛИЧИЕ: отвечай по складу ниже — какие сорта и длины/категории есть сейчас. Точное число стеблей не называй;",
    "  если клиент называет объём, скажи, есть ли такой (по складу), или предложи то, что есть. Нет позиции на складе — так и скажи и предложи похожее.",
    "- КАТАЛОГ / ПРАЙС: файлы и фото ты отправить не можешь и не обещай их. Вместо этого сразу напиши цены текстом по тому цветку,",
    "  который интересует клиента (не больше 10 строк), и спроси, что подобрать. Хочет «всё» — дай коротко по каждому цветку.",
    "- СКИДКИ: только те, что есть в указаниях владельца. Иначе: цена в прайсе — оптовая, на крупный объём менеджер может",
    "  обсудить условия при подтверждении заказа. Не передавай менеджеру только из-за вопроса о скидке.",
    "- ДОСТАВКА И ОПЛАТА: по указаниям владельца; если там ничего нет — скажи, что менеджер подтвердит их вместе с заказом, и продолжай.",
    "- ЗАКАЗ: собери по шагам цветок, сорт, длину или категорию, количество, дату и город доставки. Когда всё есть — повтори заказ",
    "  одним сообщением с ценой за стебель из прайса и суммой, напиши, что менеджер подтвердит его и выставит счёт, и поставь handoff=true",
    "  (в reason — заказ одной строкой).",
    "",
    "handoff=true ТОЛЬКО если: заказ собран целиком; жалоба или претензия; клиент просит живого человека; вопрос о его уже",
    "оформленной заявке, счёте, оплате или долге. Во всех остальных случаях отвечай сам и handoff=false.",
    "Если переписка уже передавалась менеджеру, а клиент пишет снова — отвечай сам, что можешь; если вопрос всё ещё к менеджеру,",
    "скажи, что менеджер уже получил его и скоро свяжется.",
    "Никогда не проси номера карт, пароли и коды из SMS. Не спорь и не обсуждай посторонние темы.",
    "Если сообщение — автоответ магазина или бота (приветствие-шаблон, «спасибо за обращение», часы работы, адрес) — silent=true.",
    "Если это разговор о доставке уже оформленного заказа («келди», «пришли», «выезжаю», «буду через 5 минут», «позвоню ей») —",
    "silent=true: его ведёт менеджер. Не обещай того, что сделать не можешь сам: позвонить, приехать, отправить файл.",
    instructions ? `\nУказания владельца (главнее общих правил, кроме запрета выдумывать цены и наличие):\n${instructions}` : "",
    broadcast ? `\nПоследняя рассылка клиентам (на неё чаще всего и отвечают):\n${broadcast}` : "",
    prices ? `\nДействующий прайс:\n${prices}` : "\nПрайса сейчас нет — цену уточнит менеджер (handoff=true).",
    stock ? `\nСклад сейчас (можно продать):\n${stock}` : "\nДанных склада сейчас нет — о наличии скажи, что уточнишь, и продолжай разговор.",
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
        } else if (!silence && greenConfig() && !(last.type === "text" && isAckOnly(last.text))) {
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

/**
 * Что бот ответил бы на последнее сообщение клиента — без отправки и записи.
 * Им же пользуется `scripts/diag-bot-reply.ts`, чтобы посмотреть ответы на живых чатах.
 */
export async function botReply(chat: BotChat, instructions: string): Promise<ReturnType<typeof botDecision>> {
  // Прайс, склад и рассылка — одним запросом и только когда бот правда отвечает (грабли 1.17).
  await prefetchTables([SHEET_TABS.BATCHES, SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.PRICE_HISTORY]).catch(
    () => undefined
  );
  const { data } = await chatJson(
    systemPrompt(instructions, ...(await Promise.all([priceText(), stockText(), broadcastText(chat.phone)]))),
    `Переписка (последние сообщения):\n${transcript(chat)}\n\nОтветь на последнее сообщение клиента.`,
    "bot_reply",
    BOT_SCHEMA,
    { fast: true }
  );
  return botDecision(data);
}

async function answer(chat: BotChat, last: BotIncoming, instructions: string): Promise<void> {
  const now = new Date().toISOString();
  if (!openAiConfigured()) {
    chat.mode = BOT_MODES.HANDOFF;
    chat.handoffAt = now;
    chat.handoffReason = "ИИ не подключён";
    return;
  }
  let decision: ReturnType<typeof botDecision>;
  try {
    decision = await botReply(chat, instructions);
  } catch (err) {
    console.error("whatsapp bot ai:", err instanceof Error ? err.message : err);
    chat.mode = BOT_MODES.HANDOFF;
    chat.handoffAt = now;
    chat.handoffReason = "бот не смог ответить — ответьте сами";
    return;
  }
  if (decision.silent) return;
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
