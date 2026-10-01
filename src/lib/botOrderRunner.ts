import { prefetchTables, SHEET_TABS } from "./sheets";
import { localDayKey } from "./timezone";
import { FARM_LABELS, MONEY_LOG_ACTIONS, ORDER_STATUSES, ROLES } from "./constants";
import { listBatches } from "./repo/batches";
import { getSettings } from "./repo/settings";
import { getCurrentPrices } from "./repo/prices";
import { priceFor } from "./priceList";
import { createClient, listClients } from "./repo/clients";
import { listLeads } from "./repo/leads";
import { createOrder, getOrderById, listOrdersWithItems } from "./repo/orders";
import { listKaspiInvoices } from "./repo/kaspiInvoices";
import { logMoney } from "./repo/moneyLog";
import { ensureClientForLead } from "./leadConvert";
import { clientForPhone } from "./waOrder";
import { phoneKey } from "./leads";
import { directionForCity } from "./direction";
import { farmPayments } from "./orderMoney";
import { orderCode } from "./paymentStage";
import { apiPayConfig } from "./apipay";
import { issueKaspiInvoice } from "./kaspiIssue";
import { isOpenKaspiStatus, isPaidKaspiStatus, kaspiErrorText, kaspiPhone, prettyKaspiPhone } from "./kaspiInvoice";
import { stockMap } from "./botKnowledge";
import { BOT_MANAGER_EMAIL, isBotEmail } from "./botIdentity";
import { botOrderText, planBotOrder, type BotOrderDraft, type InvoiceOutcome } from "./botOrder";
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

