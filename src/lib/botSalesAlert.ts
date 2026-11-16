import { greenConfig, sendText } from "./greenApi";
import { settingsMap } from "./repo/broadcasts";
import { digestPhones, DIGEST_SETTING } from "./morningDigest";
import { phoneKey } from "./leads";
import { listClients } from "./repo/clients";
import { listUsers } from "./repo/users";
import { clientForPhone } from "./waOrder";
import { waPhone } from "./broadcast";

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

/**
 * Тревога бота — ещё и менеджеру клиента (16.11.2026): клиентка Ильгара ответила на напоминание об оплате «выставляйте
 * счёт», а тревоги уходили только команде из `BotSalesPhones` — сам Ильгар о просьбе своей клиентки не узнал бы. Менеджер
 * берётся из карточки клиента, номер — из карточки сотрудника («Настройки → Сотрудники → WhatsApp»). Кто уже получил
 * тревогу в составе команды, второй раз её не получает. Не ушло — только запись в лог.
 */
export async function notifyClientManager(clientPhone: string, text: string): Promise<boolean> {
  try {
    const cfg = greenConfig();
    if (!cfg || !text) return false;
    const [clients, users, map] = await Promise.all([listClients(), listUsers(), settingsMap()]);
    const client = clientForPhone(clients, clientPhone);
    const email = (client?.managerEmail || "").toLowerCase();
    if (!email) return false;
    const to = waPhone(users.find((u) => u.email.toLowerCase() === email && u.active)?.phone);
    if (!to) return false;
    const team = new Set(digestPhones(map[BOT_SALES_SETTING]).map((p) => phoneKey(p)));
    if (team.has(phoneKey(to))) return false;
    await sendText(cfg, to, text, { linkPreview: false });
    return true;
  } catch (err) {
    console.error("bot manager alert:", err instanceof Error ? err.message : err);
    return false;
  }
}
