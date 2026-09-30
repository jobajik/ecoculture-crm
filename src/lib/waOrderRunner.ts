import { chatJson, openAiConfigured } from "./openai";
import { DEFAULT_VARIETIES } from "./constants";
import { localDayKey } from "./timezone";
import { listVarietiesByType } from "./repo/varieties";
import { appendWaOrderDraft } from "./repo/waOrders";
import { WA_ORDER_SCHEMA, looksLikeOrder, parseWaOrder, waOrderSystemPrompt } from "./waOrder";
import type { WaMessage } from "./types";

/**
 * Входящее сообщение клиента → черновик заявки, если это заказ. Зовёт вебхук
 * WhatsApp после записи сообщения. Ничего не бросает: разбор — помощь
 * менеджеру, а не условие приёма сообщения.
 */
export async function draftFromIncoming(message: WaMessage): Promise<string> {
  try {
    if (message.direction !== "in") return "";
    if (!looksLikeOrder(message.text)) return "";
    if (!openAiConfigured()) return "";
    let catalog: Record<string, string[]> = DEFAULT_VARIETIES;
    try {
      catalog = await listVarietiesByType();
    } catch {
      /* справочник не прочитался — сорта по умолчанию */
    }
    const today = localDayKey();
    const { data } = await chatJson(
      waOrderSystemPrompt(catalog, today),
      `Сообщение клиента${message.senderName ? ` (${message.senderName})` : ""}:\n${message.text}`,
      "wa_order",
      WA_ORDER_SCHEMA as unknown as Record<string, unknown>,
      { fast: true }
    );
    const parsed = parseWaOrder(data, catalog, today);
    if (!parsed) return "";
    return await appendWaOrderDraft({
      phone: message.phone,
      senderName: message.senderName,
      messageId: message.messageId,
      text: message.text,
      ...parsed,
    });
  } catch (err) {
    console.error("wa order draft:", err instanceof Error ? err.message : err);
    return "";
  }
}
