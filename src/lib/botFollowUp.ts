import { listSellableBatches } from "./repo/sellable";
import { commitAtomic, prefetchTables, SHEET_TABS, type WriteOp } from "./sheets";
import { getOrderById, listOrdersWithItems } from "./repo/orders";
import { listKaspiInvoices } from "./repo/kaspiInvoices";
import { botChatWrite, emptyBotChat, listBotChats, settingsMap } from "./repo/broadcasts";
import { appendDebtReminder, listDebtReminders } from "./repo/debtReminders";
import { greenConfig, sendFileByUrl, sendText } from "./greenApi";
import { loadPhotoContext, rotationPhoto, type PhotoContext } from "./botPhotoSend";
import { isInfoPhoto, nudgePhotoQuestion, photoLabel, photoMessage, pickItemPhoto, type BotPhoto } from "./botPhotos";
import { photoFileUrl } from "./catalogFiles";
import { botPhotoSentWrite } from "./repo/botPhotos";
import { phoneKey } from "./leads";
import { mergeMessages, messageText } from "./whatsapp";
import { parsePush, pushItemFor, SALES_PUSH_SETTING } from "./salesPush";
import { botSettingsFrom, EMPTY_NUDGE, pushContext } from "./broadcast";
import { NUDGE_DECISION_SCHEMA, NUDGE_GAPS_HOURS, nudgeDecisionPrompt, nudgeDue, nudgeText, parseNudgeDecision, pickNudgeOffers } from "./botNudge";
import { chatJson, openAiConfigured } from "./openai";
import { listBatches } from "./repo/batches";
import { almatyHourOf, botStoreFor, inStore } from "./officeStore";
import { getSettings } from "./repo/settings";
import { getCurrentPrices } from "./repo/prices";
import { listBroadcasts, listRecipients } from "./repo/broadcasts";
import { priceFor } from "./priceList";
import { stockMap, lastBroadcastForBot } from "./botKnowledge";
import { FLOWER_TYPE_LABELS, formatGrade, isLiquidGrade } from "./constants";
import { orderCode } from "./paymentStage";
import { FARM_LABELS, ORDER_STATUSES } from "./constants";
import { isOpenKaspiStatus, isPaidKaspiStatus, kaspiErrorText } from "./kaspiInvoice";
import { BOT_MANAGER_EMAIL, isBotEmail } from "./botIdentity";
import { botDeclinedReminderText, botDeclinedText, botInvoiceErrorText, botPaidAlertText, botPaidText, botReminderText } from "./botOrder";
import { notifyBotSale } from "./botSalesAlert";
import { dueParts, invoicePart, lastInvoice } from "./botOrderRunner";
import type { KaspiInvoice } from "./types";
import { invoiceReminderBlocked } from "./botTurn";
import { isAssistantOrder } from "./sellerChannel";
import { sendLineOrderMessage } from "./lineSeller";
import { notifyLineManager } from "./lineNotify";
import { listAssistantLog, listWaLines } from "./repo/waLines";
import { listWaMessages } from "./repo/talks";
import type { BotChat } from "./broadcast";

// ---------------------------------------------------------------------------
// Бот доводит заказ до денег: пишет клиенту, когда оплата пришла или счёт не
// дошёл (из вебхука ApiPay), и напоминает о неоплаченном (расписание утром и
// вечером). Только по заявкам бота. Ничего не бросает: сбой здесь не должен
// ронять ни вебхук оплаты, ни сводку.
// ---------------------------------------------------------------------------

/**
 * Написать клиенту от имени бота и запомнить это в памяти чата. Это сообщение
 * про заказ и деньги — общий дожим («свежий срез…») после него не нужен, его
 * место занимают напоминания об оплате. `note` — записка менеджеру на странице «Бот».
 */
