import { listSellableBatches } from "./repo/sellable";
import { prefetchTables, SHEET_TABS } from "./sheets";
import { localDayKey } from "./timezone";
import { FARM_LABELS, MONEY_LOG_ACTIONS, ORDER_STATUSES, ROLES } from "./constants";
import { listBatches } from "./repo/batches";
import { almatyHourOf, botOrderStore, inStore } from "./officeStore";
import { getSettings } from "./repo/settings";
import { getCurrentPrices } from "./repo/prices";
import { priceFor } from "./priceList";
import { settingsMap } from "./repo/broadcasts";
import { parsePush, pushUnitPrice, SALES_PUSH_SETTING } from "./salesPush";
import { createClient, listClients } from "./repo/clients";
import { listLeads } from "./repo/leads";
import { createOrder, getOrderById, listOrdersWithItems, updateOrderStatus } from "./repo/orders";
import { findKaspiInvoice, listKaspiInvoices, updateKaspiInvoiceRow } from "./repo/kaspiInvoices";
import { logMoney } from "./repo/moneyLog";
import { ensureClientForLead } from "./leadConvert";
import { clientForPhone } from "./waOrder";
import { phoneKey } from "./leads";
import { directionForCity } from "./direction";
import { farmPayments } from "./orderMoney";
import { orderCode } from "./paymentStage";
import { apiPayConfig, cancelInvoice } from "./apipay";
import { issueKaspiInvoice } from "./kaspiIssue";
import { isOpenKaspiStatus, isPaidKaspiStatus, kaspiErrorText, kaspiPhone, prettyKaspiPhone } from "./kaspiInvoice";
import { stockMap } from "./botKnowledge";
import { BOT_MANAGER_EMAIL } from "./botIdentity";
import { isNotASale } from "./orderKind";
import { formatGrade, FLOWER_TYPE_LABELS } from "./constants";
import {
  BOT_DEFAULT_CITY,
  botCancelledText,
  botOrderText,
  botSaleAlertText,
  newClientName,
  planBotOrder,
  type BotOrderDraft,
  type InvoiceOutcome,
} from "./botOrder";
import { notifyBotSale } from "./botSalesAlert";
import { BOT_CHANNEL, channelLogText, isChannelOrder, orderNoteHead, type SellerChannel } from "./sellerChannel";
import { genitiveName } from "./waLines";
import { notifyLineManager } from "./lineNotify";
import type { KaspiInvoice, OrderWithItems } from "./types";

// ---------------------------------------------------------------------------
// Заказ бота — запись и счёт. Правила — `botOrder.ts` (чистые, под проверкой).
// Ничего не бросает наружу: сбой — понятный текст клиенту и записка менеджеру.
// ---------------------------------------------------------------------------

const waPhoneText = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d ? `+${d}` : "";
};

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;

