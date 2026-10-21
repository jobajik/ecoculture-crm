import { EMPTY_NUDGE, isAckOnly, type BotChat } from "./broadcast";
import { NUDGE_FROM_HOUR, NUDGE_MAX_SILENCE_DAYS, NUDGE_TO_HOUR } from "./botNudge";

/**
 * Дожим с номера менеджера — ОДНО касание через 3 ч (21.10.2026, владелец: «по менеджерам тоже надо уменьшить спам»).
 * У бота основного номера их два (3 ч и назавтра); на номере менеджера второе — дело самого менеджера: клиент есть в его
 * утреннем плане, и третье сообщение подряд от «Ильяса» без ответа выглядит как робот.
 */
export const LINE_NUDGE_GAPS_HOURS = [3];
import { mergeMessages, messageText } from "./whatsapp";
import type { WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Продающий помощник на номере менеджера (19.10.2026, владелец про Ильяса: «мощный помощник, который бы
// смог продавать»; выбрал: отвечает, если менеджер молчит 5 минут; сам оформляет заявку и счёт; дожим
// молчащих; утренний план менеджеру; фото и каталог в ответах; знает клиента менеджера). Чистые правила —
// работа в `lineSeller.ts`, проверка — `check-wa-lines`.
// ---------------------------------------------------------------------------

/**
 * Разговор ведёт сам менеджер — заказ оформляет он, не помощник (21.10.2026, владелец: «мне говорят, что ты дублируешь
 * заявки после менеджеров»). Сабина: Эмиль голосом договорился на 100 шт. и в 06:20 оформил заявку, через 7 минут
 * помощник оформил ту же самую и выставил свой счёт — клиент оплатил его, а Юлия довыставляла счёт по заявке Эмиля.
 * Танзиля: Ильяс оформил заявку, помощник следом — ещё две по частям того же заказа.
 * Сколько часов после ответа менеджера клиенту помощник заказы не оформляет.
 */
export const MANAGER_ORDER_LOCK_HOURS = 6;

/**
 * Когда менеджер последний раз писал клиенту САМ — в ответ на его сообщение (не помощник, не дожим и не утренняя
 * рассылка с телефона: та уходит всем, и клиент до неё молчал). Пусто — такого не было за `MANAGER_ORDER_LOCK_HOURS`.
 */
export function managerTalkAt(chat: WaMessage[], autoIds: Set<string>, now: Date): string {
  const since = now.getTime() - MANAGER_ORDER_LOCK_HOURS * 3600000;
  const merged = mergeMessages(chat);
  let lastHuman = "";
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];
    if (m.direction !== "out" || autoIds.has(m.messageId) || m.source === "assistant") continue;
    const t = Date.parse(m.at);
    if (!Number.isFinite(t) || t < since) continue;
    // Отвечал клиенту: перед этим сообщением клиент писал (в пределах тех же часов).
    const answered = merged.slice(0, i).some((x) => x.direction === "in" && Date.parse(x.at) >= t - MANAGER_ORDER_LOCK_HOURS * 3600000);
    if (answered && m.at > lastHuman) lastHuman = m.at;
  }
  return lastHuman;
}

/** Сколько последних сообщений переписки видит модель и сколько знаков в них всего. */
export const LINE_CONTEXT_MESSAGES = 24;
export const LINE_CONTEXT_CHARS = 7000;

/**
 * Переписка номера менеджера → память в виде бота (`BotChat`), чтобы ход продавца шёл тем же путём, что у
 * бота основного номера: подсказка, заказ, фото, проверка на повтор. Своей памяти у линии нет — она каждый
 * раз собирается из WaMessages (там и сообщения менеджера, и помощника).
 */
export function lineBotChat(phone: string, messages: WaMessage[]): BotChat {
  const chat: BotChat = {
    phone: phone.replace(/\D/g, ""),
    updatedAt: "",
    mode: "bot",
    humanAt: "",
    handoffAt: "",
    handoffReason: "",
    lastInMessageId: "",
    ourIds: [],
    context: [],
    name: "",
    botReplies: 0,
    nudge: { ...EMPTY_NUDGE },
    infoPhotos: [],
  };
  const merged = mergeMessages(messages);
  const lastIn = [...merged].reverse().find((m) => m.direction === "in" && m.senderName);
  chat.name = lastIn?.senderName ?? "";
  const items = merged.slice(-LINE_CONTEXT_MESSAGES).map((m) => ({
    role: m.direction === "in" ? ("client" as const) : ("us" as const),
    text: messageText(m).slice(0, 600),
    at: m.at,
  }));
  while (items.length > 1 && JSON.stringify(items).length > LINE_CONTEXT_CHARS) items.shift();
  chat.context = items;
  chat.updatedAt = merged[merged.length - 1]?.at ?? "";
  return chat;
}

/**
 * Пора ли помощнику дожать молчащего клиента на номере менеджера. Как у бота (`botNudge.ts`): клиент в
 * разговоре уже отвечал, последними писали мы (менеджер или помощник), два касания — через 3 ч и назавтра,
 * днём, клиент молчит не дольше 3 дней. Касания помощника — строки журнала kind «nudge» после последнего
 * сообщения клиента. Заказ, оформленный после него, — дожим не нужен (дальше — напоминания об оплате).
 */
