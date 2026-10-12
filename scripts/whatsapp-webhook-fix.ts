/*
 * Вернуть в Green API адрес уведомлений, если он слетел (например, после
 * перепривязки номера). `whatsapp-setup.ts` шлёт все настройки разом; если
 * Green API отвечает 500, этот скрипт пробует по шагам и с паузами:
 *   1. только адрес и токен уведомлений — до 4 попыток, 30 с между ними;
 *   2. после каждой попытки читает getSettings и показывает, что записалось.
 * Ключи и токены НЕ печатает — только «задан / нет».
 * Перед попытками проверяет, отвечает ли наш адрес (без токена — 401) и принимает ли
 * Green API хоть какую-то настройку. `--probe` — только эти проверки, без записи адреса.
 * Запуск: npx tsx scripts/whatsapp-webhook-fix.ts [--probe]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { greenConfig, getInstanceState } from "../src/lib/greenApi";

const SITE = "https://www.crm-ecoculture.kz";
const WANT = `${SITE}/api/whatsapp/webhook`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = greenConfig();
  const token = (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim();
  if (!cfg || !token) {
    console.log("Нет ключей Green API или WHATSAPP_WEBHOOK_TOKEN.");
    process.exit(1);
  }
  const url = (m: string) => `${cfg.url}/waInstance${cfg.instance}/${m}/${cfg.token}`;
  const hide = (s: string) => s.split(cfg.token).join("***").split(token).join("***");

  async function show(): Promise<boolean> {
    const res = await fetch(url("getSettings"), { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      console.log(`  getSettings: ${res.status} ${hide(text).slice(0, 200)}`);
      return false;
    }
    const s = JSON.parse(text) as Record<string, unknown>;
    const got = String(s.webhookUrl ?? "");
    console.log(`  webhookUrl: ${got || "(ПУСТО)"}; токен задан: ${s.webhookUrlToken ? "да" : "нет"}; incomingWebhook: ${s.incomingWebhook}`);
    return got === WANT;
  }

  console.log(`Состояние номера: ${await getInstanceState(cfg)}`);
  console.log("Сейчас:");
  if (await show()) {
    console.log("Адрес уже на месте — делать нечего.");
    return;
  }

  // Наш адрес отвечает? Без токена правильный ответ — 401 (не 404, не 5xx, не переадресация).
  try {
    const r = await fetch(WANT, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", redirect: "manual" });
    console.log(`\nНаш адрес уведомлений без токена отвечает: ${r.status} (ожидается 401)`);
  } catch (e) {
    console.log(`\nНаш адрес уведомлений не ответил: ${e instanceof Error ? e.message : e}`);
  }
  // Green API принимает хоть какую-то настройку? Безобидная: она и так «no».
  {
    const r = await fetch(url("setSettings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markIncomingMessagesReaded: "no" }),
      cache: "no-store",
    });
    console.log(`Green API, безобидная настройка: ${r.status} ${hide(await r.text()).slice(0, 200) || "(пустой ответ)"}`);
  }
  const tries = process.argv.includes("--probe") ? 0 : 4;

  for (let attempt = 1; attempt <= tries; attempt++) {
    console.log(`\nПопытка ${attempt}: записываю адрес и токен уведомлений`);
    const res = await fetch(url("setSettings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: WANT, webhookUrlToken: token }),
      cache: "no-store",
    });
    const text = hide(await res.text());
    console.log(`  setSettings: ${res.status} ${text.slice(0, 300) || "(пустой ответ)"}`);
    await sleep(5000);
    if (await show()) {
      console.log("\nГОТОВО: адрес уведомлений записан. Green API применяет его до 5 минут.");
      return;
    }
    if (attempt < tries) await sleep(30000);
  }
  console.log("\nНЕ ПОЛУЧИЛОСЬ: Green API так и не принял адрес. Нужно вписать его в кабинете Green API вручную.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
