/*
 * Подключение Wazzup (рассылки и бот WhatsApp) — запускает wazzup-key.bat
 * после того, как владелец вписал ключ.
 *
 * Что делает:
 *   1. показывает, какие каналы есть в Wazzup и работает ли WhatsApp;
 *   2. ждёт, пока сайт с новым ключом пересоберётся (адрес уведомлений
 *      отвечает на проверку), — до 6 минут;
 *   3. прописывает в Wazzup адрес уведомлений с секретом в адресе.
 *
 * Ключ и секрет НЕ печатает никогда — только «есть / нет» и длину.
 * Запуск: npx tsx scripts/wazzup-setup.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getWebhooks, listChannels, subscribeWebhooks } from "../src/lib/wazzupApi";
import { CHANNEL_STATE_TEXT } from "../src/lib/wazzup";

const SITE = "https://www.crm-ecoculture.kz";
const len = (v?: string) => (v && v.trim() ? `есть (${v.trim().length} симв.)` : "НЕТ");

async function siteReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function main() {
  const key = process.env.WAZZUP_API_KEY;
  const token = (process.env.WAZZUP_WEBHOOK_TOKEN || "").trim();
  console.log("=== Ключи ===");
  console.log(`WAZZUP_API_KEY:       ${len(key)}`);
  console.log(`WAZZUP_WEBHOOK_TOKEN: ${len(token)}`);
  console.log(`OPENAI_API_KEY:       ${len(process.env.OPENAI_API_KEY)} (нужен боту)`);
  if (!key || !token) {
    console.log("Нет ключа или секрета — дальше не иду.");
    process.exit(1);
  }

  console.log("\n=== Каналы Wazzup ===");
  try {
    const channels = await listChannels();
    if (channels.length === 0) console.log("Каналов нет — подключите WhatsApp в кабинете Wazzup.");
    for (const c of channels) {
      console.log(`  ${c.transport} +${c.plainId} — ${CHANNEL_STATE_TEXT[c.state] ?? c.state} (id ${c.channelId})`);
    }
    const wa = channels.filter((c) => c.transport === "whatsapp");
    if (wa.length > 1 && !process.env.WAZZUP_CHANNEL_ID) {
      console.log("Каналов WhatsApp несколько — буду слать с первого рабочего. Другой выбирается WAZZUP_CHANNEL_ID.");
    }
    if (wa.length === 0 && channels.some((c) => c.transport === "wapi")) {
      console.log("Есть только WABA — для рассылок через WABA нужны шаблоны, программа их пока не поддерживает.");
    }
  } catch (err) {
    console.log(`Wazzup не ответил: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const url = `${SITE}/api/wazzup/webhook/${token}`;
  console.log("\n=== Адрес уведомлений ===");
  process.stdout.write("Жду, пока сайт пересоберётся с новым ключом");
  let ready = false;
  for (let i = 0; i < 36 && !ready; i++) {
    ready = await siteReady(url);
    if (!ready) {
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  console.log(ready ? " готово." : " не дождался.");
  if (!ready) {
    console.log("Сайт ещё не принял новый секрет. Запустите wazzup-key.bat ещё раз через пару минут (ключ вводить не нужно — просто Enter).");
    process.exit(1);
  }
  try {
    await subscribeWebhooks(url);
    const w = (await getWebhooks()) as { webhooksUri?: string; subscriptions?: Record<string, boolean> } | null;
    const saved = String(w?.webhooksUri || "");
    console.log(saved === url ? "Уведомления прописаны: сообщения, статусы и каналы." : "Wazzup ответил без адреса — проверьте в кабинете Wazzup.");
    if (w?.subscriptions) console.log(`Подписки: ${Object.entries(w.subscriptions).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  } catch (err) {
    console.log(`Не удалось прописать уведомления: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  console.log("\nГотово: рассылки — «Клиенты → Рассылки», бот — там же, кнопка «Бот».");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
