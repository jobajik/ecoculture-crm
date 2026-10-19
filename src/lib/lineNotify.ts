import { getInstancePhone, greenConfig, sendText } from "./greenApi";
import { listWaLines } from "./repo/waLines";
import { saveSettings } from "./repo/settings";
import { staffPhoneKeys } from "./botSalesAlert";
import { phoneKey } from "./leads";

/**
 * Сообщение менеджеру о том, что сделал его ИИ-помощник (заказ, тревога, утренний план), — с ОСНОВНОГО
 * номера на номер менеджера (19.10.2026, владелец: «Ильяс получает сообщение „оформил заказ №…“»). Писать
 * со своего же номера самому себе нельзя: такое сообщение WhatsApp не показывает уведомлением. Ответы
 * менеджера на основной номер бот не принимает за клиента (номера линий — «свои», `staffPhoneKeys` +
 * `listWaLines` в `runBot`). Не ушло — только лог: заказ и ответ клиенту от этого не зависят.
 */
export async function notifyLineManager(lineCode: string, text: string): Promise<boolean> {
  try {
    const cfg = greenConfig();
    if (!cfg || !text) return false;
    const line = (await listWaLines()).find((l) => l.code === lineCode);
    if (!line?.phone) return false;
    await sendText(cfg, line.phone, text, { linkPreview: false });
    return true;
  } catch (err) {
    console.error("line manager notify:", err instanceof Error ? err.message : err);
    return false;
  }
}

const MAIN_PHONE_SETTING = "MainWaPhone";
const g = globalThis as unknown as { __mainWaPhone?: string };

/** Номер основного WhatsApp (цифрами): из настройки `MainWaPhone`, иначе спросить Green API и запомнить. */
export async function mainLinePhone(map: Record<string, string>): Promise<string> {
  if (g.__mainWaPhone) return g.__mainWaPhone;
  const saved = (map[MAIN_PHONE_SETTING] || "").replace(/\D/g, "");
  if (saved) return (g.__mainWaPhone = saved);
  const cfg = greenConfig();
  if (!cfg) return "";
  try {
    const phone = await getInstancePhone(cfg);
    if (phone) {
      g.__mainWaPhone = phone;
      await saveSettings({ [MAIN_PHONE_SETTING]: phone }).catch(() => undefined);
    }
    return phone;
  } catch {
    return "";
  }
}

/**
 * Наши номера: сотрудники (сводка, продажи бота), номера менеджеров и основной номер. Им не отвечают ни бот,
 * ни помощник, и лидами они не становятся.
 */
export async function ourPhoneKeys(map: Record<string, string>): Promise<Set<string>> {
  const keys = staffPhoneKeys(map);
  try {
    for (const l of await listWaLines()) if (l.phone) keys.add(phoneKey(l.phone));
  } catch {
    /* без номеров менеджеров — как раньше */
  }
  const main = await mainLinePhone(map);
  if (main) keys.add(phoneKey(main));
  return keys;
}