export async function sendBotMessage(phone: string, text: string, note = ""): Promise<string> {
  const cfg = greenConfig();
  if (!cfg) return "";
  const id = await sendText(cfg, phone, text);
  try {
    const chats = await listBotChats(true);
    const key = phoneKey(phone);
    const found = chats.find((c) => phoneKey(c.phone) === key);
    const chat = found ? { ...found, context: [...found.context], ourIds: [...found.ourIds] } : emptyBotChat(phone.replace(/\D/g, ""));
    chat.ourIds = [...chat.ourIds, id].slice(-20);
    chat.context = pushContext(chat.context, { role: "us", text, at: new Date().toISOString() });
    chat.nudge = { ...(chat.nudge ?? EMPTY_NUDGE), done: true };
    if (note) {
      chat.handoffAt = new Date().toISOString();
      chat.handoffReason = note.slice(0, 500);
    }
    await commitAtomic([botChatWrite(chat, found?.rowNumber ?? null)]);
  } catch (err) {
    console.error("bot memory:", err instanceof Error ? err.message : err);
  }
  return id;
}

/**
 * Счёт Kaspi по заявке бота сменил статус (вебхук ApiPay). Оплачен — спасибо и
 * «передан на сборку»; не дошёл — попросить номер Kaspi; клиент отклонил —
 * спросить, что не так, и предложить выходы. Остальное — молча.
 *
 * `invoice` — строка счёта ДО обновления. «Отменён» после нашего «отменяется»
 * (бухгалтер или сам бот отменили счёт) — это не отказ клиента: молчим.
 */
export async function onBotInvoiceUpdate(invoice: KaspiInvoice, status: string, errorCode: string, errorMessage: string): Promise<void> {
  try {
    const paid = isPaidKaspiStatus(status);
    const declined = status === "cancelled" && invoice.status !== "cancelling";
    if (!paid && status !== "error" && !declined) return;
    const order = await getOrderById(invoice.orderId);
    if (!order || !order.clientPhone) return;
    // Заказ помощника номера менеджера (19.10.2026) — клиенту пишем с ТОГО номера, где он заказывал.
    const assistant = !isBotEmail(order.managerEmail) && isAssistantOrder(order);
    if (!isBotEmail(order.managerEmail) && !assistant) return;
    const send = (text: string, note = "") =>
      assistant ? sendLineOrderMessage(order.managerEmail, order.clientPhone, text, note) : sendBotMessage(order.clientPhone, text, note);
    const code = orderCode(order.orderId);
    if (declined) {
      if (order.status === ORDER_STATUSES.CANCELLED || order.paid) return;
      // Уже выставлен счёт новее этого (бот перевыставил) — отказ по старому не повод писать.
      const newer = (await listKaspiInvoices({ fresh: true })).some(
        (i) => i.orderId === invoice.orderId && i.farm === invoice.farm && i.invoiceId !== invoice.invoiceId && i.createdAt > invoice.createdAt
      );
      if (newer) return;
      await send(botDeclinedText({ code, amount: invoice.amount }), `внимание: клиент отклонил счёт Kaspi по заказу №${code}`);
      return;
    }
    const text = paid
      ? botPaidText({ code, amount: invoice.amount, fullyPaid: order.paid, deliveryDate: order.deliveryDate })
      : botInvoiceErrorText({ code, phone: invoice.phone, reason: kaspiErrorText(errorCode, errorMessage) });
    await send(text);
    if (paid) {
      // Команде — «оплачено, можно собирать» (настройка BotSalesPhones); заказ помощника — и менеджеру номера.
      const paidText = botPaidAlertText({
          code,
          clientName: order.clientName,
          amount: invoice.amount,
          fullyPaid: order.paid,
          farmLabel: FARM_LABELS[invoice.farm] ?? "",
          items: order.items,
          deliveryDate: order.deliveryDate,
          store: order.store,
        });
      await notifyBotSale(paidText);
      if (assistant) {
        const line = (await listWaLines()).find((l) => l.active && l.assistant === "sell" && l.managerEmail === order.managerEmail.trim().toLowerCase());
        if (line) await notifyLineManager(line.code, paidText);
      }
    }
  } catch (err) {
    console.error("bot invoice follow-up:", err instanceof Error ? err.message : err);
  }
}

const REMIND_AFTER_HOURS = 3;
const REMIND_GAP_HOURS = 20;

/**
 * Напомнить об оплате по заявкам бота: счёт ждёт дольше 3 часов — напомнить;
 * истёк или отменён — выставить заново и сказать об этом. Не чаще раза в
 * 20 часов на заявку (журнал — вкладка DebtReminders, подпись — почта бота).
 * Не напоминает, если после заказа клиент спорил об оплате, писал менеджер или
 * бот поднимал тревогу об оплате (`invoiceReminderBlocked`).
 * Зовут утренняя сводка и вечерний разбор.
 */
