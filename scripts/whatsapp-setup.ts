/*
 * Подключение рабочего WhatsApp (Green API) и ИИ (OpenAI) — запускает
 * whatsapp-key.bat после того, как владелец вписал ключи.
 *
 * Что делает:
 *   1. спрашивает у Green API, подключён ли номер (отсканирован ли QR-код);
 *   2. прописывает в Green API адрес уведомлений и токен (WHATSAPP_WEBHOOK_TOKEN) —
 *      руками в кабинете ничего копировать не нужно;
 *   3. проверяет ключ OpenAI и какие модели из списка программы ему доступны.
 *
 * Ключи НЕ печатает никогда — только «есть / нет» и длину.
 * Запуск: npx tsx scripts/whatsapp-setup.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { configureWebhook, getInstanceState, greenConfig } from "../src/lib/greenApi";

const SITE = "https://www.crm-ecoculture.kz";
const len = (v?: string) => (v && v.trim() ? `есть (${v.trim().length} симв.)` : "НЕТ");

async function main() {
  console.log("=== Ключи ===");
  console.log(`GREENAPI_URL:           ${process.env.GREENAPI_URL ? process.env.GREENAPI_URL.trim() : "нет (будет https://api.green-api.com)"}`);
  console.log(`GREENAPI_INSTANCE:      ${len(process.env.GREENAPI_INSTANCE)}`);
  console.log(`GREENAPI_TOKEN:         ${len(process.env.GREENAPI_TOKEN)}`);
  console.log(`WHATSAPP_WEBHOOK_TOKEN: ${len(process.env.WHATSAPP_WEBHOOK_TOKEN)}`);
  console.log(`OPENAI_API_KEY:         ${len(process.env.OPENAI_API_KEY)}`);

  let ok = true;
  console.log("\n=== WhatsApp (Green API) ===");
  const cfg = greenConfig();
  if (!cfg) {
    console.log("Нет GREENAPI_INSTANCE или GREENAPI_TOKEN — WhatsApp не подключён.");
    ok = false;
  } else {
    try {
      const state = await getInstanceState(cfg);
      console.log(`Состояние номера: ${state}${state === "authorized" ? " — подключён" : " — отсканируйте QR-код в кабинете Green API"}`);
      if (state !== "authorized") ok = false;
    } catch (err) {
      console.log(`Green API не ответил: ${err instanceof Error ? err.message : err}`);
      ok = false;
    }
    const token = (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim();
    if (!token) {
      console.log("Нет WHATSAPP_WEBHOOK_TOKEN — уведомления не настроены.");
      ok = false;
    } else {
      try {
        await configureWebhook(cfg, `${SITE}/api/whatsapp/webhook`, token);
        console.log(`Уведомления: ${SITE}/api/whatsapp/webhook — прописано (применится в течение 5 минут).`);
      } catch (err) {
        console.log(`Не удалось прописать уведомления: ${err instanceof Error ? err.message : err}`);
        ok = false;
      }
    }
  }

  console.log("\n=== ИИ (OpenAI) ===");
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    console.log("Нет OPENAI_API_KEY — разбора переписки не будет.");
    ok = false;
  } else {
    try {
      const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (res.status === 401) {
        console.log("OpenAI не принял ключ — проверьте, что скопировали его целиком.");
        ok = false;
      } else if (!res.ok) {
        console.log(`OpenAI ответил ${res.status}.`);
        ok = false;
      } else {
        const body = (await res.json()) as { data?: { id: string }[] };
        const ids = new Set((body.data ?? []).map((m) => m.id));
        const want = [process.env.OPENAI_MODEL, "gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4o-mini-transcribe", "whisper-1"].filter(Boolean) as string[];
        for (const m of want) console.log(`  ${ids.has(m) ? "+" : "-"} ${m}`);
        console.log("Ключ работает. Баланс проверьте на platform.openai.com → Billing.");
      }
    } catch (err) {
      console.log(`OpenAI не ответил: ${err instanceof Error ? err.message : err}`);
      ok = false;
    }
  }

  console.log(ok ? "\nВСЁ ПОДКЛЮЧЕНО." : "\nЕСТЬ ЧТО ДОДЕЛАТЬ — см. выше.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
