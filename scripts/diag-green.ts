/*
 * Диагностика WhatsApp (Green API): какой номер подключён к инстансу, в каком он
 * состоянии и включены ли нужные уведомления. НИЧЕГО НЕ МЕНЯЕТ, ключей не печатает.
 *
 * Запуск: npx tsx scripts/diag-green.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { greenConfig } from "../src/lib/greenApi";

async function get(method: string): Promise<Record<string, unknown>> {
  const cfg = greenConfig();
  if (!cfg) throw new Error("нет GREENAPI_INSTANCE / GREENAPI_TOKEN");
  const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}`, { signal: AbortSignal.timeout(20000) });
  const text = (await res.text()).split(cfg.token).join("***");
  if (!res.ok) throw new Error(`${method}: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function main() {
  // Проверка номера — то же, что рассылка делает перед каждым сообщением.
  for (let i = 1; i <= 5; i++) {
    const t = Date.now();
    try {
      const st = await get("getStateInstance");
      console.log(`getStateInstance #${i}: ${String(st.stateInstance)} за ${Date.now() - t} мс`);
    } catch (err) {
      console.log(`getStateInstance #${i}: ОШИБКА за ${Date.now() - t} мс — ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  const wa = await get("getWaSettings");
  console.log(`Номер инстанса: ${String(wa.phone || wa.wid || "(не указан)")}`);
  console.log(`Состояние:      ${String(wa.stateInstance || "")}`);
  console.log(`Имя в WhatsApp: ${wa.deviceId ? "есть" : "-"}`);
  const s = await get("getSettings");
  for (const k of ["webhookUrl", "incomingWebhook", "outgoingWebhook", "outgoingMessageWebhook", "outgoingAPIMessageWebhook", "markIncomingMessagesReaded"]) {
    console.log(`${k}: ${String(s[k] ?? "")}`);
  }
}

main().catch((err) => {
  console.error("ОШИБКА:", err instanceof Error ? err.message : err);
  process.exit(1);
});
