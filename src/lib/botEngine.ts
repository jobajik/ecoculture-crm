import { commitAtomic, prefetchTables, SHEET_TABS, type WriteOp } from "./sheets";
import { localDayKey } from "./timezone";
import { getCurrentPrices } from "./repo/prices";
import { listBatches } from "./repo/batches";
import { almatyHourOf, botStoreFor, botStoreNote, inStore } from "./officeStore";
import { staffPhoneKeys } from "./botSalesAlert";
import { getSettings } from "./repo/settings";
import { botChatWrite, emptyBotChat, listBotChats, listBroadcasts, listRecipients, settingsMap } from "./repo/broadcasts";
import { harvestForBot, lastBroadcastForBot, pricesForBot, stockForBot, stockMap } from "./botKnowledge";
import { listHarvestForecast } from "./repo/harvestForecast";
import { listWaMessages } from "./repo/talks";
import { readTable } from "./sheets";
import { REPEAT_TASK, mergeChatMemory, missingIncoming, repeatsOurMessage, supersededBy, withMissingIncoming } from "./botTurn";
import { BOT_ORDER_SCHEMA, toWhatsApp } from "./botOrder";
import { botClientContext, cancelBotOrder, placeBotOrder, reissueBotInvoices } from "./botOrderRunner";
import {
  BOT_MODES,
  BOT_OPT_OUT_TEXT,
  EMPTY_NUDGE,
  botDecision,
  botSettingsFrom,
  botSilenceReason,
  chatTranscript,
  isAckOnly,
  isOptOutText,
  pushContext,
  type BotChat,
} from "./broadcast";
import { chatJson, openAiConfigured } from "./openai";
import { greenConfig, sendFileByUrl, sendText } from "./greenApi";
import { catalogFiles } from "./catalogFiles";
import { loadPhotoContext, rotationPhoto } from "./botPhotoSend";
import { photoLabel, pickItemPhoto, type BotPhoto } from "./botPhotos";
import { botPhotoSentWrite, listBotPhotos } from "./repo/botPhotos";
import { photoFileUrl } from "./catalogFiles";
import { FLOWER_TYPE_LABELS } from "./constants";
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
  required: ["reply", "order", "kaspiPhone", "invoiceAgain", "cancelOrder", "photo", "catalog", "alert", "silent"],
  properties: {
    reply: { type: "string", description: "Ответ клиенту: коротко, по делу, на его языке, с вопросом, который ведёт к заказу." },
    order: BOT_ORDER_SCHEMA,
    kaspiPhone: {
      type: "string",
      description: "Клиент назвал номер для счёта Kaspi (другой, чем этот WhatsApp, или после «счёт не дошёл») — только цифры. Иначе пусто.",
    },
    invoiceAgain: {
      type: "boolean",
      description: "true — клиент просит выставить счёт Kaspi ещё раз на тот же номер (отклонил случайно, счёт истёк). Иначе false.",
    },
    cancelOrder: {
      type: "string",
      description:
        "Номер заказа (из «О клиенте»), который клиент просит отменить, или который заменяется новым заказом (поменять количество, сорт, дату). Иначе пусто.",
    },
    photo: {
      type: "object",
      additionalProperties: false,
      required: ["flowerType", "variety", "grade"],
      description:
        "О какой позиции твой ответ (предлагаешь её или клиент о ней спрашивает) — система приложит её фото из теплицы, ответ уйдёт подписью к фото. Нет конкретной позиции — пустые строки.",
      properties: {
        flowerType: { type: "string", enum: ["", "rose", "chrysanthemum", "eustoma"] },
        variety: { type: "string" },
        grade: { type: "string" },
      },
    },
    catalog: {
      type: "string",
      enum: ["", "all", "rose", "chrysanthemum", "eustoma"],
      description: "Клиент просит каталог, фото, прайс картинкой или «что есть» с фото — какой цветок (all — все). Иначе пусто.",
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

/**
 * Что сейчас есть на складе — для подсказки модели. До 12:00 — основной склад;
 * после — два списка: «сегодня из офиса» и «на завтра» с основного (подсклад
 * «Офис», `officeStore.ts`). Сбой — пусто, бот тогда о наличии не говорит.
 */
async function stockText(): Promise<{ text: string; storeNote: string }> {
  try {
    const now = new Date();
    const hour = almatyHourOf(now);
    const [batches, settings] = await Promise.all([listBatches(), getSettings()]);
    const office = inStore(batches, "office");
    const main = inStore(batches, "");
    const officeToday = botStoreFor(hour, stockMap(office, settings, now).size > 0) === "office";
    if (!officeToday) return { text: stockForBot(main, settings, now), storeNote: botStoreNote(false, hour) };
    return {
      text: `Сегодня, из офиса:\n${stockForBot(office, settings, now)}\n\nНа завтра и позже (основной склад):\n${stockForBot(main, settings, now)}`,
      storeNote: botStoreNote(true, hour),
    };
  } catch {
    return { text: "", storeNote: "" };
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
function systemPrompt(p: {
  instructions: string;
  prices: string;
  stock: string;
  /** С какого склада сейчас продаём и когда доставка (`botStoreNote`). */
  storeNote?: string;
  broadcast: string;
  client: string;
  today: string;
  /** План срезки агронома на ближайшие недели (`harvestForBot`). */
  harvest?: string;
}): string {
  const { instructions, prices, stock, broadcast, client, today, harvest } = p;
  const weekday = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"][new Date(`${today}T12:00:00`).getDay()];
  return [
    "Ты — сильный продавец оптовой цветочной компании Ecoculture (Казахстан, своё тепличное хозяйство: розы, хризантемы, эустома).",
    "Продаём оптом салонам, магазинам и цветочникам. Пишешь клиентам в WhatsApp от имени компании. Твоя единственная цель — ПРОДАТЬ:",
    "довести разговор до подтверждённого заказа. Ты НИКОГДА не передаёшь разговор менеджеру и не пишешь «передам менеджеру»,",
    "«менеджер свяжется», «менеджер ответит» — ты сам и есть менеджер в этом чате.",
    "",
    "Стиль: как живой человек в WhatsApp — коротко, тепло, по-разному, на языке клиента (русский или казахский).",
    "Начинай естественно («Да, есть!», «Конечно», «Смотрите», «Отлично») и НИКОГДА не повторяй уже сказанное в переписке:",
    "ни приветствие, ни цены, ни состав заказа, ни ту же фразу — если это уже было, просто двигайся дальше.",
    "Оформление WhatsApp — НЕ стеной текста: 1–3 коротких блока через пустую строку; две и больше позиции или цены —",
    "списком, каждая с новой строки «• Хризантема Altaj, Третья — 270 ₸»; сумму заказа и номер заказа выделяй *звёздочками*",
    "(жирный WhatsApp, не больше двух выделений); вопрос к клиенту — последней строкой отдельно. Не используй # и **.",
    "Не повторяй состав заказа в каждом сообщении: повторил один раз — дальше спрашивай только то, чего не хватает.",
    "НЕ обращайся к клиенту по имени — имя в WhatsApp часто чужое (магазин, муж, сотрудник). Только «Здравствуйте» или без обращения.",
    "Не говори, что ты бот. Не здоровайся заново, если уже здоровался в переписке.",
    "Перерыв в переписке («— перерыв N дн. —») — это НОВЫЙ разговор: на «Здравствуйте» поздоровайся и коротко скажи,",
    "что есть сегодня, с ценой. Старое предложение до перерыва не продолжай так, будто оно сейчас, и не отвечай на него",
    "«нет на складе» — клиент о нём не спрашивал.",
    "Вопросов — минимум (владелец, 02.10: «не нравится, что задаёшь много вопросов и пишешь одинаковые сообщения»): не больше",
    "одного и только если без ответа клиента не двинуться дальше. Ответил клиент — действуй, а не переспрашивай.",
    "",
    "Как продавать:",
    "- ГЛАВНОЕ: клиент сам назвал, что хочет (цветок, категорию или сорт и количество или «коробку») — НЕ задавай уточняющих",
    "  вопросов и не предлагай варианты на выбор («50 или 100?»). Сорт не назван — возьми ходовой со склада в этой категории.",
    "  День — сегодня, если просит сегодня, иначе завтра. Точка и город известны (клиент в базе или назвал) — это уже заказ:",
    "  СРАЗУ order.confirmed=true, без «Оформляю?» (владелец, 02.10: «просто выставь счёт и оформляй, хватит вопросы задавать»).",
    "  Не хватает только точки и города — спроси их одним коротким вопросом и после ответа сразу оформляй.",
    "  Сколько штук в коробке — только из указаний владельца; не знаешь — не выдумывай, считай в штуках.",
    "- На любой вопрос сначала ДАЙ ОТВЕТ по существу (цена, наличие), потом сразу предложение. Вопрос «что есть в наличии» —",
    "  перечисли 3–5 позиций со склада с ценами, первым — товар из рассылки, и спроси, что поставить.",
    "- «Да», «интересно», «давайте» — не переспрашивай общими словами, а сразу предложи конкретное: сорт, категорию, цену, объём",
    "  (для пробы 50–100 стеблей) и спроси «Оформляем?».",
    "- Предлагай КОНКРЕТНО то, что есть на складе. Мало на складе — честно скажи «осталось немного», это повод решить сейчас.",
    "- Клиенту нужно БОЛЬШЕ, чем есть в одной строке склада (09.10, владелец: «почему повторяешься, а не предлагаешь новое?»):",
    "  НЕ предлагай меньший объём одной длины. В складе у сорта перечислены ВСЕ длины и «всего» — смотри всю строку сорта:",
    "  длину клиент не назвал — предлагай ту длину, которой хватает на объём (или две-три длины вместе), а не самую короткую;",
    "  не хватает и так — добери другим сортом из склада, с ценами и суммой. Кустовые (Spray, Bubbles) — не обычные розы:",
    "  просят «обычные, не кустовые» — их не предлагай. Всё равно не хватает или сорта нет вовсе — скажи прямо «сейчас",
    "  столько нет» и назови, когда этот сорт ожидается по плану срезки ниже: даты недели и количество бери ТОЛЬКО из",
    "  строки этого сорта в плане, не выдумывай. Это прогноз — не обещай день и длину. Предложи взять что есть сейчас, а",
    "  остальное — к срезке, и заполни alert («предзаказ: сорт, количество, город»), чтобы менеджер увидел.",
    "- Клиент возразил на твоё предложение («зачем мне 100», «не то», «нет такого») — следующий ответ ОБЯЗАН быть другим",
    "  предложением. Повторить своё прошлое сообщение — худшая ошибка.",
    "- Допродажа: когда клиент выбрал — один раз предложи добавить второе (другую категорию, эустому, розы) к той же доставке.",
    "- «Дорого» — предложи дешевле: категорию ниже, другой сорт, мини-микс, и посчитай сумму. «Подумаю» — спроси, что смущает,",
    "  предложи пробную партию. «Беру у другого» — предложи сравнить на пробной партии: свежий срез с нашей теплицы.",
    "- «Скидка» — только то, что есть в указаниях владельца; иначе: цена уже оптовая, на крупный объём посчитаем при оформлении",
    "  счёта, — и сразу спроси объём.",
    "- Явный отказ («не надо», «не интересно», «не пишите») — вежливо попрощайся одной фразой без давления.",
    "- Отвечаешь про конкретную позицию (клиент о ней спросил или ты её предлагаешь) — заполни photo: цветок, сорт и категорию.",
    "  Система приложит живое фото этой позиции из теплицы, а твой reply уйдёт ПОДПИСЬЮ к фото — пиши его как подпись:",
    "  коротко, что за позиция, цена и одна живая деталь. Спрашивают «есть фото хризантемы второго сорта?» — это photo,",
    "  а не catalog. Не пиши «отправляю фото» и не обещай фото — оно придёт само, если есть.",
    "- Просят каталог, прайс картинкой или фото «всего, что есть» — заполни catalog (цветок или all): система сама пришлёт",
    "  каталог JPEG с ценами и фото из теплицы. В reply тогда только короткая фраза после картинок, цены текстом не дублируй.",
    "- Условия доставки — по указаниям владельца; чего там нет, не выдумывай: «уточним при сборке» — и дальше к заказу.",
    "",
    "Цены — ТОЛЬКО из прайса ниже (тенге за стебель): строка «Цветок Сорт: категория цена · …», «остальные сорта» — для сортов без",
    "своей строки. Сначала найди строку сорта, потом категорию. Категории хризантемы: 1 = Первая, 2 = Вторая, 3 = Третья,",
    "4 = Четвёртая; «Алтай» = Altaj. У хризантемы «второй сорт», «2 сорт», «вторая» — это КАТЕГОРИЯ Вторая, а не сорт-название.",
    "Названной категории нет на складе — скажи прямо и предложи ближайшую, назвав её своим именем («второй сейчас нет, есть третья»),",
    "не выдавай одну категорию за другую. Позиции нет в прайсе — не выдумывай, предложи похожую с ценой. Сумму считай точно.",
    "Наличие — ТОЛЬКО по складу ниже; точное число стеблей не называй, но подтверждай, хватит ли на названный объём.",
    "",
    "ЗАКАЗ ТЫ ОФОРМЛЯЕШЬ САМ, полностью: заявка уходит на склад, счёт Kaspi — клиенту на этот номер WhatsApp.",
    "1) Собери по каждой позиции: цветок, сорт, категорию или длину, количество; дату доставки; для нового клиента — название точки",
    "   и город (см. «О клиенте»). Адрес и пожелания — если назовёт.",
    "2) Клиент ещё выбирает (не назвал позицию или количество) — предложи конкретное с ценой и суммой и спроси «Оформляю?».",
    "3) Клиент сказал, что берёт («да», «давайте», «хорошо», «нужно 200 шт.», «одна коробка», назвал точку или как доставить) —",
    "   заказ: заполни order: confirmed=true, позиции ТОЧНО как в складе",
    "   (flowerType: rose / chrysanthemum / eustoma, сорт и категорию/длину — как написано в складе), deliveryDate ГГГГ-ММ-ДД, city,",
    "   shopName, address, note. Тогда reply не нужен: подтверждение с номером заказа и счётом отправит система сама.",
    "   Дважды не переспрашивай: согласие в любой форме — оформляй. Не ставь confirmed=true при отказе или сомнении",
    "   («подумаю», «дорого», «не сейчас») и не повторяй уже оформленный заказ.",
    "4) Хочет добавить к оформленному — оформи ДОПОЛНИТЕЛЬНЫЙ заказ только с новыми позициями (тоже через подтверждение).",
    "5) Счёт Kaspi уходит на номер этого WhatsApp. Клиент хочет на другой номер или счёт не дошёл и он прислал номер — kaspiPhone.",
    "5а) Клиент ОТКЛОНИЛ счёт (см. «О клиенте») — не дави и не выставляй молча: узнай, что не так. Ответил:",
    "   «выставьте ещё раз» / «случайно» — invoiceAgain=true; другой номер — kaspiPhone; поменять количество, сорт или",
    "   дату — повтори НОВЫЙ заказ целиком и после «да» заполни order (confirmed=true) и cancelOrder=номер старого заказа;",
    "   передумал, не нужно — cancelOrder=номер заказа и вежливо попрощайся, предложив написать, когда понадобятся цветы.",
    "6) Оплатил — поблагодари: оплата придёт в систему сама, и ты напишешь, когда заказ уйдёт на сборку. Не подтверждай оплату сам.",
    "   Хочет платить наличными или по реквизитам — согласись, заполни alert («оплата наличными/по реквизитам»), заказ всё равно оформляй.",
    "Доставка — завтра и позже обычно; сегодня — только если клиент просит (после 12:00 из офиса — сегодня, см. ниже), не обещай время.",
    "Жалоба или клиент прямо просит живого человека — извинись или согласись, скажи, что разберёмся, задай уточняющий",
    "вопрос и заполни alert. Разговор продолжаешь ты.",
    "",
    "silent=true — только если: автоответ магазина или бота (шаблон, часы работы, адрес); кивок без вопроса; разговор о доставке",
    "уже оформленного заказа («келди», «пришли», «выезжаю», «буду через 5 минут»). Не обещай позвонить, приехать или прислать файл.",
    "Никогда не проси номера карт, пароли и коды из SMS. Не обсуждай посторонние темы.",
    `\nСегодня ${today}, ${weekday} (Алматы). «Завтра», «в пятницу» переводи в дату сам.`,
    ...(p.storeNote ? [p.storeNote] : []),
    client ? `\nО клиенте:\n${client}` : "",
    instructions ? `\nУказания владельца (главнее общих правил, кроме запрета выдумывать цены и наличие):\n${instructions}` : "",
    broadcast ? `\nРассылка, которую получил этот клиент (на неё он, скорее всего, и отвечает):\n${broadcast}` : "",
    prices ? `\nДействующий прайс:\n${prices}` : "\nПрайса сейчас нет — цены не называй, предлагай по наличию и спрашивай объём.",
    stock ? `\nСклад сейчас (можно продать):\n${stock}` : "\nДанных склада сейчас нет — о наличии не обещай, спрашивай, что нужно.",
    harvest
      ? `\nПлан срезки агронома (прогноз, стеблей за неделю по сорту, без длины; продать можно только то, что уже на складе):\n${harvest}`
      : "",
  ].join("\n");
}

function transcript(chat: BotChat): string {
  return chatTranscript(chat.context);
}

/**
 * Разобрать входящие одного уведомления: отметить, где писал человек,
 * отписку, и, если бот должен ответить, — ответить. Ничего не бросает.
 */
export async function runBot(all: BotIncoming[]): Promise<boolean> {
  let answered = false;
  // Эхо наших же сообщений через API (рассылка, сам бот) ничего не меняет —
  // и таблицу ради него не читаем (лимит общий, грабли 1.17).
  const messages = all.filter((m) => !(m.isEcho && m.fromApi));
  if (messages.length === 0) return false;
  try {
    await prefetchTables([SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS]);
    const [chats, map] = await Promise.all([listBotChats(true), settingsMap()]);
    const settings = botSettingsFrom(map);
    const byKey = new Map(chats.map((c) => [phoneKey(c.phone), c]));

    // Сотрудникам (сводка, продажи бота) бот не отвечает.
    const staff = staffPhoneKeys(map);
    const phones = Array.from(new Set(messages.map((m) => phoneKey(m.phone)).filter(Boolean))).filter((k) => !staff.has(k));
    const writes: WriteOp[] = [];
    const pending: { chat: BotChat; existing: (BotChat & { rowNumber: number }) | null }[] = [];
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
        // Клиент ответил — дожим этого разговора начинается заново.
        chat.nudge = { ...EMPTY_NUDGE };
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
          if (await answer(chat, last, settings.instructions)) answered = true;
        }
      }
      if (changed) pending.push({ chat, existing });
    }
    // Пока этот ход думал, соседнее уведомление того же номера могло записать память — объединить, а
    // не затереть (иначе бот забывал свой же ответ). Одно свежее чтение, только если есть что писать.
    if (pending.length > 0) {
      const fresh = await listBotChats(true).catch(() => [] as Awaited<ReturnType<typeof listBotChats>>);
      for (const { chat, existing } of pending) {
        const now = fresh.find((c) => phoneKey(c.phone) === phoneKey(chat.phone)) ?? null;
        writes.push(botChatWrite(mergeChatMemory(chat, now), now?.rowNumber ?? existing?.rowNumber ?? null));
      }
    }
    if (writes.length > 0) await commitAtomic(writes);
  } catch (err) {
    console.error("whatsapp bot:", err instanceof Error ? err.message : err);
  }
  return answered;
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
 * Что бот ответил бы на последнее сообщение клиента — решение модели, без
 * отправки и записи. Им же пользуется `scripts/diag-bot-reply.ts`.
 */
/** Подсказка модели и переписка — то, что бот видит перед ответом (её же печатает `bot-redo --prompt`). */
export async function botPrompt(
  chat: BotChat,
  instructions: string,
  task = "Ответь на последнее сообщение клиента."
): Promise<{ system: string; user: string }> {
  // Прайс, склад, рассылка и заказы — одним запросом и только когда бот правда отвечает (грабли 1.17).
  await prefetchTables([
    SHEET_TABS.BATCHES,
    SHEET_TABS.BROADCASTS,
    SHEET_TABS.BROADCAST_RECIPIENTS,
    SHEET_TABS.PRICE_HISTORY,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.LEADS,
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.KASPI_INVOICES,
    SHEET_TABS.HARVEST_FORECAST,
  ]).catch(() => undefined);
  const [prices, stockInfo, broadcast, client, harvest] = await Promise.all([
    priceText(),
    stockText(),
    broadcastText(chat.phone),
    botClientContext(chat.phone),
    listHarvestForecast()
      .then((rows) => harvestForBot(rows, localDayKey()))
      .catch(() => ""),
  ]);
  return {
    system: systemPrompt({ instructions, prices, stock: stockInfo.text, storeNote: stockInfo.storeNote, broadcast, client, today: localDayKey(), harvest }),
    user: `Переписка (последние сообщения):\n${transcript(chat)}\n\n${task}`,
  };
}

export async function botReply(
  chat: BotChat,
  instructions: string,
  /** Своё задание вместо «ответь на последнее сообщение» — дожим молчащего (`botNudge.ts`). */
  task = "Ответь на последнее сообщение клиента."
): Promise<ReturnType<typeof botDecision>> {
  const { system, user } = await botPrompt(chat, instructions, task);
  const { data } = await chatJson(system, user, "bot_reply", BOT_SCHEMA, { fast: true });
  return botDecision(data);
}

/**
 * Решение модели → дело: оформить подтверждённый заказ, перевыставить счёт на
 * новый номер Kaspi. Возвращает текст клиенту (пусто — молчать) и записку менеджеру.
 */
export async function botAct(
  chat: BotChat,
  decision: ReturnType<typeof botDecision>
): Promise<{ text: string; note: string; files: BotFile[] }> {
  if (decision.silent) return { text: "", note: "", files: [] };
  let text = decision.reply;
  const notes: string[] = decision.alert ? [`внимание: ${decision.alert}`] : [];
  // Отмена — первой: если следом новый заказ (клиент поменял количество), старый не должен висеть рядом.
  let cancelledText = "";
  if (decision.cancelOrder) {
    const c = await cancelBotOrder(chat.phone, decision.cancelOrder);
    if (c.note) notes.unshift(c.note);
    if (c.text) cancelledText = c.text;
    if (!decision.order.confirmed && c.text) text = c.cancelled && decision.reply ? `${c.text} ${decision.reply}` : c.text;
  }
  if (decision.order.confirmed) {
    const placed = await placeBotOrder({ phone: chat.phone, senderName: chat.name, draft: decision.order, kaspiPhone: decision.kaspiPhone });
    text = cancelledText ? `${cancelledText}\n${placed.text}` : placed.text;
    if (placed.note) notes.unshift(placed.note);
  } else if (decision.kaspiPhone || decision.invoiceAgain) {
    const again = await reissueBotInvoices(chat.phone, decision.kaspiPhone);
    if (again) text = again;
  }
  const files = decision.catalog ? await catalogForChat(decision.catalog) : [];
  let out = toWhatsApp(text);
  // Ответ про конкретную позицию — с её фото из теплицы, ответ подписью (как сделал бы человек).
  if (!files.length && out && !decision.order.confirmed && decision.photo.flowerType && out.length <= 1024) {
    const pic = await itemPhotoFor(chat, decision.photo, out);
    if (pic) {
      files.push(pic);
      out = "";
    }
  }
  return { text: out, note: notes.join("; "), files };
}

/** Картинка от бота: ссылка для Green API, имя файла, подпись и что записать в память чата. */
export interface BotFile {
  url: string;
  name: string;
  caption: string;
  memo: string;
}

/**
 * Клиент попросил каталог или фото: страницы каталога (цветок или все) и одно
 * фото из ротации с продающей подписью и ценами. Сбой — пусто: бот ответит
 * текстом, а не замолчит.
 */
async function catalogForChat(which: string): Promise<BotFile[]> {
  try {
    const flower = which === "all" ? "" : which;
    const out: BotFile[] = (await catalogFiles(flower)).map((c) => ({
      url: c.url,
      name: c.name,
      caption: "",
      memo: `[каталог: ${FLOWER_TYPE_LABELS[c.flowerType] ?? c.flowerType}]`,
    }));
    const ctx = await loadPhotoContext();
    const r = rotationPhoto(ctx, { flowers: flower ? [flower] : [], question: "" });
    if (r) {
      out.push({ url: r.url, name: r.name, caption: r.caption, memo: `[фото: ${photoLabel(r.photo)}] ${r.caption}` });
      await commitAtomic([r.after]).catch(() => undefined);
    }
    return out;
  } catch (err) {
    console.error("bot catalog:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Фото позиции с ответом в подписи; отмечает отправку для ротации. Нет фото или сбой — null. */
async function itemPhotoFor(chat: BotChat, item: { flowerType: string; variety: string; grade: string }, caption: string): Promise<BotFile | null> {
  try {
    const photos = await listBotPhotos();
    const recent = chat.context.map((m) => m.text).join("\n");
    const photo = pickItemPhoto(photos, item, recent) as (BotPhoto & { rowNumber: number }) | null;
    if (!photo) return null;
    await commitAtomic([botPhotoSentWrite(photo)]).catch(() => undefined);
    // В память чата — и подпись фото, чтобы этому человеку то же фото второй раз не ушло.
    return { url: photoFileUrl(photo), name: photo.fileName || "photo.jpg", caption, memo: `[фото: ${photoLabel(photo)} — ${photo.caption.slice(0, 40)}] ${caption}` };
  } catch (err) {
    console.error("bot item photo:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Отправить картинки бота и запомнить их в памяти чата. Возвращает, сколько ушло. */
export async function sendBotFiles(chat: BotChat, phone: string, files: BotFile[]): Promise<number> {
  const cfg = greenConfig();
  if (!cfg || files.length === 0) return 0;
  let sent = 0;
  for (const f of files) {
    try {
      const id = await sendFileByUrl(cfg, phone, f.url, f.name, f.caption);
      chat.ourIds = [...chat.ourIds, id].slice(-20);
      chat.context = pushContext(chat.context, { role: "us", text: f.memo, at: new Date().toISOString() });
      sent += 1;
    } catch (err) {
      console.error("whatsapp bot file:", err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

/** Ответил ли бот (тогда заказ ведёт он, и черновик для менеджера не нужен). */
/** Сколько ждать, не допишет ли клиент ещё (серия «Нет сорта Джулия…» + «Белая» шла через 4 с). */
const SERIES_WAIT_MS = 4000;

/** Свежие сообщения этого номера из WaMessages (их пишет вебхук до бота) — одно чтение. */
async function recentTurnMessages(phone: string): Promise<{ messageId: string; phone: string; direction: string; at: string; text: string; type: string }[]> {
  try {
    await readTable(SHEET_TABS.WA_MESSAGES, { fresh: true });
    const key = phoneKey(phone);
    const from = new Date(Date.now() - 20 * 60_000).toISOString();
    return (await listWaMessages()).filter((m) => phoneKey(m.phone) === key && m.at >= from);
  } catch {
    return [];
  }
}

async function answer(chat: BotChat, last: BotIncoming, instructions: string): Promise<boolean> {
  if (!openAiConfigured()) return false;
  // Серия сообщений — один ответ, и он видит их все (`botTurn.ts`).
  await new Promise((r) => setTimeout(r, SERIES_WAIT_MS));
  const recent = await recentTurnMessages(last.phone);
  const newer = supersededBy(last, recent, last.phone);
  if (newer) return false;
  chat.context = withMissingIncoming(chat.context, missingIncoming(chat.context, recent, last.phone, new Date()));
  let decision: ReturnType<typeof botDecision>;
  try {
    decision = await botReply(chat, instructions);
    // Ответ слово в слово повторяет уже отправленное — переспросить модель один раз с объяснением.
    if (!decision.silent && !decision.order.confirmed && repeatsOurMessage(decision.reply, chat.context)) {
      decision = await botReply(chat, instructions, REPEAT_TASK);
    }
  } catch (err) {
    console.error("whatsapp bot ai:", err instanceof Error ? err.message : err);
    return false;
  }
  if (!decision.silent && !decision.order.confirmed && repeatsOurMessage(decision.reply, chat.context)) {
    // Тот же текст второй раз не уходит: лучше записка менеджеру, чем клиенту одно и то же.
    noteForManager(chat, "внимание: бот не нашёл, что ответить, кроме повтора — ответьте клиенту сами");
    return false;
  }
  const { text, note, files } = await botAct(chat, decision);
  const filesSent = await sendBotFiles(chat, last.phone, files);
  if (!text && !filesSent) return false;
  const sent = text ? await reply(chat, last, text) : true;
  if (!sent && !filesSent) return false;
  // Предел ответов — на один разговор: после суток тишины счёт заново, иначе
  // постоянный клиент через месяц упёрся бы в предел навсегда.
  const quietMs = Date.now() - Date.parse(chat.updatedAt || "");
  if (!Number.isFinite(quietMs) || quietMs >= 24 * 3600000) chat.botReplies = 0;
  chat.botReplies += 1;
  noteForManager(chat, note);
  return true;
}

/**
 * Записка менеджеру: собранный заказ или тревога. Режим чата остаётся «бот» —
 * бот продолжает разговор; записка видна на странице «Бот» в «Заказы и тревоги».
 */
export function noteForManager(chat: BotChat, note: string): void {
  if (chat.mode !== BOT_MODES.OPT_OUT) chat.mode = BOT_MODES.BOT;
  if (!note) return;
  chat.handoffAt = new Date().toISOString();
  chat.handoffReason = note.slice(0, 500);
}
