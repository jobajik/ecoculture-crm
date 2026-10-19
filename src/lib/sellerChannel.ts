import { BOT_MANAGER_EMAIL, isBotEmail } from "./botIdentity";
import { genitiveName } from "./waLines";

// ---------------------------------------------------------------------------
// Кто продаёт: бот основного номера или ИИ-помощник на номере менеджера (19.10.2026, владелец про
// Ильяса: «мощный помощник, который бы смог продавать»; решения — заказ на Ильяса, его продажа и бонус,
// клиенту счёт Kaspi, Ильясу — сообщение «оформил заказ №…»). Один и тот же путь заказа и счёта
// (`botOrderRunner.ts`) работает для обоих: канал говорит, на кого заявка, с какого номера писать и
// какие заказы «свои» (их помощник может перевыставить или отменить). Чистые правила.
// ---------------------------------------------------------------------------

export interface SellerChannel {
  /** Почта «менеджера» заявки и новой карточки клиента: бот или менеджер номера. */
  managerEmail: string;
  /** Линия WhatsApp: "" — основной номер (бот), «m-…» — номер менеджера. */
  line: string;
  /** Имя менеджера (первое слово) — в подсказке модели и в заметке заявки; у бота пусто. */
  managerName: string;
}

export const BOT_CHANNEL: SellerChannel = { managerEmail: BOT_MANAGER_EMAIL, line: "", managerName: "" };

/** Метка в заметке заявки: заказ оформил помощник (а не сам менеджер). По ней — оплата, напоминания, отмена. */
export const ASSISTANT_ORDER_MARK = "Заказ оформил ИИ-помощник";

export function lineChannel(line: { code: string; managerEmail: string }, managerName: string): SellerChannel {
  return { managerEmail: line.managerEmail.trim().toLowerCase(), line: line.code, managerName: (managerName || "").trim().split(/\s+/)[0] || "" };
}

export const isLineChannel = (ch: SellerChannel) => !!ch.line;

/** Заказ оформил ИИ-помощник какого-нибудь менеджера. */
export function isAssistantOrder(order: { notes?: string | null }): boolean {
  return (order.notes || "").includes(ASSISTANT_ORDER_MARK);
}

/** Заказ этого канала: у бота — заявки бота, у номера менеджера — заявки, оформленные его помощником. */
export function isChannelOrder(order: { managerEmail: string; notes?: string | null }, ch: SellerChannel): boolean {
  if (!ch.line) return isBotEmail(order.managerEmail);
  return (order.managerEmail || "").trim().toLowerCase() === ch.managerEmail && isAssistantOrder(order);
}

/** Первая фраза заметки заявки. */
export function orderNoteHead(ch: SellerChannel): string {
  if (!ch.line) return "Заказ принял бот WhatsApp.";
  return `${ASSISTANT_ORDER_MARK}${ch.managerName ? ` ${genitiveName(ch.managerName)}` : ""} в WhatsApp.`;
}

/** Подпись в журнале денег. */
export function channelLogText(ch: SellerChannel, what: string): string {
  return ch.line ? `${what} (ИИ-помощник${ch.managerName ? ` ${genitiveName(ch.managerName)}` : ""})` : `${what} (бот)`;
}
