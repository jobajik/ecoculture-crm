import { commitAtomic, prefetchTables, SHEET_TABS, type WriteOp } from "./sheets";
import { localDayKey } from "./timezone";
import { getCurrentPrices } from "./repo/prices";
import { listBatches } from "./repo/batches";
import { getSettings } from "./repo/settings";
import { botChatWrite, emptyBotChat, listBotChats, listBroadcasts, listRecipients, settingsMap } from "./repo/broadcasts";
import { lastBroadcastForBot, pricesForBot, stockForBot } from "./botKnowledge";
import {
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
  required: ["reply", "order", "alert", "silent"],
  properties: {
    reply: { type: "string", description: "Ответ клиенту: коротко, по делу, на его языке, с вопросом, который ведёт к заказу." },
    order: {
      type: "string",
      description: "Клиент ПОДТВЕРДИЛ заказ — заказ одной строкой (цветок, сорт, категория, штуки, дата, город). Иначе пусто.",
    },
    alert: { type: "string", description: "Жалоба или клиент просит живого человека — одной фразой для менеджера. Иначе пусто." },
    silent: {
      type: "boolean",
      description: "true — не отвечать: автоответ магазина, кивок без вопроса, разговор о доставке уже оформленного заказа.",
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
 * Бот продаёт САМ, до конца (владелец, 01.10.2026: «твой бот не должен
 * переключать на менеджеров, он должен продать… сделай его максимально
 * продажным»). Менеджер получает только записку: собранный заказ или тревогу.
 */
function systemPrompt(instructions: string, prices: string, stock: string, broadcast: string): string {
  return [
    "Ты — сильный продавец оптовой цветочной компании Ecoculture (Казахстан, своё тепличное хозяйство: розы, хризантемы, эустома).",
    "Продаём оптом салонам, магазинам и цветочникам. Пишешь клиентам в WhatsApp от имени компании. Твоя единственная цель — ПРОДАТЬ:",
    "довести разговор до подтверждённого заказа. Ты НИКОГДА не передаёшь разговор менеджеру и не пишешь «передам менеджеру»,",
    "«менеджер свяжется», «менеджер ответит» — ты сам и есть менеджер в этом чате.",
    "",
    "Стиль: коротко (1–4 предложения), живо и уверенно, на языке клиента (русский или казахский), без разметки и без эмодзи.",
    "НЕ обращайся к клиенту по имени — имя в WhatsApp часто чужое (магазин, муж, сотрудник). Только «Здравствуйте» или без обращения.",
    "Не говори, что ты бот. Не здоровайся заново, если уже здоровался в переписке.",
    "КАЖДЫЙ ответ заканчивай вопросом, который двигает к заказу: «Сколько штук поставить?», «На какой день доставка?»,",
    "«Берёте высшую или первую?», «Оформляем?». Никогда не заканчивай разговор без следующего шага.",
    "",
    "Как продавать:",
    "- На любой вопрос сначала ДАЙ ОТВЕТ по существу (цена, наличие), потом сразу предложение. Вопрос «что есть в наличии» —",
    "  перечисли 3–5 позиций со склада с ценами, первым — товар из рассылки, и спроси, что поставить.",
    "- «Да», «интересно», «давайте» — не переспрашивай общими словами, а сразу предложи конкретное: сорт, категорию, цену, объём",
    "  (для пробы 50–100 стеблей) и спроси «Оформляем?».",
    "- Предлагай КОНКРЕТНО то, что есть на складе. Мало на складе — честно скажи «осталось немного», это повод решить сейчас.",
    "- Допродажа: когда клиент выбрал — один раз предложи добавить второе (другую категорию, эустому, розы) к той же доставке.",
    "- «Дорого» — предложи дешевле: категорию ниже, другой сорт, мини-микс, и посчитай сумму. «Подумаю» — спроси, что смущает,",
    "  предложи пробную партию. «Беру у другого» — предложи сравнить на пробной партии: свежий срез с нашей теплицы.",
    "- «Скидка» — только то, что есть в указаниях владельца; иначе: цена уже оптовая, на крупный объём посчитаем при оформлении",
    "  счёта, — и сразу спроси объём.",
    "- Явный отказ («не надо», «не интересно», «не пишите») — вежливо попрощайся одной фразой без давления.",
    "- Каталог и фото отправить не можешь и не обещай — сразу пиши цены текстом по интересующему цветку (до 10 строк).",
    "- Доставка и оплата — по указаниям владельца; чего там нет, не выдумывай: «уточним при оформлении счёта» — и дальше к заказу.",
    "",
    "Цены — ТОЛЬКО из прайса ниже (тенге за стебель): строка «Цветок Сорт: категория цена · …», «остальные сорта» — для сортов без",
    "своей строки. Сначала найди строку сорта, потом категорию. Категории хризантемы: 1 = Первая, 2 = Вторая, 3 = Третья,",
    "4 = Четвёртая; «Алтай» = Altaj. Позиции нет в прайсе — не выдумывай, предложи похожую с ценой. Сумму считай точно.",
    "Наличие — ТОЛЬКО по складу ниже; точное число стеблей не называй, но подтверждай, хватит ли на названный объём.",
    "",
    "Заказ: собери цветок, сорт, категорию или длину, количество, дату доставки и город. Когда клиент подтвердил — повтори заказ",
    "с ценами и суммой, скажи, что счёт придёт сюда же, и заполни order. После этого продолжай: допродажа или вопрос про оплату.",
    "Жалоба или клиент прямо просит живого человека — извинись или согласись, скажи, что сейчас разберёмся, задай уточняющий",
    "вопрос и заполни alert. Разговор продолжаешь ты.",
    "",
    "silent=true — только если: автоответ магазина или бота (шаблон, часы работы, адрес); кивок без вопроса; разговор о доставке",
    "уже оформленного заказа («келди», «пришли», «выезжаю», «буду через 5 минут»). Не обещай позвонить, приехать или прислать файл.",
    "Никогда не проси номера карт, пароли и коды из SMS. Не обсуждай посторонние темы.",
    instructions ? `\nУказания владельца (главнее общих правил, кроме запрета выдумывать цены и наличие):\n${instructions}` : "",
    broadcast ? `\nРассылка, которую получил этот клиент (на неё он, скорее всего, и отвечает):\n${broadcast}` : "",
    prices ? `\nДействующий прайс:\n${prices}` : "\nПрайса сейчас нет — цены не называй, предлагай по наличию и спрашивай объём.",
    stock ? `\nСклад сейчас (можно продать):\n${stock}` : "\nДанных склада сейчас нет — о наличии не обещай, спрашивай, что нужно.",
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
  if (!openAiConfigured()) return;
  let decision: ReturnType<typeof botDecision>;
  try {
    decision = await botReply(chat, instructions);
  } catch (err) {
    console.error("whatsapp bot ai:", err instanceof Error ? err.message : err);
    return;
  }
  if (decision.silent) return;
  const sent = await reply(chat, last, decision.reply);
  if (!sent) return;
  // Предел ответов — на один разговор: после суток тишины счёт заново, иначе
  // постоянный клиент через месяц упёрся бы в предел навсегда.
  const quietMs = Date.now() - Date.parse(chat.updatedAt || "");
  if (!Number.isFinite(quietMs) || quietMs >= 24 * 3600000) chat.botReplies = 0;
  chat.botReplies += 1;
  noteForManager(chat, decision);
}

/**
 * Записка менеджеру: собранный заказ или тревога. Режим чата остаётся «бот» —
 * бот продолжает разговор; записка видна на странице «Бот» в «Заказы и тревоги».
 */
export function noteForManager(chat: BotChat, decision: { order: string; alert: string }): void {
  if (chat.mode !== BOT_MODES.OPT_OUT) chat.mode = BOT_MODES.BOT;
  const note = decision.order ? `заказ: ${decision.order}` : decision.alert ? `внимание: ${decision.alert}` : "";
  if (!note) return;
  chat.handoffAt = new Date().toISOString();
  chat.handoffReason = note;
}
