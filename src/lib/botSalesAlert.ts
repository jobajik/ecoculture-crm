import { greenConfig, sendText } from "./greenApi";
import { settingsMap } from "./repo/broadcasts";
import { digestPhones, DIGEST_SETTING } from "./morningDigest";
import { phoneKey } from "./leads";

/**
 * Продажи бота — сообщением команде (владелец, 03.10.2026: «все продажи бота
 * скидывай Руслану, мне и Данияру»). Номера — настройка `BotSalesPhones`
 * («Настройки → Продажи бота в WhatsApp»). Не ушло — только запись в лог:
 * ответ клиенту и оформление заказа от этого не зависят.
 */
export const BOT_SALES_SETTING = "BotSalesPhones";

export async function notifyBotSale(text: string): Promise<number> {
  try {
    const cfg = greenConfig();
    if (!cfg || !text) return 0;
    const phones = digestPhones((await settingsMap())[BOT_SALES_SETTING]);
    let sent = 0;
    for (const p of phones) {
      try {
        await sendText(cfg, p, text, { linkPreview: false });
        sent += 1;
      } catch (err) {
        console.error("bot sale alert:", p, err instanceof Error ? err.message : err);
      }
    }
    return sent;
  } catch (err) {
    console.error("bot sale alert:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * Номера сотрудников (сводка и продажи бота): бот им не отвечает — иначе на
 * «принял» от Руслана бот начал бы ему продавать.
 */
export function staffPhoneKeys(map: Record<string, string>): Set<string> {
  return new Set(
    [...digestPhones(map[DIGEST_SETTING]), ...digestPhones(map[BOT_SALES_SETTING])].map((p) => phoneKey(p)).filter(Boolean)
  );
}