export async function remindBotInvoices(now: Date = new Date()): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;
  try {
    await prefetchTables([
      SHEET_TABS.ORDERS,
      SHEET_TABS.ORDER_ITEMS,
      SHEET_TABS.CLIENTS,
      SHEET_TABS.KASPI_INVOICES,
      SHEET_TABS.DEBT_REMINDERS,
      SHEET_TABS.BOT_CHATS,
    ]);
    const [orders, invoices, reminders, chats] = await Promise.all([
      listOrdersWithItems(),
      listKaspiInvoices(),
      listDebtReminders(),
      listBotChats().catch(() => [] as Awaited<ReturnType<typeof listBotChats>>),
    ]);
    const since = now.getTime() - 7 * 24 * 3600000;
    // Заказы помощника на номере менеджера (19.10.2026) напоминаются с ТОГО номера; переписка — из WaMessages.
    const sellLines = (await listWaLines()).filter((l) => l.active && l.assistant === "sell");
    let lineData: { messages: Awaited<ReturnType<typeof listWaMessages>>; autoIds: Set<string> } | null = null;
    const lineChat = async (code: string, phone: string): Promise<Pick<BotChat, "mode" | "humanAt" | "handoffAt" | "handoffReason" | "context">> => {
      if (!lineData) {
        const [messages, log] = await Promise.all([listWaMessages({ lines: "all" }), listAssistantLog()]);
        lineData = { messages, autoIds: new Set(log.filter((r) => r.kind === "auto" || r.kind === "nudge").map((r) => r.messageId)) };
      }
      const key = phoneKey(phone);
      const chat = mergeMessages(lineData.messages.filter((m) => m.line === code && phoneKey(m.phone) === key));
      const human = [...chat].reverse().find((m) => m.direction === "out" && !lineData!.autoIds.has(m.messageId));
      return {
        mode: "bot",
        humanAt: human?.at ?? "",
        handoffAt: "",
        handoffReason: "",
        context: chat.map((m) => ({ role: m.direction === "in" ? ("client" as const) : ("us" as const), text: messageText(m), at: m.at })),
      };
    };
    for (const order of orders) {
      if (order.status === ORDER_STATUSES.CANCELLED || order.paid || !order.clientPhone) continue;
      const line = !isBotEmail(order.managerEmail) && isAssistantOrder(order) ? sellLines.find((l) => l.managerEmail === order.managerEmail.trim().toLowerCase()) : undefined;
      if (!isBotEmail(order.managerEmail) && !line) continue;
      const remindEmail = line ? `assistant:${line.code}` : BOT_MANAGER_EMAIL;
      const created = Date.parse(order.createdAt || "");
      if (!(created >= since) || now.getTime() - created < REMIND_AFTER_HOURS * 3600000) continue;
      const lastReminder = reminders
        .filter((r) => r.orderIds.includes(order.orderId) && r.sentByEmail === remindEmail)
        .reduce((max, r) => Math.max(max, Date.parse(r.sentAt) || 0), 0);
      if (now.getTime() - lastReminder < REMIND_GAP_HOURS * 3600000) continue;
      // Клиент после заказа спорил об оплате, писал менеджер или была тревога про оплату — не напоминаем (`botTurn.ts`).
      const chat = line ? await lineChat(line.code, order.clientPhone) : chats.find((c) => phoneKey(c.phone) === phoneKey(order.clientPhone)) ?? null;
      if (invoiceReminderBlocked(chat, order.createdAt)) continue;

      const texts: string[] = [];
      let amount = 0;
      for (const part of dueParts(order)) {
        const last = lastInvoice(invoices, order.orderId, part.farm);
        if (!last) continue; // счёт не выставлялся (касса не подключена) — это забота бухгалтера
        if (isOpenKaspiStatus(last.status) && Date.now() - Date.parse(last.createdAt) >= REMIND_AFTER_HOURS * 3600000) {
          texts.push(botReminderText({ code: orderCode(order.orderId), amount: part.due, reissued: false }));
          amount += part.due;
        } else if (last.status === "cancelled") {
          // Клиент отклонил счёт — заново молча не выставляем. Назавтра один раз спросить, держать ли заказ.
          const declinedAt = Date.parse(last.updatedAt || last.createdAt) || 0;
          if (now.getTime() - declinedAt < REMIND_GAP_HOURS * 3600000) continue;
          if (lastReminder > declinedAt) continue;
          texts.push(botDeclinedReminderText({ code: orderCode(order.orderId), amount: part.due }));
          amount += part.due;
        } else if (last.status === "expired") {
          const r = await invoicePart(order, part.farm, part.due, last.phone, line ? order.managerEmail : BOT_MANAGER_EMAIL);
          if (r.result === "sent") {
            texts.push(botReminderText({ code: orderCode(order.orderId), amount: part.due, reissued: true }));
            amount += part.due;
          }
        }
      }
      if (texts.length === 0) continue;
      let messageId = "";
      let error = "";
      try {
        messageId = line ? await sendLineOrderMessage(order.managerEmail, order.clientPhone, texts.join("\n")) : await sendBotMessage(order.clientPhone, texts.join("\n"));
        sent += 1;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        errors += 1;
      }
      await appendDebtReminder({
        phone: order.clientPhone.replace(/\D/g, ""),
        clientName: order.clientName,
        orderIds: [order.orderId],
        amount,
        messageId,
        kaspiInvoices: "",
        sentByEmail: remindEmail,
        error,
      });
    }
  } catch (err) {
    console.error("bot reminders:", err instanceof Error ? err.message : err);
    errors += 1;
  }
  return { sent, errors };
}

