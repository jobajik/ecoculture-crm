import { chatJson } from "./openai";
import type { GreenConfig } from "./greenApi";
import { phoneKey } from "./leads";
import { messageText } from "./whatsapp";
import { listWaMessages } from "./repo/talks";
import { listClients } from "./repo/clients";
import { listUsers } from "./repo/users";
import { listWaLines } from "./repo/waLines";
import { settingsMap } from "./repo/broadcasts";
import { clientForPhone } from "./waOrder";
import { suggestedKaspiPhone } from "./kaspiInvoice";
import { salesKnowledge } from "./botEngine";
import { packingPromptBlock } from "./packing";
import { placeBotOrder } from "./botOrderRunner";
import { BOT_CHANNEL, lineChannel, type SellerChannel } from "./sellerChannel";
import { MANAGER_PROFILES_SETTING, parseManagerProfiles, profileOf } from "./managerProfile";
import { genitiveName, isManagerLine } from "./waLines";
import { sendOnLine } from "./lineAssistant";
import { orderCode } from "./paymentStage";
import { localDayKey } from "./timezone";
import { ROLES } from "./constants";
import type { StaffTarget } from "./staffCommand";
import {
  almatyStamp,
  canOrderByCommand,
  forwardedBefore,
  nextDay,
  orderChatLines,
  parseStaffOrderDraft,
  recentChat,
  STAFF_ORDER_SCHEMA,
  staffOrderDoneText,
  staffOrderPlanText,
  staffOrderProblemText,
  staffOrderSystemPrompt,
  staffOrderUserPrompt,
  type StaffOrderPending,
} from "./staffOrder";
import type { AppUser } from "./types";

// Заявка клиенту по поручению менеджера («прими заявку у Карины») — правила и история в `staffOrder.ts`.

export interface OrderLine {
  /** Линия WhatsApp, где клиент переписывается: "" — основной номер, «leads», «m-…». */
  code: string;
  cfg: GreenConfig;
  /** «номера Ильяса», «основного номера» — для отчёта. */
  via: string;
}

/**
 * Кто продаёт. Клиент переписывается с номером менеджера — заявка на этого менеджера с меткой помощника: оплату и
 * напоминания дальше ведёт помощник с того же номера (`sellerChannel.ts`). Иначе — путь бота основного номера: заявка
 * на менеджера карточки клиента, а если клиент ничей — на менеджера, который попросил (у администратора — на бота).
 */
async function orderChannel(lineCode: string, staff: AppUser | null): Promise<SellerChannel> {
  if (isManagerLine(lineCode)) {
    const row = (await listWaLines()).find((l) => l.code === lineCode);
    if (row) {
      const users = await listUsers().catch(() => [] as AppUser[]);
      const name = users.find((u) => u.email.toLowerCase() === row.managerEmail.toLowerCase())?.name || "";
      const profile = profileOf(parseManagerProfiles((await settingsMap())[MANAGER_PROFILES_SETTING]), row.managerEmail);
      return lineChannel(row, name, profile);
    }
  }
  const seller = staff && canOrderByCommand(staff.role) && staff.role !== ROLES.ADMIN ? staff.email.trim().toLowerCase() : "";
  return seller ? { managerEmail: seller, line: "", managerName: "" } : BOT_CHANNEL;
}

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/**
 * Поручение «прими заявку у клиента»: вынуть состав (модель), проверить склад, цены, пачки и повторы (тот же путь, что
 * у бота, без записи) и вернуть менеджеру план с «ответьте ДА». Ничего не создаёт и клиенту не пишет.
 */