/** Заявки бота этого номера за 14 дней, свежие сверху. */
function botOrdersOf(orders: OrderWithItems[], phone: string, clientId: string): OrderWithItems[] {
  const key = phoneKey(phone);
  const since = Date.now() - 14 * 24 * 3600000;
  return orders
    .filter(
      (o) =>
        isBotEmail(o.managerEmail) &&
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
async function invoicePart(order: OrderWithItems, farm: string, amount: number, phone: string): Promise<InvoiceOutcome> {
  const farmLabel = FARM_LABELS[farm] ?? farm;
  const num = kaspiPhone(phone);
  if (!apiPayConfig(farm)) return { farmLabel, amount, result: "manual", phone: num };
  if (!num) return { farmLabel, amount, result: "failed", phone: "", error: "нет номера Kaspi" };
  try {
    // Бот действует как система: права «кто выставляет счёт» — у бухгалтера и админа.
    await issueKaspiInvoice({ orderId: order.orderId, farm, phone: num, amount, email: BOT_MANAGER_EMAIL, role: ROLES.ADMIN });
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
}): Promise<{ text: string; orderId: string; note: string }> {
  const { draft, phone } = input;
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
    const [batches, settings, prices] = await Promise.all([listBatches(), getSettings(), getCurrentPrices(today)]);
    const plan = planBotOrder({
      draft,
      stock: Array.from(stockMap(batches, settings, new Date()).values()),
      priceOf: (f, v, g) => priceFor(prices, f, v, g),
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
        city = lead.city || draft.city;
        if (!city) return { text: "В какой город доставить заказ?", orderId: "", note: "" };
        const linked = await ensureClientForLead(lead, BOT_MANAGER_EMAIL, { city });
        clientId = linked.clientId;
        clientName = lead.name;
      } else {
        if (!draft.shopName || !draft.city) {
          return { text: "Подскажите, как называется ваша точка и в каком городе доставка? Оформлю заказ.", orderId: "", note: "" };
        }
        city = draft.city;
        clientName = draft.shopName;
        clientId = await createClient({
          name: draft.shopName,
          city: draft.city,
          shopName: "",
          clientType: "",
          contactPerson: input.senderName,
          phone: waPhoneText(phone),
          messenger: "WhatsApp",
          address: draft.address,
          paymentTerms: "",
          source: "Написали в WhatsApp",
          note: "Клиента завёл бот WhatsApp",
          managerEmail: BOT_MANAGER_EMAIL,
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
    const recent = botOrdersOf(await listOrdersWithItems(), phone, clientId).find(
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
      "Заказ принял бот WhatsApp.",
      draft.address ? `Адрес: ${draft.address}.` : "",
      draft.note ? `Пожелания: ${draft.note}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const orderId = await createOrder({
      managerEmail: BOT_MANAGER_EMAIL,
      confirmed: true,
      paymentMethod: "Каспи",
      clientId,
      clientName,
      clientPhone: waPhoneText(phone),
      deliveryDate: plan.deliveryDate,
      direction: directionForCity(city),
      notes,
      items: plan.items.map((i) => ({ ...i, flowerType: i.flowerType as never })),
    });
    await logMoney({
      actorEmail: BOT_MANAGER_EMAIL,
      orderId,
      action: MONEY_LOG_ACTIONS.MANAGER_CONFIRMED,
      details: "Подтверждена клиентом в WhatsApp (бот)",
      amountBefore: 0,
      amountAfter: 0,
    });

    const order = await getOrderById(orderId);
    const invoices: InvoiceOutcome[] = [];
    if (order) {
      for (const part of dueParts(order)) invoices.push(await invoicePart(order, part.farm, part.due, input.kaspiPhone || phone));
    }
    const code = orderCode(orderId);
    let text = botOrderText({ code, items: plan.items, deliveryDate: plan.deliveryDate, city, invoices });
    if (invoices.some((i) => i.result === "failed" && !i.phone)) {
      text += "\nНапишите номер, к которому привязан ваш Kaspi, — выставлю счёт на него.";
    }
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
export async function reissueBotInvoices(phone: string, newPhone: string): Promise<string> {
  const num = kaspiPhone(newPhone);
  if (!num) return "";
  try {
    await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES]);
    const [orders, invoices] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true })]);
    const lines: string[] = [];
    for (const order of botOrdersOf(orders, phone, "")) {
      for (const part of dueParts(order)) {
        const last = lastInvoice(invoices, order.orderId, part.farm);
        if (last && (isOpenKaspiStatus(last.status) || isPaidKaspiStatus(last.status))) continue;
        const r = await invoicePart(order, part.farm, part.due, num);
        if (r.result === "sent") lines.push(`Выставил счёт Kaspi по заказу №${orderCode(order.orderId)} на ${money(part.due)} на номер ${prettyKaspiPhone(num)} — оплатите в приложении Kaspi.`);
      }
    }
    return lines.join("\n");
  } catch (err) {
    console.error("bot reissue:", err instanceof Error ? err.message : err);
    return "";
  }
}

/** Что бот знает о клиенте: карточка и его заказы через бота — для подсказки модели. */
export async function botClientContext(phone: string): Promise<string> {
  try {
    await prefetchTables([SHEET_TABS.CLIENTS, SHEET_TABS.LEADS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.KASPI_INVOICES]);
    const [clients, leads, orders, invoices] = await Promise.all([listClients(), listLeads(), listOrdersWithItems(), listKaspiInvoices()]);
    const client = clientForPhone(clients, phone);
    const key = phoneKey(phone);
    const lead = !client && key ? leads.find((l) => phoneKey(l.phone) === key) : undefined;
    const lines: string[] = [];
    if (client) lines.push(`Клиент в базе: «${client.name}», город ${client.city || "не указан"}.`);
    else if (lead) lines.push(`Клиент есть в лидах: «${lead.name}», город ${lead.city || "не указан — спроси город доставки"}.`);
    else lines.push("Клиента нет в базе — до оформления спроси название точки и город доставки (shopName, city).");
    const mine = botOrdersOf(orders, phone, client?.clientId ?? "").slice(0, 5);
    for (const o of mine) {
      const items = o.items.map((i) => `${i.variety} ${i.grade} ${i.quantity} шт.`).join(", ");
      const parts = farmPayments(o).map((p) => {
        const last = lastInvoice(invoices, o.orderId, p.farm);
        if (p.paidAmount >= p.amount - 1) return "оплачено";
        if (!last) return "счёт ещё не выставлен";
        if (isOpenKaspiStatus(last.status)) return `счёт Kaspi ждёт оплаты на номер ${prettyKaspiPhone(last.phone)}`;
        if (last.status === "error") return `счёт не дошёл (${kaspiErrorText(last.errorCode, last.errorMessage)}) — попроси номер Kaspi`;
        return `счёт ${last.status === "expired" ? "истёк" : "отменён"}`;
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

export { dueParts, lastInvoice, botOrdersOf, invoicePart };