const almatyHour = (d: Date) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(d)) % 24;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Дожим молчащих клиентов (`botNudge.ts`): раз в час расписание зовёт
 * `/api/bot/followup`, бот пишет тем, кому пора, — не больше `limit` за раз и
 * с паузой между сообщениями (WhatsApp не любит очередь от «робота»).
 */
export async function runBotNudges(options: { limit?: number; budgetMs?: number } = {}): Promise<{ sent: number; closed: number; errors: number }> {
  const limit = options.limit ?? 8;
  const started = Date.now();
  const budget = options.budgetMs ?? 40000;
  let sent = 0;
  let closed = 0;
  let errors = 0;
  try {
    if (!openAiConfigured() || !greenConfig()) return { sent, closed, errors };
    await prefetchTables([
      SHEET_TABS.BOT_CHATS,
      SHEET_TABS.SETTINGS,
      SHEET_TABS.BATCHES,
      SHEET_TABS.PRICE_HISTORY,
      SHEET_TABS.BROADCASTS,
      SHEET_TABS.BROADCAST_RECIPIENTS,
    ]);
    const [chats, map] = await Promise.all([listBotChats(true), settingsMap()]);
    const settings = botSettingsFrom(map);
    const push = parsePush(map[SALES_PUSH_SETTING]);
    const now = new Date();
    const hour = almatyHour(now);
    const due = chats
      .map((chat) => ({ chat, attempt: nudgeDue({ settings, chat, now, hour }) }))
      .filter((x) => x.attempt > 0)
      .sort((a, b) => a.attempt - b.attempt)
      .slice(0, limit);
    if (due.length === 0) return { sent, closed, errors };
    const [batches, shelf, prices, broadcasts, recipients] = await Promise.all([
      listSellableBatches(),
      getSettings(),
      getCurrentPrices(),
      listBroadcasts(),
      listRecipients(),
    ]);
    // Предлагаем то, что продадим сейчас: до 12:00 — основной склад, после — офис
    // (если там есть живой цветок, иначе основной — на завтра).
    const officeLive = stockMap(inStore(batches, "office"), shelf, now);
    const stock = Array.from(
      (botStoreFor(almatyHourOf(now), officeLive.size > 0) === "office" ? officeLive : stockMap(inStore(batches, ""), shelf, now)).values()
    );
    const label = (o: { flowerType: string; variety: string; grade: string }) =>
      `${FLOWER_TYPE_LABELS[o.flowerType] ?? o.flowerType} ${o.variety}, ${formatGrade(o.grade)}`;
    let photoCtx: PhotoContext | null = null;
    const photoWrites: WriteOp[] = [];
    for (const { chat: found, attempt } of due) {
      if (Date.now() - started > budget) break;
      const chat = { ...found, context: [...found.context], ourIds: [...found.ourIds], nudge: { ...found.nudge } };
      try {
        // Писать ли — решает модель узким вопросом; по умолчанию — нет.
        const transcriptText = chat.context.map((c) => `${c.role === "client" ? "Клиент" : "Мы"}: ${c.text}`).join("\n");
        const { data } = await chatJson(nudgeDecisionPrompt(), `Переписка:\n${transcriptText}`, "nudge_decision", NUDGE_DECISION_SCHEMA as unknown as Record<string, unknown>, { fast: true });
        const decision = parseNudgeDecision(data);
        if (!decision.nudge) {
          chat.nudge = { ...chat.nudge, done: true };
          closed += 1;
        } else {
          // Текст и цены — кодом, из склада и прайса.
          const offers = pickNudgeOffers({
            stock,
            priceOf: (f, v, g) => priceFor(prices, f, v, g),
            mentioned: `${transcriptText}\n${lastBroadcastForBot(broadcasts, recipients, chat.phone)}`,
            isLiquid: isLiquidGrade,
            clientText: chat.context.filter((c) => c.role === "client").map((c) => c.text).join("\n"),
            isPush: (f, g) => !!pushItemFor(push, f, g),
          });
          if (sent > 0) await pause(3000 + Math.floor(Math.random() * 4000));
          // Касания, кроме последнего, — фото из ротации с продающей подписью и ценами (владелец: «разные фотографии в
          // ротации, с цветком и продающим текстом»); нет фото — текст. Последнее касание — мягкое, текстом.
          // Фото — той позиции, о которой шла речь (13.10.2026: спросила про Altaj, касание пришло с фото Chik);
          // нет её фото — фото из ротации, только если клиент ни о каком сорте не спрашивал, иначе текст.
          const ctx = attempt < NUDGE_GAPS_HOURS.length && offers.length ? (photoCtx ??= await loadPhotoContext()) : null;
          const recent = chat.context.map((c) => c.text).join("\n");
          const itemPic = ctx ? pickItemPhoto(ctx.photos, offers[0], recent, chat.infoPhotos ?? []) : null;
          const talkedVariety = offers.length > 0 && recent.toLowerCase().includes(offers[0].variety.toLowerCase());
          const photo = !ctx
            ? null
            : itemPic
              ? {
                  url: photoFileUrl(itemPic),
                  name: itemPic.fileName || "photo.jpg",
                  caption: photoMessage({
                    caption: itemPic.caption,
                    prices: offers.slice(0, 1).map((o) => ({ label: label(o), price: o.price })),
                    question: nudgePhotoQuestion(attempt),
                  }),
                  after: botPhotoSentWrite(itemPic as BotPhoto & { rowNumber: number }),
                  photo: itemPic,
                }
              : talkedVariety
                ? null
                : rotationPhoto(ctx, { flowers: offers.map((o) => o.flowerType), question: nudgePhotoQuestion(attempt) });
          let id: string;
          let memo: string;
          if (photo) {
            id = await sendFileByUrl(greenConfig()!, chat.phone, photo.url, photo.name, photo.caption);
            memo = `[фото: ${photoLabel(photo.photo)}] ${photo.caption}`;
            photoWrites.push(photo.after);
            if (isInfoPhoto(photo.photo)) chat.infoPhotos = Array.from(new Set([...(chat.infoPhotos ?? []), photo.photo.photoId]));
          } else {
            memo = nudgeText(attempt, offers, label);
            id = await sendText(greenConfig()!, chat.phone, memo);
          }
          chat.ourIds = [...chat.ourIds, id].slice(-20);
          chat.context = pushContext(chat.context, { role: "us", text: memo, at: new Date().toISOString() });
          chat.nudge = { count: attempt, at: new Date().toISOString(), done: false };
          sent += 1;
        }
        await commitAtomic([botChatWrite(chat, found.rowNumber), ...photoWrites.splice(0)]);
      } catch (err) {
        console.error("bot nudge:", err instanceof Error ? err.message : err);
        errors += 1;
      }
    }
  } catch (err) {
    console.error("bot nudges:", err instanceof Error ? err.message : err);
    errors += 1;
  }
  return { sent, closed, errors };
}