/** Заявки бота (или помощника номера менеджера — `ch`) этого номера за 14 дней, свежие сверху. */
function botOrdersOf(orders: OrderWithItems[], phone: string, clientId: string, ch: SellerChannel = BOT_CHANNEL): OrderWithItems[] {
  const key = phoneKey(phone);
  const since = Date.now() - 14 * 24 * 3600000;
  return orders
    .filter(
      (o) =>
        isChannelOrder(o, ch) &&
        o.status !== ORDER_STATUSES.CANCELLED &&
        Date.parse(o.createdAt || "") >= since &&
        ((key && phoneKey(o.clientPhone) === key) || (clientId && o.clientId === clientId))
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Последний счёт по части заявки одной компании. */
function lastInvoice(invoices: KaspiInvoice[], orderId: string, farm: string): KaspiInvoice | null {
  const mine = invoices.filter((i) => i.orderId === orderId && i.farm === farm).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return mine[0] ?? null;
}

/** Выставить счёт на неоплаченную часть одной компании; что вышло — для текста. */
async function invoicePart(order: OrderWithItems, farm: string, amount: number, phone: string, actorEmail: string = BOT_MANAGER_EMAIL): Promise<InvoiceOutcome> {
  const farmLabel = FARM_LABELS[farm] ?? farm;
  const num = kaspiPhone(phone);
  if (!apiPayConfig(farm)) return { farmLabel, amount, result: "manual", phone: num };
  if (!num) return { farmLabel, amount, result: "failed", phone: "", error: "нет номера Kaspi" };
  try {
    // Бот действует как система: права «кто выставляет счёт» — у бухгалтера и админа.
    await issueKaspiInvoice({ orderId: order.orderId, farm, phone: num, amount, email: actorEmail, role: ROLES.ADMIN });
    return { farmLabel, amount, result: "sent", phone: num };
  } catch (err) {
    return { farmLabel, amount, result: "failed", phone: num, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Неоплаченные части заявки: компания и сколько осталось. */
function dueParts(order: OrderWithItems): { farm: string; due: number }[] {
  return farmPayments(order)
    .map((p) => ({ farm: p.farm, due: Math.round(p.amount - p.paidAmount) }))
    .filter((p) => p.due >= 1);
}

/**
 * Клиент подтвердил заказ: карточка (найти или завести), заявка на склад,
 * счета Kaspi. Возвращает текст клиенту и записку менеджеру.
 */
export async function placeBotOrder(input: {
  phone: string;
  senderName: string;
  draft: BotOrderDraft;
  kaspiPhone: string;
  /** Кто продаёт: бот (по умолчанию) или помощник на номере менеджера — тогда заявка и новая карточка на менеджера. */
  channel?: SellerChannel;
}): Promise<{ text: string; orderId: string; note: string }> {
  const { draft, phone } = input;
  const ch = input.channel ?? BOT_CHANNEL;
  const who = ch.line ? `ИИ-помощник${ch.managerName ? ` ${genitiveName(ch.managerName)}` : ""}` : "";
  try {
    await prefetchTables([
      SHEET_TABS.CLIENTS,
      SHEET_TABS.LEADS,
      SHEET_TABS.BATCHES,
      SHEET_TABS.SETTINGS,
      SHEET_TABS.PRICE_HISTORY,
      SHEET_TABS.ORDERS,
      SHEET_TABS.ORDER_ITEMS,
    ]);
    const today = localDayKey();
    const [allBatches, settings, prices, map] = await Promise.all([listSellableBatches(), getSettings(), getCurrentPrices(today), settingsMap()]);
    const push = parsePush(map[SALES_PUSH_SETTING]);
    // После 12:00 заказ НА СЕГОДНЯ — из подсклада «Офис», остальное — основной
    // склад (`officeStore.ts`): то же деление, что бот видел в подсказке.
    const now = new Date();
    const store = botOrderStore({
      almatyHour: almatyHourOf(now),
      deliveryDate: draft.deliveryDate,
      today,
      officeHasStock: stockMap(inStore(allBatches, "office"), settings, now).size > 0,
    });
    const batches = inStore(allBatches, store);
    const plan = planBotOrder({
      draft,
      stock: Array.from(stockMap(batches, settings, new Date()).values()),
      priceOf: (f, v, g) => priceFor(prices, f, v, g),
      volumePrice: (f, g, q, list) => pushUnitPrice(push, f, g, q, list),
      today,
    });
    if (!plan.ok) return { text: plan.question, orderId: "", note: "" };

    // Карточка клиента: по номеру (телефон или Kaspi-номер), иначе лид, иначе новая.
    let client = clientForPhone(await listClients(), phone);
    if (client?.retail) {
      return { text: "Этот номер записан у нас как наш магазин — заявку оформит менеджер розницы.", orderId: "", note: "внимание: наш магазин пишет боту" };
    }
    let clientId = client?.clientId ?? "";
    let clientName = client?.name ?? "";
    let city = client?.city || draft.city;
    if (!client) {
      const key = phoneKey(phone);
      const lead = key ? (await listLeads()).find((l) => phoneKey(l.phone) === key && l.stage !== "lost") : undefined;
      if (lead) {
        city = lead.city || draft.city || BOT_DEFAULT_CITY;
        const linked = await ensureClientForLead(lead, ch.managerEmail, { city });
        clientId = linked.clientId;
        clientName = lead.name;
      } else {
        // Название и город не повод откладывать заказ: карточка — по имени WhatsApp, город — Алматы, менеджер уточнит.
        city = draft.city || BOT_DEFAULT_CITY;
        clientName = newClientName(draft.shopName, input.senderName, phone);
        clientId = await createClient({
          name: clientName,
          city,
          shopName: "",
          clientType: "",
          contactPerson: input.senderName,
          phone: waPhoneText(phone),
          messenger: "WhatsApp",
          address: draft.address,
          paymentTerms: "",
          source: "Написали в WhatsApp",
          note: `Клиента завёл ${who || "бот WhatsApp"}${draft.shopName && draft.city ? "" : " — уточнить название точки и город"}`,
          managerEmail: ch.managerEmail,
          paymentMethod: "Каспи",
          kaspiPay1: "",
          kaspiPay2: "",
          retail: "",
        });
      }
    }

    // Повтор подтверждения (клиент написал «да» дважды, два уведомления подряд) —
    // второй заявки не будет: та же заявка за последние 30 минут.
    const signature = (items: { flowerType: string; variety: string; grade: string; quantity: number }[]) =>
      items.map((i) => `${i.flowerType}|${i.variety}|${i.grade}|${i.quantity}`).sort().join(";");
    const recent = botOrdersOf(await listOrdersWithItems(), phone, clientId, ch).find(
      (o) => Date.now() - Date.parse(o.createdAt) < 30 * 60000 && signature(o.items) === signature(plan.items)
    );
    if (recent) {
      return {
        text: `Этот заказ уже оформлен — №${orderCode(recent.orderId)}. ${recent.paid ? "Он оплачен и передан на сборку." : "Счёт Kaspi ждёт оплаты в приложении Kaspi."}`,
        orderId: "",
        note: "",
      };
    }

    const notes = [
      orderNoteHead(ch),
      draft.address ? `Адрес: ${draft.address}.` : "",
      draft.note ? `Пожелания: ${draft.note}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const orderId = await createOrder({
      managerEmail: ch.managerEmail,
      confirmed: true,
      paymentMethod: "Каспи",
      clientId,
      clientName,
      clientPhone: waPhoneText(phone),
      deliveryDate: plan.deliveryDate,
      direction: directionForCity(city),
      notes,
      store,
      items: plan.items.map((i) => ({ ...i, flowerType: i.flowerType as never })),
    });
    await logMoney({
      actorEmail: ch.managerEmail,
      orderId,
      action: MONEY_LOG_ACTIONS.MANAGER_CONFIRMED,
      details: channelLogText(ch, "Подтверждена клиентом в WhatsApp"),
      amountBefore: 0,
      amountAfter: 0,
    });

    const order = await getOrderById(orderId);
    const invoices: InvoiceOutcome[] = [];
    if (order) {
      for (const part of dueParts(order)) invoices.push(await invoicePart(order, part.farm, part.due, input.kaspiPhone || phone, ch.managerEmail));
    }
    const code = orderCode(orderId);
    let text = botOrderText({
      code,
      items: plan.items,
      deliveryDate: plan.deliveryDate,
      city,
      invoices,
      office: store === "office",
      address: draft.address || client?.address || "",
    });
    if (invoices.some((i) => i.result === "failed" && !i.phone)) {
      text += "\nНапишите номер, к которому привязан ваш Kaspi, — выставлю счёт на него.";
    }
    // Команде — «бот продал» (Руслан, владелец, Данияр: настройка BotSalesPhones); заказ помощника — ещё и
    // самому менеджеру номера (владелец, 19.10: «Ильяс получает сообщение „оформил заказ №…“»).
    const saleText = botSaleAlertText({
      code,
      clientName,
      phone: waPhoneText(phone),
      city,
      items: plan.items,
      deliveryDate: plan.deliveryDate,
      store,
      invoices,
      who,
    });
    await notifyBotSale(saleText);
    if (ch.line) await notifyLineManager(ch.line, saleText);
    const total = plan.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const problems = invoices
      .filter((i) => i.result !== "sent")
      .map((i) => (i.result === "manual" ? `счёт ${i.farmLabel} выставить вручную (касса не подключена)` : `счёт ${i.farmLabel} не ушёл: ${i.error}`));
    return { text, orderId, note: `заказ: №${code} на ${money(total)}${problems.length ? `; ${problems.join("; ")}` : ""}` };
  } catch (err) {
    console.error("bot order:", err instanceof Error ? err.message : err);
    return {
      text: "Записал ваш заказ. Сейчас проверю наличие и пришлю подтверждение со счётом.",
      orderId: "",
      note: `внимание: бот не смог оформить заказ (${err instanceof Error ? err.message : err}) — оформите вручную`,
    };
  }
}

/**
 * Клиент прислал другой номер для Kaspi: заново выставить счета по заявкам
 * бота, у которых последний счёт не дошёл, истёк или отменён. Пусто — нечего.
 */
export async function reissueBotInvoices(phone: string, newPhone: string, ch: SellerChannel = BOT_CHANNEL): Promise<string> {
  // Пустой номер — «выставьте ещё раз»: на тот же номер, что и прошлый счёт.
  const given = kaspiPhone(newPhone);
  if (newPhone && !given) return "";
  try {
    await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES]);
    const [orders, invoices] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true })]);
    const lines: string[] = [];
    for (const order of botOrdersOf(orders, phone, "", ch)) {
      for (const part of dueParts(order)) {
        const last = lastInvoice(invoices, order.orderId, part.farm);
        if (last && (isOpenKaspiStatus(last.status) || isPaidKaspiStatus(last.status))) continue;
        const num = given || kaspiPhone(last?.phone) || kaspiPhone(phone);
        if (!num) continue;
        const r = await invoicePart(order, part.farm, part.due, num, ch.managerEmail);
        if (r.result === "sent") lines.push(`Выставил счёт Kaspi по заказу №${orderCode(order.orderId)} на ${money(part.due)} на номер ${prettyKaspiPhone(num)} — оплатите в приложении Kaspi.`);
      }
    }
    return lines.join("\n");
  } catch (err) {
    console.error("bot reissue:", err instanceof Error ? err.message : err);
    return "";
  }
}

/**
 * Клиент просит отменить заказ бота (отказался или меняет заказ — тогда следом
 * оформляется новый). Только неоплаченный и не отгруженный: иначе это работа
 * бухгалтера и склада — записка менеджеру. Номер не совпал, но у клиента ровно
 * один такой заказ — отменяется он. Открытый счёт Kaspi отменяется тоже: иначе
 * клиент оплатит заказ, которого нет.
 */
export async function cancelBotOrder(phone: string, code: string, ch: SellerChannel = BOT_CHANNEL): Promise<{ text: string; note: string; cancelled: boolean }> {
  try {
    await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES]);
    const [orders, invoices] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true })]);
    const mine = botOrdersOf(orders, phone, "", ch);
    const want = code.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    const unpaid = mine.filter((o) => !(Number(o.paidAmount) > 1) && o.items.every((i) => i.shippedQuantity === 0));
    const order = mine.find((o) => orderCode(o.orderId).toUpperCase() === want) ?? (unpaid.length === 1 ? unpaid[0] : undefined);
    if (!order) return { text: "", note: want ? `внимание: клиент просит отменить заказ №${want}, бот его не нашёл` : "", cancelled: false };
    const label = orderCode(order.orderId);
    if (!unpaid.includes(order)) {
      return {
        text: `Заказ №${label} уже оплачен или в пути — отменить его сам не могу, передал вопрос, с вами свяжутся.`,
        note: `внимание: клиент просит отменить заказ №${label}, но по нему уже есть оплата или отгрузка`,
        cancelled: false,
      };
    }
    for (const inv of invoices.filter((i) => i.orderId === order.orderId && isOpenKaspiStatus(i.status))) {
      const cfg = apiPayConfig(inv.farm);
      if (!cfg) continue;
      try {
        const res = await cancelInvoice(cfg, inv.invoiceId);
        const found = await findKaspiInvoice(inv.invoiceId);
        if (found) await updateKaspiInvoiceRow(found.rowNumber, { Status: String(res?.status || "cancelling"), UpdatedAt: new Date().toISOString() });
      } catch (err) {
        console.error("bot cancel invoice:", err instanceof Error ? err.message : err);
      }
    }
    await updateOrderStatus(order.orderId, ORDER_STATUSES.CANCELLED);
    await logMoney({
      actorEmail: ch.managerEmail,
      orderId: order.orderId,
      action: MONEY_LOG_ACTIONS.ORDER_CANCELLED,
      details: channelLogText(ch, "Клиент отказался в WhatsApp"),
      amountBefore: order.totalAmount,
      amountAfter: 0,
    });
    return { text: botCancelledText(label), note: `отмена: заказ №${label} — клиент отказался в WhatsApp`, cancelled: true };
  } catch (err) {
    console.error("bot cancel:", err instanceof Error ? err.message : err);
    return { text: "", note: `внимание: бот не смог отменить заказ (${err instanceof Error ? err.message : err}) — отмените вручную`, cancelled: false };
  }
}

/**
 * Клиент менеджера глазами помощника (19.10.2026, владелец: «знает клиента Ильяса»): что и когда брал у
 * любого менеджера, сколько должен, что берёт обычно и как давно не заказывал. Только факты из базы.
 */
export function clientHistoryLines(input: { orders: OrderWithItems[]; phone: string; clientId: string; now: Date }): string[] {
  const key = phoneKey(input.phone);
  const mine = input.orders
    .filter(
      (o) =>
        o.status !== ORDER_STATUSES.CANCELLED &&
        !isNotASale(o) &&
        ((input.clientId && o.clientId === input.clientId) || (key && phoneKey(o.clientPhone) === key))
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (mine.length === 0) return ["Заказов у клиента в базе ещё не было."];
  const lines: string[] = [];
  const days = Math.floor((input.now.getTime() - Date.parse(mine[0].createdAt)) / 86400000);
  lines.push(`Заказов в базе: ${mine.length}; последний — ${mine[0].createdAt.slice(0, 10)}${Number.isFinite(days) ? ` (${days} дн. назад)` : ""}.`);
  const debt = mine.reduce((s, o) => s + Math.max(0, o.totalAmount - Math.min(o.paidAmount, o.totalAmount)), 0);
  if (debt >= 1) lines.push(`Долг клиента сейчас: ${money(debt)}. О долге сам не напоминай (это дело менеджера); просит в долг или отсрочку — alert.`);
  const qty = new Map<string, number>();
  for (const o of mine.slice(0, 15)) for (const i of o.items) {
    const name = `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType} ${i.variety}, ${formatGrade(i.grade)}`;
    qty.set(name, (qty.get(name) ?? 0) + i.quantity);
  }
  const usual = Array.from(qty.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (usual.length) lines.push(`Обычно берёт: ${usual.map(([n, q]) => `${n} (всего ${q} шт.)`).join("; ")}.`);
  for (const o of mine.slice(0, 5)) {
    const items = o.items.map((i) => `${i.variety} ${formatGrade(i.grade)} ${i.quantity} шт. по ${money(i.unitPrice)}`).join(", ");
    const paid = o.paidAmount >= o.totalAmount - 1 ? "оплачен" : o.paidAmount > 1 ? `оплачен частично, остаток ${money(o.totalAmount - o.paidAmount)}` : "не оплачен";
    lines.push(`• ${o.createdAt.slice(0, 10)}: ${items} — ${money(o.totalAmount)}, ${paid}, ${o.status === ORDER_STATUSES.SHIPPED ? "отгружен" : "не отгружен"}.`);
  }
  return lines;
}

/** Что бот знает о клиенте: карточка и его заказы через бота — для подсказки модели. */
export async function botClientContext(phone: string, ch: SellerChannel = BOT_CHANNEL): Promise<string> {
  try {
    await prefetchTables([SHEET_TABS.CLIENTS, SHEET_TABS.LEADS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.KASPI_INVOICES]);
    const [clients, leads, orders, invoices] = await Promise.all([listClients(), listLeads(), listOrdersWithItems(), listKaspiInvoices()]);
    const client = clientForPhone(clients, phone);
    const key = phoneKey(phone);
    const lead = !client && key ? leads.find((l) => phoneKey(l.phone) === key) : undefined;
    const lines: string[] = [];
    if (client) {
      lines.push(`Клиент в базе: «${client.name}», город ${client.city || "не указан"}.`);
      // Условия оплаты из карточки: «По факту» / «Отсрочка N дней» — оплата после отгрузки для него нормальна.
      if (client.paymentTerms) lines.push(`Условия оплаты по карточке: ${client.paymentTerms}.`);
      if (ch.line && client.paymentMethod) lines.push(`Чем обычно платит: ${client.paymentMethod}.`);
      if (ch.line && client.managerEmail && client.managerEmail.toLowerCase() !== ch.managerEmail) lines.push("Карточка клиента записана на другого менеджера — продавай как обычно, заказ будет твой.");
    }
    else if (lead) lines.push(`Клиент есть в лидах: «${lead.name}», город ${lead.city || "не указан — спроси город доставки"}.`);
    else
      lines.push(
        "Клиента нет в базе. Название точки и город НЕ спрашивай до заказа: назвал позицию и количество — оформляй сразу " +
          "(shopName и city — если прозвучали в переписке, иначе пусто; карточка заведётся сама, город по умолчанию Алматы)."
      );
    // Помощник менеджера знает всю историю клиента (у любого менеджера): что брал, долг, что обычно.
    if (ch.line && (client || lead)) {
      lines.push("История заказов:", ...clientHistoryLines({ orders, phone, clientId: client?.clientId ?? "", now: new Date() }));
    }
    const mine = botOrdersOf(orders, phone, client?.clientId ?? "", ch).slice(0, 5);
    if (ch.line && mine.length) lines.push("Заказы, которые оформил ты (счета Kaspi):");
    for (const o of mine) {
      const items = o.items.map((i) => `${i.variety} ${i.grade} ${i.quantity} шт.`).join(", ");
      const parts = farmPayments(o).map((p) => {
        const last = lastInvoice(invoices, o.orderId, p.farm);
        if (p.paidAmount >= p.amount - 1) return "оплачено";
        if (!last) return "счёт ещё не выставлен";
        if (isOpenKaspiStatus(last.status)) return `счёт Kaspi ждёт оплаты на номер ${prettyKaspiPhone(last.phone)}`;
        if (last.status === "error") return `счёт не дошёл (${kaspiErrorText(last.errorCode, last.errorMessage)}) — попроси номер Kaspi`;
        if (last.status === "expired") return "счёт истёк — предложи выставить заново (invoiceAgain)";
        return "клиент ОТКЛОНИЛ счёт Kaspi — узнай причину и реши: заново на этот номер (invoiceAgain), на другой (kaspiPhone), поправить заказ (cancelOrder этого номера + новый order) или отменить (cancelOrder)";
      });
      lines.push(
        `Заказ №${orderCode(o.orderId)} от ${o.createdAt.slice(0, 10)}: ${items}; сумма ${money(o.totalAmount)}; доставка ${o.deliveryDate}; ` +
          `${o.status === ORDER_STATUSES.SHIPPED ? "отгружен" : "не отгружен"}; ${parts.join(", ")}.`
      );
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export { dueParts, lastInvoice, botOrdersOf, invoicePart, money as moneyText };