export function lineNudgeStatus(input: {
  chat: WaMessage[];
  /** Касания помощника в этом чате (журнал kind «nudge»); closed — модель решила «не писать». */
  nudges: { at: string; closed: boolean }[];
  now: Date;
  hour: number;
  staff?: boolean;
  /** Когда оформлены заказы этого номера (любым менеджером). */
  orderAt?: string[];
}): { attempt: number; reason: string } {
  const no = (reason: string) => ({ attempt: 0, reason });
  if (input.staff) return no("номер сотрудника");
  if (input.hour < NUDGE_FROM_HOUR || input.hour >= NUDGE_TO_HOUR) return no("не рабочее время");
  const chat = mergeMessages(input.chat);
  const last = chat[chat.length - 1];
  if (!last) return no("пустой чат");
  if (last.direction !== "out") return no("последним писал клиент — ждёт ответа");
  const lastClient = [...chat].reverse().find((m) => m.direction === "in" && !isAckOnly(messageText(m)));
  if (!lastClient) return no("клиент в разговоре не отвечал");
  const silentH = (input.now.getTime() - Date.parse(lastClient.at)) / 3600000;
  if (!(silentH <= NUDGE_MAX_SILENCE_DAYS * 24)) return no("клиент молчит дольше 3 дней");
  if ((input.orderAt ?? []).some((at) => at > lastClient.at)) return no("заказ уже оформлен");
  if (input.nudges.some((n) => n.closed && n.at > lastClient.at)) return no("дожим закрыт: модель решила не писать");
  const after = input.nudges.filter((n) => !n.closed && n.at > lastClient.at).map((n) => n.at).sort();
  if (after.length >= LINE_NUDGE_GAPS_HOURS.length) return no(LINE_NUDGE_GAPS_HOURS.length === 1 ? "касание уже было — дальше менеджер" : `все ${LINE_NUDGE_GAPS_HOURS.length} касания были`);
  const from = after.length ? after[after.length - 1] : last.at;
  const passed = (input.now.getTime() - Date.parse(from)) / 3600000;
  const gap = LINE_NUDGE_GAPS_HOURS[after.length];
  if (passed < gap) return no(`рано: прошло ${passed.toFixed(1)} ч из ${gap}`);
  return { attempt: after.length + 1, reason: "пора" };
}

export interface PlanWaiting {
  name: string;
  phone: string;
  text: string;
  sinceIso: string;
}

export interface PlanSleeping {
  name: string;
  phone: string;
  days: number;
  usual: string;
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;
const tail = (phone: string) => `…${phone.replace(/\D/g, "").slice(-4)}`;

function ago(iso: string, now: Date): string {
  const h = (now.getTime() - Date.parse(iso)) / 3600000;
  if (!Number.isFinite(h)) return "";
  if (h < 1) return "меньше часа";
  if (h < 24) return `${Math.floor(h)} ч`;
  return `${Math.floor(h / 24)} дн.`;
}

/**
 * Утренний план менеджеру в WhatsApp (владелец, 19.10: «утренний план Ильясу»): кто ждёт ответа, что
 * вчера сделал помощник, кого он сегодня дожмёт и кто из клиентов менеджера давно не заказывал. Пустые
 * блоки не пишутся; ничего нет вовсе — пусто (не отправлять).
 */
export function lineMorningPlanText(input: {
  managerName: string;
  now: Date;
  waiting: PlanWaiting[];
  yesterday: { replies: number; chats: number; orders: { code: string; amount: number; paid: boolean }[] };
  nudgeToday: number;
  sleeping: PlanSleeping[];
  openNotes: string[];
  link: string;
}): string {
  const blocks: string[][] = [];
  if (input.waiting.length) {
    blocks.push([
      `*Ждут ответа: ${input.waiting.length}*`,
      ...input.waiting.slice(0, 8).map((w) => `• ${w.name || tail(w.phone)} (${tail(w.phone)}, ${ago(w.sinceIso, input.now)}): «${w.text.replace(/\s+/g, " ").slice(0, 70)}»`),
      ...(input.waiting.length > 8 ? [`и ещё ${input.waiting.length - 8}`] : []),
    ]);
  }
  if (input.openNotes.length) {
    blocks.push([`*Помощник просит сделать: ${input.openNotes.length}*`, ...input.openNotes.slice(0, 6).map((n) => `• ${n.slice(0, 110)}`)]);
  }
  const y = input.yesterday;
  if (y.replies || y.orders.length) {
    const total = y.orders.reduce((s, o) => s + o.amount, 0);
    blocks.push([
      "*Помощник вчера*",
      y.replies ? `Ответил в ${y.chats} чатах (${y.replies} сообщ.)` : "",
      y.orders.length
        ? `Оформил заказов: ${y.orders.length} на *${money(total)}* — ${y.orders.map((o) => `№${o.code}${o.paid ? " ✓" : ""}`).join(", ")}`
        : "",
    ].filter(Boolean));
  }
  if (input.nudgeToday) blocks.push([`Сегодня помощник напомнит о себе ${input.nudgeToday} клиентам, которые интересовались и замолчали.`]);
  if (input.sleeping.length) {
    blocks.push([
      `*Давно не заказывали: ${input.sleeping.length}*`,
      ...input.sleeping.slice(0, 6).map((s) => `• ${s.name} (${tail(s.phone)}) — ${s.days} дн.${s.usual ? `, брал: ${s.usual}` : ""}`),
    ]);
  }
  if (blocks.length === 0) return "";
  const head = `Доброе утро${input.managerName ? `, ${input.managerName}` : ""}! План на сегодня по вашему WhatsApp:`;
  return [head, ...blocks.map((b) => b.join("\n")), input.link].filter(Boolean).join("\n\n");
}

/** Тревога помощника менеджеру: кто, что случилось, последнее от клиента. */
export function lineAlertText(input: { phone: string; name: string; note: string; lastClient: string }): string {
  const last = input.lastClient.replace(/\s+/g, " ").trim();
  return [
    "⚠️ *Помощник просит вас*",
    `${input.name ? `${input.name}, ` : ""}+${input.phone.replace(/\D/g, "")}`,
    input.note.replace(/^внимание:\s*/, ""),
    last ? `Клиент: «${last.slice(0, 160)}»` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
