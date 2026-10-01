import { BOT_HUMAN_QUIET_HOURS, BOT_MODES, type BotChat, type BotSettings } from "./broadcast";

// ---------------------------------------------------------------------------
// Дожим молчащего клиента (владелец, 01.10.2026: «бот уходит в инактив, когда
// клиент молчит; давай каждый час спрашивать и пытаться продавать»).
//
// Не каждый час без конца: неофициальный WhatsApp банят за «робота», а клиент
// на пятое «ну что, берёте?» пишет «СТОП» — и рассылки ему больше не уходят
// никогда. Поэтому три касания с растущей паузой — через 1 ч, ещё через 3 ч и
// назавтра — и только днём. Клиент ответил — счёт заново. Модель вправе решить,
// что дожимать нечего (отказ, заказ оплачен, служебный разговор), — тогда
// дожим этого разговора закрыт. Проверка — `check-bot-order`.
// ---------------------------------------------------------------------------

/** Пауза перед каждым касанием, часов: 1-е — через час после нашего ответа, 2-е — через 3 ч после 1-го, 3-е — назавтра. */
export const NUDGE_GAPS_HOURS = [1, 3, 20];
/** Дожимаем только днём по Алматы: [с, до). */
export const NUDGE_FROM_HOUR = 9;
export const NUDGE_TO_HOUR = 20;
/** Менеджер писал в чате за столько дней — чат его, бот не дожимает. */
export const NUDGE_MANAGER_CHAT_DAYS = 14;
/** Разговор, где клиент молчит дольше, — уже не разговор: не дожимаем. */
export const NUDGE_MAX_SILENCE_DAYS = 3;

function hoursSince(iso: string, now: Date): number {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? (now.getTime() - t) / 3600000 : Infinity;
}

/**
 * Пора ли дожимать этот чат. Возвращает номер касания (1…3) или 0 — не надо.
 * Только разговоры, где клиент уже отвечал, а последним писали мы.
 */
export function nudgeDue(input: { settings: BotSettings; chat: BotChat; now: Date; hour: number }): number {
  const { settings, chat, now, hour } = input;
  if (!settings.enabled) return 0;
  if (chat.mode === BOT_MODES.OPT_OUT) return 0;
  if (settings.scope === "broadcast" && chat.ourIds.length === 0) return 0;
  if (hour < NUDGE_FROM_HOUR || hour >= NUDGE_TO_HOUR) return 0;
  if (hoursSince(chat.humanAt, now) < BOT_HUMAN_QUIET_HOURS) return 0;
  // Менеджер сам писал в этом чате за две недели — это его клиент и его разговор (доставка, «как в
  // прошлый раз»): бот туда с «пробной партией» не лезет. Первая проверка на живых чатах показала
  // именно это — «Ок», «Как в прошлый раз с доставкой в ГРЭС», «Я у Ильяса беру».
  if (hoursSince(chat.humanAt, now) < NUDGE_MANAGER_CHAT_DAYS * 24) return 0;
  const nudge = chat.nudge ?? { count: 0, at: "", done: false };
  if (nudge.done || nudge.count >= NUDGE_GAPS_HOURS.length) return 0;
  const ctx = chat.context;
  const last = ctx[ctx.length - 1];
  if (!last || last.role !== "us") return 0;
  const lastClient = [...ctx].reverse().find((c) => c.role === "client");
  if (!lastClient) return 0; // клиент ни разу не ответил — это рассылка, а не разговор
  if (hoursSince(lastClient.at, now) > NUDGE_MAX_SILENCE_DAYS * 24) return 0;
  const from = nudge.count === 0 ? last.at : nudge.at;
  return hoursSince(from, now) >= NUDGE_GAPS_HOURS[nudge.count] ? nudge.count + 1 : 0;
}

/** Задание модели на касание: вместо «ответь на последнее сообщение». */
export function nudgeTask(attempt: number, silentHours: number): string {
  const hours = Math.max(1, Math.round(silentHours));
  return [
    `Клиент не отвечает уже около ${hours} ч после нашего последнего сообщения. Это дожим №${attempt} из ${NUDGE_GAPS_HOURS.length}.`,
    "Напиши ОДНО короткое сообщение (1–2 предложения), которое вернёт клиента к покупке: новый повод (свежий срез, позиция",
    "заканчивается на складе, доставка завтра, пробная партия 50 шт.), конкретное предложение с ценой и простой вопрос,",
    "на который легко ответить «да». Не повторяй прошлые сообщения, не упрекай за молчание, не дави.",
    attempt >= NUDGE_GAPS_HOURS.length ? "Это последнее касание: мягко — «если понадобится, просто напишите»." : "",
    "Назови не больше двух позиций, и цену каждой бери ТОЛЬКО из прайса: найди строку сорта и нужную длину/категорию в ней.",
    "silent=true, если: клиент отказался или сказал, что берёт у нашего менеджера (Ильяс, Эмиль, Бауыржан и др.) или у",
    "другого поставщика; он уже заказал и ждёт доставку; заказ оплачен; разговор служебный (доставка, курьер); писать неуместно.",
    "Оформлять заказ сейчас нельзя: order.confirmed=false, kaspiPhone пусто.",
  ]
    .filter(Boolean)
    .join("\n");
}