export async function prepareStaffOrder(input: {
  commandText: string;
  /** Сообщение-поручение: его номер и время — чтобы найти пересланное перед ним. */
  source: { id: string; at: string };
  target: StaffTarget;
  staff: AppUser | null;
  staffPhone: string;
  line: OrderLine;
  /** Пробный прогон (`staff-command-try.ts`): что ушло модели и что она ответила. */
  debug?: (line: string) => void;
}): Promise<{ reply: string; pending: StaffOrderPending | null }> {
  const { target, staff, line } = input;
  if (staff && !canOrderByCommand(staff.role)) {
    return { reply: "Заявки по поручению оформляю менеджерам. Попросите менеджера клиента написать мне — или оформите заявку в CRM.", pending: null };
  }
  // Пересланное сообщение приходит отдельным уведомлением рядом с поручением — читаем переписку свежей.
  const all = await listWaMessages({ lines: "all", fresh: true });
  const staffKey = phoneKey(input.staffPhone);
  const clientKey = phoneKey(target.phone);
  const fromStaff = all.filter((m) => !m.line && m.direction === "in" && phoneKey(m.phone) === staffKey);
  const forwarded = forwardedBefore(fromStaff, input.source.id, input.source.at).map((m) => ({ at: m.at, direction: m.direction, text: messageText(m) }));
  const chat = recentChat(all.filter((m) => phoneKey(m.phone) === clientKey)).map((m) => ({ at: m.at, direction: m.direction, text: messageText(m) }));
  const knowledge = await salesKnowledge(target.phone);
  const now = new Date();
  const { data } = await chatJson(
    staffOrderSystemPrompt(),
    staffOrderUserPrompt({
      now: `${almatyStamp(now.toISOString())}, ${WEEKDAYS[new Date(`${localDayKey()}T12:00:00`).getDay()]}, ${localDayKey()}`,
      clientName: target.name,
      command: input.commandText,
      forwarded: orderChatLines(forwarded, { in: "Менеджер", out: "Бот" }),
      chat: orderChatLines(chat, { in: "Клиент", out: "Мы" }),
      sellable: knowledge.sellable,
      packing: packingPromptBlock(),
    }),
    "staff_order",
    STAFF_ORDER_SCHEMA,
    { fast: true, timeoutMs: 30_000 }
  );
  const parsed = parseStaffOrderDraft(data);
  input.debug?.(`Пересланное перед поручением (${forwarded.length}):\n${orderChatLines(forwarded, { in: "Менеджер", out: "Бот" }) || "—"}`);
  input.debug?.(`Переписка с клиентом (${chat.length}), последние 8:\n${orderChatLines(chat.slice(-8), { in: "Клиент", out: "Мы" }) || "—"}`);
  input.debug?.(`Модель: ${JSON.stringify(data)}`);
  if (!parsed.draft.items.length) {
    return { reply: staffOrderProblemText(target.name, parsed.unclear || "не понял, что и сколько клиент заказал"), pending: null };
  }
  const today = localDayKey();
  const guessed = !/^\d{4}-\d{2}-\d{2}$/.test(parsed.draft.deliveryDate);
  const draft = { ...parsed.draft, deliveryDate: guessed ? nextDay(today) : parsed.draft.deliveryDate };
  const client = clientForPhone(await listClients(), target.phone);
  const kaspiPhone = suggestedKaspiPhone([client?.kaspiPay1, client?.kaspiPay2]);
  const channel = await orderChannel(line.code, staff);
  const res = await placeBotOrder({ phone: target.phone, senderName: target.kind === "номер" ? "" : target.name, draft, kaspiPhone, channel, preview: true, byManager: true });
  if (!res.preview) {
    // Уже оформлен, наш магазин, сбой — сказать как есть; вопрос про склад или пачки — с подсказкой, как написать точнее.
    const problem = res.text || res.note || "не получилось проверить заказ";
    return { reply: /уже оформлен/i.test(problem) ? `${target.name}: ${problem}` : staffOrderProblemText(target.name, problem), pending: null };
  }
  const p = res.preview;
  const finalDraft = { ...draft, deliveryDate: p.deliveryDate };
  return {
    reply: staffOrderPlanText({
      name: p.clientName || target.name,
      phone: target.phone,
      items: p.items,
      deliveryDate: p.deliveryDate,
      dateGuessed: guessed && p.deliveryDate === draft.deliveryDate,
      store: p.store,
      total: p.total,
      kaspiPhone,
      via: line.via,
      basis: parsed.basis,
      newClient: p.newClient,
      similar: p.similar,
    }),
    pending: { at: new Date().toISOString(), target: { ...target, name: p.clientName || target.name }, draft: finalDraft, kaspiPhone, basis: parsed.basis },
  };
}

/** Менеджер ответил «ДА»: заявка, счёт Kaspi и сообщение клиенту с номера, где он переписывается. Ответ — менеджеру. */
export async function runStaffOrder(input: { pending: StaffOrderPending; staff: AppUser | null; line: OrderLine }): Promise<string> {
  const { pending, staff, line } = input;
  const { target } = pending;
  const channel = await orderChannel(line.code, staff);
  const by = staff?.name?.split(/\s+/)[0] || "";
  const res = await placeBotOrder({
    phone: target.phone,
    senderName: target.kind === "номер" ? "" : target.name,
    draft: { ...pending.draft, confirmed: true },
    kaspiPhone: pending.kaspiPhone,
    channel,
    byManager: true,
    noteExtra: `По поручению ${by ? genitiveName(by) : "сотрудника"} в чате Ecoculture.`,
  });
  if (!res.orderId) {
    const problem = /не смог/i.test(res.note) ? res.note.replace(/^внимание:\s*/i, "") : res.text || res.note || "не получилось";
    return /уже оформлен/i.test(problem) ? `${target.name}: ${problem}` : staffOrderProblemText(target.name, problem);
  }
  let sentToClient = true;
  try {
    await sendOnLine(line.code, line.cfg, target.phone, res.text, "crm", staff?.email || "staff", `заявка по поручению ${by ? genitiveName(by) : "сотрудника"}`);
  } catch (err) {
    console.error("staff order message:", err instanceof Error ? err.message : err);
    sentToClient = false;
  }
  return staffOrderDoneText({
    code: orderCode(res.orderId),
    name: target.name,
    phone: target.phone,
    via: line.via,
    clientText: res.text,
    // Записка заказа: «заказ: №… на …; счёт … выставить вручную» — хвост после первой точки с запятой и есть проблемы.
    problems: res.note.split("; ").slice(1).join("; "),
    sentToClient,
  });
}
